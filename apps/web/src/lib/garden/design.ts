/**
 * Builds the designer's view model. The server loader and the offline
 * snapshot path both end here so the page renders the same either way.
 */

import { isDesignable, type AreaKind, type BedStyle, type BlockKind } from '$lib/farm/areaKinds';
import type { FarmSnapshot, SnapshotPlanting } from '$lib/cards/snapshot';
import { ymdToUtcMs } from '$lib/cards/build/common';
import { geojsonBBox } from '$lib/geo/area';
import {
  LOUDOUN_DEFAULT_FIRST_FROST_MMDD,
  LOUDOUN_DEFAULT_LAST_FROST_MMDD
} from '$lib/schedule/constants';
import { bedRect, canvasFromArea, clampToArea, freeSpot, rectFt } from './geometry';
import { plantCount, resolveSpacing } from './plantCount';
import type {
  AreaCanvas,
  BedLayout,
  DesignLandmark,
  Footprint,
  GardenCrop,
  GardenDesign,
  PlacedPlanting,
  PlantCountProvenance,
  PlantingStatus,
  ProvenanceTag,
  Rotation,
  SpacingPattern
} from './types';

export interface DesignOptions {
  seasonYear: number;
  readOnlyReason: GardenDesign['readOnlyReason'];
}

export interface DesignAreaInput {
  id: string;
  name: string;
  kind: AreaKind;
  widthFt: number | null;
  lengthFt: number | null;
  geojson: string | null;
}

export interface DesignBlockInput {
  id: string;
  name: string;
  kind: BlockKind;
  widthFt: number | null;
  lengthFt: number | null;
  xFt: number | null;
  yFt: number | null;
  rotationDeg: number | null;
  bedStyle: BedStyle | null;
}

export interface DesignPlantingInput {
  id: string;
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  status: PlantingStatus;
  plantingDateMs: number | null;
  harvestedAtMs: number | null;
  footprint: Footprint | null;
  spacingIn: number | null;
  rowSpacingIn: number | null;
  spacingPattern: SpacingPattern | null;
  plantCount: number | null;
  plantCountProvenance: PlantCountProvenance | null;
  groupId: string | null;
  groupSystemKind: PlacedPlanting['groupSystemKind'];
}

export interface DesignInput {
  area: DesignAreaInput;
  blocks: readonly DesignBlockInput[];
  plantings: readonly DesignPlantingInput[];
  crops: Readonly<Record<string, GardenCrop>>;
  frost: GardenDesign['frost'];
  seasonYear: number;
  asOf: number;
  readOnlyReason: GardenDesign['readOnlyReason'];
}

export const DEFAULT_BED_FT = { widthFt: 4, lengthFt: 8 } as const;

function toRotation(deg: number | null): Rotation {
  const n =
    deg == null || !Number.isFinite(deg) ? 0 : (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  return n as Rotation;
}

function positiveOr(value: number | null | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) && value > 0 ? value : fallback;
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'en', { numeric: true });
}

/** Beds and containers laid out on the Area canvas. Stored positions win;
 *  the rest go to `freeSpot` in name order and are reported as unplaced. */
export function layoutBeds(
  blocks: readonly DesignBlockInput[],
  canvas: GardenDesign['canvas']
): { beds: BedLayout[]; unplacedBedIds: string[] } {
  const designable = blocks
    .filter((b) => b.kind === 'bed' || b.kind === 'container')
    .slice()
    .sort(byName);
  const beds: BedLayout[] = [];
  const pending: BedLayout[] = [];
  for (const b of designable) {
    const widthFt = positiveOr(b.widthFt, b.kind === 'container' ? 1 : DEFAULT_BED_FT.widthFt);
    const lengthFt = positiveOr(b.lengthFt, b.kind === 'container' ? 1 : DEFAULT_BED_FT.lengthFt);
    const rotationDeg = toRotation(b.rotationDeg);
    const base: BedLayout = {
      blockId: b.id,
      name: b.name,
      kind: b.kind as BedLayout['kind'],
      bedStyle: b.bedStyle,
      widthFt,
      lengthFt,
      rotationDeg,
      rect: bedRect(0, 0, widthFt, lengthFt, rotationDeg)
    };
    if (b.xFt != null && b.yFt != null && Number.isFinite(b.xFt) && Number.isFinite(b.yFt)) {
      const rect = bedRect(b.xFt, b.yFt, widthFt, lengthFt, rotationDeg);
      beds.push({ ...base, rect: clampToArea(rect, canvas) ?? rect });
    } else {
      pending.push(base);
    }
  }
  const unplacedBedIds: string[] = [];
  for (const bed of pending) {
    const spot = freeSpot(bed.widthFt, bed.lengthFt, bed.rotationDeg, beds, canvas);
    beds.push(spot ? { ...bed, rect: spot } : bed);
    unplacedBedIds.push(bed.blockId);
  }
  return { beds, unplacedBedIds };
}

export function placedPlanting(
  p: DesignPlantingInput,
  crop: GardenCrop | undefined
): PlacedPlanting {
  const spacing = resolveSpacing(crop, p.spacingPattern ?? 'square', {
    inRowIn: p.spacingIn,
    rowIn: p.rowSpacingIn
  });
  let count = p.plantCount;
  let provenance = p.plantCountProvenance;
  if (p.footprint && (count == null || provenance !== 'manual')) {
    const computed = plantCount(p.footprint, spacing);
    count = computed.count;
    provenance = computed.provenance;
  }
  return {
    cropId: p.id,
    blockId: p.blockId,
    cropPluginId: p.cropPluginId,
    varietyDisplayName: p.varietyDisplayName,
    cropFamily: crop?.cropFamily ?? 'unknown',
    status: p.status,
    plantingDateMs: p.plantingDateMs,
    harvestedAtMs: p.harvestedAtMs,
    footprint: p.footprint,
    spacing,
    plantCount: count ?? null,
    plantCountProvenance: provenance ?? null,
    groupId: p.groupId,
    groupSystemKind: p.groupSystemKind
  };
}

/** A planting belongs to the designer's season when it is dated in that
 *  year, or is an undated plan. */
export function inSeason(
  p: Pick<DesignPlantingInput, 'plantingDateMs' | 'status'>,
  seasonYear: number
): boolean {
  if (p.status === 'archived' || p.status === 'failed') return false;
  if (p.plantingDateMs == null) return p.status === 'planned';
  const y = new Date(p.plantingDateMs).getUTCFullYear();
  return y === seasonYear || y === seasonYear - 1;
}

/** Null when the Area is not a garden or greenhouse. */
export function buildGardenDesign(input: DesignInput): GardenDesign | null {
  if (!isDesignable(input.area.kind)) return null;
  const canvas = canvasFromArea(input.area);
  const { beds, unplacedBedIds } = layoutBeds(input.blocks, canvas);
  const bedIds = new Set(beds.map((b) => b.blockId));
  const plantings = input.plantings
    .filter((p) => bedIds.has(p.blockId) && inSeason(p, input.seasonYear))
    .map((p) => placedPlanting(p, input.crops[p.cropPluginId]))
    .sort(
      (a, b) =>
        (a.plantingDateMs ?? Infinity) - (b.plantingDateMs ?? Infinity) ||
        a.varietyDisplayName.localeCompare(b.varietyDisplayName)
    );
  const crops: Record<string, GardenCrop> = {};
  for (const p of plantings) {
    const c = input.crops[p.cropPluginId];
    if (c) crops[p.cropPluginId] = c;
  }
  return {
    canvas,
    beds,
    plantings,
    crops,
    frost: input.frost,
    seasonYear: input.seasonYear,
    asOf: input.asOf,
    readOnly: input.readOnlyReason !== null,
    readOnlyReason: input.readOnlyReason,
    unplacedBedIds
  };
}

export const FALLBACK_FROST_MMDD = {
  lastSpring: LOUDOUN_DEFAULT_LAST_FROST_MMDD,
  firstFall: LOUDOUN_DEFAULT_FIRST_FROST_MMDD
} as const;

function frostMs(year: number, mmdd: string | null | undefined, fallback: string): number {
  return ymdToUtcMs(`${year}-${mmdd ?? fallback}`) ?? ymdToUtcMs(`${year}-${fallback}`)!;
}

type SnapshotPlantingWithLayout = SnapshotPlanting &
  Partial<{
    footprint: Footprint | null;
    spacingPattern: SpacingPattern | null;
    groupId: string | null;
    groupSystemKind: PlacedPlanting['groupSystemKind'];
  }>;

/** Null when the Area is missing from the snapshot or is not a garden or
 *  greenhouse. Beds without a stored position are laid out with `freeSpot`
 *  in name order and shown as "not placed yet" until moved. */
export function designFromSnapshot(
  snapshot: FarmSnapshot,
  areaId: string,
  opts: DesignOptions
): GardenDesign | null {
  const area = snapshot.areas.find((a) => a.id === areaId);
  if (!area || !isDesignable(area.kind)) return null;
  const blocks: DesignBlockInput[] = snapshot.blocks
    .filter((b) => b.areaId === areaId)
    .map((b) => ({
      id: b.id,
      name: b.name,
      kind: b.kind,
      widthFt: b.widthFt,
      lengthFt: b.lengthFt,
      xFt: b.layout?.xFt ?? null,
      yFt: b.layout?.yFt ?? null,
      rotationDeg: b.layout?.rotationDeg ?? null,
      bedStyle: b.layout?.bedStyle ?? null
    }));
  const blockIds = new Set(blocks.map((b) => b.id));
  const plantings: DesignPlantingInput[] = (snapshot.plantings as SnapshotPlantingWithLayout[])
    .filter((p) => blockIds.has(p.blockId))
    .map((p) => ({
      id: p.id,
      blockId: p.blockId,
      cropPluginId: p.cropPluginId,
      varietyDisplayName: p.varietyDisplayName,
      status: p.status,
      plantingDateMs: ymdToUtcMs(p.plantingDate),
      harvestedAtMs: ymdToUtcMs(p.harvestedAt),
      footprint: p.footprint ?? null,
      spacingIn: p.spacingIn,
      rowSpacingIn: p.rowSpacingIn,
      spacingPattern: p.spacingPattern ?? null,
      plantCount: p.plantCount,
      plantCountProvenance: p.plantCountProvenance,
      groupId: p.groupId ?? null,
      groupSystemKind: p.groupSystemKind ?? null
    }));
  const frost = snapshot.frost;
  const provenance: ProvenanceTag = frost ? frost.provenance : 'fallback';
  return buildGardenDesign({
    area: {
      id: area.id,
      name: area.name,
      kind: area.kind,
      widthFt: area.widthFt,
      lengthFt: area.lengthFt,
      geojson: null
    },
    blocks,
    plantings,
    crops: snapshot.cropPlugins,
    frost: {
      lastSpringFrostMs: frostMs(
        opts.seasonYear,
        frost?.lastSpring,
        FALLBACK_FROST_MMDD.lastSpring
      ),
      firstFallFrostMs: frostMs(opts.seasonYear, frost?.firstFall, FALLBACK_FROST_MMDD.firstFall),
      provenance
    },
    seasonYear: opts.seasonYear,
    asOf: snapshot.generatedAt,
    readOnlyReason: opts.readOnlyReason
  });
}

export function designerHref(
  areaId: string,
  opts: { bedId?: string | null; onYmd?: string | null; view?: 'list' | null } = {}
): string {
  const q = new URLSearchParams();
  if (opts.bedId) q.set('bed', opts.bedId);
  if (opts.onYmd) q.set('on', opts.onYmd);
  if (opts.view) q.set('view', opts.view);
  const qs = q.toString();
  return `/plan/areas/${encodeURIComponent(areaId)}/design${qs ? `?${qs}` : ''}`;
}

/** A landmark's map geometry as a box in the Area's feet grid, clipped to the
 *  canvas. Null unless the canvas came from the Area's polygon and the
 *  landmark has one too. */
export function landmarkRect(
  areaGeojson: string | null,
  landmarkGeojson: string | null,
  canvas: AreaCanvas
): DesignLandmark['rect'] {
  if (canvas.source !== 'polygon-bbox') return null;
  const area = geojsonBBox(areaGeojson);
  const mark = geojsonBBox(landmarkGeojson);
  if (!area || !mark) return null;
  const [minLon, minLat, maxLon, maxLat] = area;
  const spanLon = maxLon - minLon;
  const spanLat = maxLat - minLat;
  if (!(spanLon > 0) || !(spanLat > 0)) return null;
  const clampX = (lon: number) =>
    Math.max(0, Math.min(canvas.widthFt, ((lon - minLon) / spanLon) * canvas.widthFt));
  const clampY = (lat: number) =>
    Math.max(0, Math.min(canvas.lengthFt, ((maxLat - lat) / spanLat) * canvas.lengthFt));
  const x0 = clampX(mark[0]);
  const x1 = clampX(mark[2]);
  const y0 = clampY(mark[3]);
  const y1 = clampY(mark[1]);
  if (x1 - x0 <= 0 && y1 - y0 <= 0) return null;
  const w = Math.max(x1 - x0, 1);
  const l = Math.max(y1 - y0, 1);
  return rectFt(Math.min(x0, canvas.widthFt - w), Math.min(y0, canvas.lengthFt - l), w, l);
}
