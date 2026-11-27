/** Request and response shapes for `POST /api/site-finder`. Client-safe. */

import { z } from 'zod';
import type { AiLimit } from '$lib/billing/aiLimit';
import type { SoilLookup } from '$lib/soil/types';
import type { AiFeatureKind } from './aiAnswer';
import { boxSizeM, validBox } from './geometry';
import {
  GOALS,
  MAX_FOOTPRINT_FT,
  MIN_BOX_M,
  MIN_FOOTPRINT_FT,
  PLANTING_GOALS,
  type Candidate,
  type LonLat,
  type Obstacle,
  type SunSeason
} from './types';
import type { BlockReason } from './candidates';
import { TERRAIN_SOURCE_NAME, type TerrainLookup } from './terrain';

export const MAX_ALLOW_OVERLAP_IDS = 50;
/** Slack on the box size cap, for rounding on the way from the map. */
export const BOX_CAP_SLACK = 1.02;

const footprintSide = z.number().min(MIN_FOOTPRINT_FT).max(MAX_FOOTPRINT_FT);

export const siteFinderRequestSchema = z
  .strictObject({
    goal: z.enum(PLANTING_GOALS),
    box: z.strictObject({
      minLon: z.number().min(-180).max(180),
      minLat: z.number().min(-85).max(85),
      maxLon: z.number().min(-180).max(180),
      maxLat: z.number().min(-85).max(85)
    }),
    footprintFt: z.strictObject({ width: footprintSide, length: footprintSide }),
    useAerial: z.boolean(),
    allowOverlapAreaIds: z.array(z.string().min(1).max(100)).max(MAX_ALLOW_OVERLAP_IDS).optional()
  })
  .superRefine((v, ctx) => {
    if (!validBox(v.box)) {
      ctx.addIssue({ code: 'custom', path: ['box'], message: 'box is not a rectangle' });
      return;
    }
    const { widthM, heightM } = boxSizeM(v.box);
    const cap = GOALS[v.goal].maxBoxM * BOX_CAP_SLACK;
    if (widthM > cap || heightM > cap) {
      ctx.addIssue({ code: 'custom', path: ['box'], message: 'box is too large for this goal' });
    }
    if (widthM < MIN_BOX_M || heightM < MIN_BOX_M) {
      ctx.addIssue({ code: 'custom', path: ['box'], message: 'box is too small' });
    }
  });

export type SiteFinderRequest = z.infer<typeof siteFinderRequestSchema>;

export const NAIP_SOURCE_NAME = 'USDA NAIP via USGS The National Map';

/** Why the photo reading did not happen, beyond aiTry's own reasons. */
export type SiteFinderWhy =
  'no-key' | 'over-cap' | 'offline' | 'rate-limit' | 'timeout' | 'quota' | 'invalid' | 'no-photo';

/** Something Claude saw in the photo. `obstacleId` is set when it counted
 *  as a tree, building, water or pavement in the ranking; `onMap` when the
 *  owner's own map already shows something there. */
export interface SeenItem {
  id: string;
  kind: AiFeatureKind;
  center: LonLat;
  note?: string;
  obstacleId: string | null;
  onMap: boolean;
}

/** A spot Claude liked. It informs; the ranking is always the engine's. */
export interface AiSpotNote {
  center: LonLat;
  reason: string;
  /** The offered spot it sits on, when it does. */
  candidateId: string | null;
  /** Why the engine does not offer it, when it does not. */
  engineReason: BlockReason | 'lower-score' | null;
}

export interface SiteFinderResponse {
  /** `ai` when Claude's reading of the photo was used; `fallback` when the
   *  result is from sun math, the map and the soil survey alone. */
  provenance: 'ai' | 'fallback';
  fallbackReason?: SiteFinderWhy | null;
  /** The banner for a photo reading that was asked for and did not happen. */
  message?: string | null;
  aiLimit?: AiLimit | null;
  candidates: Candidate[];
  obstacles: Obstacle[];
  seen: SeenItem[];
  aiSpots: AiSpotNote[];
  aiCaveats?: string | null;
  soil: SoilLookup;
  /** The survey at each offered spot, when it was looked up there. */
  soilBySpot: Record<string, SoilLookup>;
  season: SunSeason;
  shadeChecked: boolean;
  hasWaterPoint: boolean;
  hasHouse: boolean;
  tooBig: boolean;
  imagery: { source: typeof NAIP_SOURCE_NAME; used: boolean };
  /** Whether the ground's slope and facing direction could be read from
   *  USGS 3DEP elevation for this box. Not `ok` means spots without the
   *  owner's own block values were treated as level ground. */
  terrain: SiteFinderTerrain;
}

export interface SiteFinderTerrain {
  status: TerrainLookup['status'];
  source: typeof TERRAIN_SOURCE_NAME;
  /** Ground size of one cell of the elevation data, in metres. */
  resolutionM?: number;
}
