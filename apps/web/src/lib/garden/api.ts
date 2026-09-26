/**
 * Request and response shapes for the garden designer's writes. Beds use the
 * existing /api/blocks endpoints; plantings, successions, recipes and "Fill
 * this bed" use the /api/garden endpoints below. Every write is owner-only
 * and needs a connection. Spec: docs/design/GARDEN_DESIGNER.md ("API").
 */

import { z } from 'zod';
import { footprintSchema, SPACING_PATTERNS, spacingInSchema } from '$lib/farm/footprint';
import type {
  BedLayout,
  GardenDesign,
  PlacedPlanting,
  ProposedPlanting,
  RecipeApplication,
  SuccessionProposal
} from './types';

const id = z.string().min(1).max(128);
const epochMs = z.number().int().nonnegative();
const plantCount = z.number().int().positive().max(100_000);

/** `GET /api/garden/areas/[id]/design`. Readable by every role. */
export interface GardenDesignResponse {
  design: GardenDesign;
}

/** `POST /api/blocks` body for a designer bed (existing endpoint). */
export interface BedCreateRequest {
  fieldId: string;
  name: string;
  kind: 'bed' | 'container';
  bedStyle: 'raised' | 'in-ground' | 'container' | 'vertical';
  widthFt: number;
  lengthFt: number;
  xFt: number;
  yFt: number;
  rotationDeg: 0 | 90 | 180 | 270;
}

/** `PATCH /api/blocks/[id]` body for move, resize, rotate or rename. */
export type BedPatchRequest = Partial<Omit<BedCreateRequest, 'fieldId' | 'kind'>>;

export interface BedWriteResponse {
  bed: BedLayout;
}

/** `PATCH /api/crops/[id]` with `action: 'set-placement'`. Places or moves a planting
 *  in a bed, or clears its spot with `footprint: null`. `plantCount` given
 *  means typed (`manual`); omitted means the server recomputes it. */
export const footprintWriteSchema = z.strictObject({
  blockId: id,
  footprint: footprintSchema.nullable(),
  spacingPattern: z.enum(SPACING_PATTERNS),
  spacingIn: spacingInSchema.nullable().optional(),
  rowSpacingIn: spacingInSchema.nullable().optional(),
  plantCount: plantCount.nullable().optional(),
  plantingDateMs: epochMs.nullable().optional()
});
export type FootprintWriteRequest = z.infer<typeof footprintWriteSchema>;

export interface FootprintWriteResponse {
  planting: PlacedPlanting;
  /** Tasks shifted by `reanchorCropTasks` when the planting date moved. */
  reanchored: { shifted: number; flaggedStale: number } | null;
  /** Group members that moved with an anchor's new date, as saved. */
  followers?: PlacedPlanting[];
  warnings: string[];
}

/** `POST /api/garden/plantings`. Creates `planned` plantings straight into
 *  beds, from the crop panel's plugin search or from accepted proposals, as
 *  one batch: a bad item writes nothing. */
export const plantingCreateItemSchema = z.strictObject({
  blockId: id,
  cropPluginId: id,
  varietyDisplayName: z.string().min(1).max(120),
  plantingDateMs: epochMs.nullable(),
  footprint: footprintSchema,
  spacingPattern: z.enum(SPACING_PATTERNS),
  spacingIn: spacingInSchema.nullable().optional(),
  rowSpacingIn: spacingInSchema.nullable().optional(),
  plantCount: plantCount.nullable().optional(),
  source: z.enum(['manual', 'plugin', 'ai', 'fallback'])
});
export const plantingCreateSchema = z.strictObject({
  plantings: z.array(plantingCreateItemSchema).min(1).max(50)
});
export type PlantingCreateRequest = z.infer<typeof plantingCreateSchema>;

export interface PlantingCreateResponse {
  plantings: PlacedPlanting[];
}

/** `POST /api/garden/beds/[blockId]/succession`. `commit: false` previews. */
export const successionRequestSchema = z.strictObject({
  cropId: id,
  count: z.number().int().min(1).max(5),
  intervalDays: z.number().int().min(1).max(90).optional(),
  commit: z.boolean()
});
export type SuccessionRequest = z.infer<typeof successionRequestSchema>;

export interface SuccessionResponse {
  proposal: SuccessionProposal;
  groupId: string | null;
  /** The anchor as saved after a commit, now linked to the group. */
  anchor?: PlacedPlanting;
  created: PlacedPlanting[];
}

/** `POST /api/garden/beds/[blockId]/recipe`. `commit: false` previews; a
 *  commit creates only the steps listed in `acceptKeys`. */
export const recipeRequestSchema = z.strictObject({
  recipePluginId: id,
  seasonYear: z.number().int().min(2000).max(2100),
  commit: z.boolean(),
  acceptKeys: z.array(z.string().min(1).max(64)).max(80).optional()
});
export type RecipeRequest = z.infer<typeof recipeRequestSchema>;

export interface RecipeResponse {
  application: RecipeApplication;
  created: PlacedPlanting[];
}

/** `POST /api/garden/beds/[blockId]/fill`. Proposes only; accepted rows go
 *  to `POST /api/garden/plantings` with their own `source`. */
export const fillRequestSchema = z.strictObject({
  dateMs: epochMs,
  seasonYear: z.number().int().min(2000).max(2100),
  cropPluginIds: z.array(id).max(20).optional()
});
export type FillRequest = z.infer<typeof fillRequestSchema>;

export interface FillResponse {
  proposals: ProposedPlanting[];
  provenance: 'ai' | 'fallback';
  fallbackReason: 'no-key' | 'over-cap' | 'offline' | 'rate-limit' | 'timeout' | null;
  /** Plain line for the banner, e.g. why Claude was skipped. */
  message: string | null;
}

export interface GardenErrorResponse {
  error: string;
  code?:
    | 'OFFLINE'
    | 'READ_ONLY'
    | 'OUTSIDE_AREA'
    | 'OVERLAP'
    | 'NOT_DESIGNABLE'
    | 'IN_GROUND'
    | 'BED_HAS_RECORDS'
    | 'FOREIGN_REF';
  issues?: unknown;
}
