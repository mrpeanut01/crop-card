/**
 * Server side of placing plantings in garden beds (Phase 30E). Every read and
 * write goes through the tenant-scoped repos, so another Owner's bed or
 * planting id resolves to "unknown". Callers check the owner role first.
 */

import { json } from '@sveltejs/kit';
import { getArea, type Area } from '$lib/db/areas';
import { getBlock, type Block } from '$lib/db/blocks';
import {
  createPlanned,
  getCrop,
  listCrops,
  movePlantingDate,
  setPlacement,
  unscheduleCrop,
  type Crop,
  type CropPlacement
} from '$lib/db/crops';
import { isDesignable, usesDesignerLayout } from '$lib/farm/areaKinds';
import type { Footprint, SpacingPattern } from '$lib/farm/footprint';
import type {
  FootprintWriteRequest,
  FootprintWriteResponse,
  GardenErrorResponse,
  PlantingCreateRequest
} from '$lib/garden/api';
import { footprintsOverlap } from '$lib/garden/geometry';
import { intervalsOverlapInTime, plantingOccupancy, shortDate } from '$lib/garden/occupancy';
import { plantCount, resolveSpacing } from '$lib/garden/plantCount';
import type { GardenCrop, PlacedPlanting, PlantingStatus } from '$lib/garden/types';
import { frostDatesForYear } from '$lib/schedule/settings';
import { db } from '$lib/db/client';
import { plantingInGround } from '$lib/garden/inGround';
import type { PluginRegistry } from '$lib/plugins';

export type CropLookup = (pluginId: string) => GardenCrop | undefined;

export function cropLookupFrom(registry: PluginRegistry): CropLookup {
  return (pluginId) => {
    const plugin = registry.get(pluginId)?.plugin;
    return plugin?.type === 'crop' ? plugin : undefined;
  };
}

export interface GardenFailure {
  ok: false;
  status: number;
  body: GardenErrorResponse;
}

export function gardenFailure(
  status: number,
  error: string,
  code?: GardenErrorResponse['code']
): GardenFailure {
  return { ok: false, status, body: code ? { error, code } : { error } };
}

export function failureResponse(f: GardenFailure): Response {
  return json(f.body, { status: f.status });
}

export function isFailure(v: unknown): v is GardenFailure {
  return !!v && typeof v === 'object' && (v as { ok?: unknown }).ok === false;
}

export interface DesignableBed {
  block: Block;
  area: Area;
  widthFt: number;
  lengthFt: number;
}

/** The bed or container behind `blockId`, inside a garden or greenhouse
 *  Area, with a Size. Another Owner's id reads as unknown. */
export function resolveDesignableBed(blockId: string): DesignableBed | GardenFailure {
  const block = getBlock(blockId);
  if (!block) return gardenFailure(400, 'unknown blockId', 'FOREIGN_REF');
  if (!block.kind || !usesDesignerLayout(block.kind)) {
    return gardenFailure(409, `${block.name} isn't a bed or container.`, 'NOT_DESIGNABLE');
  }
  const area = block.fieldId ? getArea(block.fieldId) : undefined;
  if (!area || !isDesignable(area.kind)) {
    return gardenFailure(409, `${block.name} isn't in a garden or greenhouse.`, 'NOT_DESIGNABLE');
  }
  if (!block.widthFt || !block.lengthFt) {
    return gardenFailure(
      409,
      `Set ${block.name}'s Size before placing crops in it.`,
      'NOT_DESIGNABLE'
    );
  }
  return { block, area, widthFt: block.widthFt, lengthFt: block.lengthFt };
}

const EDGE_TOLERANCE_IN = 1e-6;

export function footprintInsideBed(
  fp: Footprint,
  bed: { widthFt: number; lengthFt: number }
): boolean {
  return (
    fp.x_in + fp.w_in <= bed.widthFt * 12 + EDGE_TOLERANCE_IN &&
    fp.y_in + fp.l_in <= bed.lengthFt * 12 + EDGE_TOLERANCE_IN
  );
}

export interface PlacementInput {
  footprint: Footprint | null;
  spacingPattern: SpacingPattern;
  spacingIn?: number | null;
  rowSpacingIn?: number | null;
  plantCount?: number | null;
}

/** Columns to store. Typed spacing is kept as `manual`; plugin spacing is
 *  not copied, so a plugin update still flows through. A typed count is
 *  `manual`; otherwise the count is recomputed from spacing, never taken
 *  from the client. */
export function resolvePlacement(
  input: PlacementInput,
  crop: GardenCrop | undefined
): CropPlacement {
  const spacing = resolveSpacing(crop, input.spacingPattern, {
    inRowIn: input.spacingIn ?? null,
    rowIn: input.rowSpacingIn ?? null
  });
  let count: number | null = null;
  let provenance: CropPlacement['plantCountProvenance'] = null;
  if (input.plantCount != null) {
    count = input.plantCount;
    provenance = 'manual';
  } else if (input.footprint) {
    const result = plantCount(input.footprint, spacing);
    count = result.count;
    provenance = result.provenance;
  }
  return {
    footprint: input.footprint,
    spacingIn: input.spacingIn ?? null,
    rowSpacingIn: input.rowSpacingIn ?? null,
    spacingPattern: input.spacingPattern,
    plantCount: count,
    plantCountProvenance: provenance
  };
}

export function placedPlantingFromCrop(crop: Crop, plugin: GardenCrop | undefined): PlacedPlanting {
  const pattern = crop.spacingPattern ?? 'square';
  return {
    cropId: crop.id,
    blockId: crop.blockId,
    cropPluginId: crop.cropPluginId,
    varietyDisplayName: crop.varietyDisplayName,
    cropFamily: plugin?.cropFamily ?? 'unknown',
    status: crop.status as PlantingStatus,
    plantingDateMs: crop.plantingDate,
    harvestedAtMs: crop.harvestedAt ?? null,
    footprint: crop.footprint ?? null,
    spacing: resolveSpacing(plugin, pattern, {
      inRowIn: crop.spacingIn ?? null,
      rowIn: crop.rowSpacingIn ?? null
    }),
    plantCount: crop.plantCount ?? null,
    plantCountProvenance: crop.plantCountProvenance ?? null,
    groupId: crop.groupId ?? null,
    groupSystemKind: crop.groupSystemKind ?? null,
    groupRole: crop.groupRole ?? null,
    sourceProvenance: crop.sourceProvenance ?? null
  };
}

/** "Shares space with Lettuce until Jul 1." for each planting in the bed that
 *  overlaps this one in both space and time. Interplanting is allowed, so
 *  these never block. */
export function sharedSpaceWarnings(crop: Crop, lookup: CropLookup): string[] {
  if (!crop.footprint || crop.plantingDate == null) return [];
  const year = new Date(crop.plantingDate).getFullYear();
  const { firstFallFrostMs } = frostDatesForYear(year);
  const mine = plantingOccupancy(
    placedPlantingFromCrop(crop, lookup(crop.cropPluginId)),
    lookup(crop.cropPluginId),
    { firstFallFrostMs }
  );
  if (!mine) return [];
  const out: string[] = [];
  for (const other of listCrops({ blockId: crop.blockId })) {
    if (other.id === crop.id) continue;
    const plugin = lookup(other.cropPluginId);
    const theirs = plantingOccupancy(placedPlantingFromCrop(other, plugin), plugin, {
      firstFallFrostMs
    });
    if (!theirs || !(theirs.startMs < mine.endMs && mine.startMs < theirs.endMs)) continue;
    if (other.footprint && !footprintsOverlap(other.footprint, crop.footprint)) continue;
    out.push(
      `Shares space with ${other.varietyDisplayName} until ${shortDate(Math.min(theirs.endMs, mine.endMs))}.`
    );
  }
  return out;
}

/** Why a linked succession sowing can't go to this spot in another bed:
 *  the spot is taken for part of its time there. Sowings in a series are
 *  meant to follow one another, so they never share space the way a
 *  hand-placed interplanting may. Null when the spot is free. */
export function linkedSowingClash(
  current: Crop,
  target: { blockId: string; footprint: Footprint | null; plantingDateMs: number | null },
  bedName: string,
  lookup: CropLookup
): string | null {
  if (!target.footprint || target.plantingDateMs == null) return null;
  const plugin = lookup(current.cropPluginId);
  const year = new Date(target.plantingDateMs).getFullYear();
  const { firstFallFrostMs } = frostDatesForYear(year);
  const mine = plantingOccupancy(
    {
      ...placedPlantingFromCrop(current, plugin),
      blockId: target.blockId,
      plantingDateMs: target.plantingDateMs,
      footprint: target.footprint
    },
    plugin,
    { firstFallFrostMs }
  );
  if (!mine) return null;
  for (const other of listCrops({ blockId: target.blockId })) {
    if (other.id === current.id || !other.footprint) continue;
    const theirs = plantingOccupancy(
      placedPlantingFromCrop(other, lookup(other.cropPluginId)),
      lookup(other.cropPluginId),
      { firstFallFrostMs }
    );
    if (!theirs || !intervalsOverlapInTime(mine, theirs)) continue;
    if (!footprintsOverlap(other.footprint, target.footprint)) continue;
    return `No room for ${current.varietyDisplayName} there in ${bedName} on ${shortDate(mine.startMs)}. ${other.varietyDisplayName} holds that spot until ${shortDate(theirs.endMs)}.`;
  }
  return null;
}

export type FootprintWriteResult = { ok: true; response: FootprintWriteResponse } | GardenFailure;

/** The placement to store for a partial write: a typed count survives a
 *  move, resize or date change unless the request sends a new count (or
 *  null to recount), and stored spacing survives unless the request sends
 *  new spacing (or null to clear it). */
export function mergePlacementInput(
  current: Pick<Crop, 'spacingIn' | 'rowSpacingIn' | 'plantCount' | 'plantCountProvenance'>,
  req: PlacementInput
): PlacementInput {
  const keptCount =
    req.footprint && current.plantCountProvenance === 'manual' && current.plantCount != null
      ? current.plantCount
      : null;
  return {
    ...req,
    spacingIn: req.spacingIn === undefined ? (current.spacingIn ?? null) : req.spacingIn,
    rowSpacingIn:
      req.rowSpacingIn === undefined ? (current.rowSpacingIn ?? null) : req.rowSpacingIn,
    plantCount: req.plantCount === undefined ? keptCount : req.plantCount
  };
}

/** Places, moves or clears a planting's spot, and moves its date when
 *  `plantingDateMs` is sent. Moving to another bed is only for plantings
 *  not yet in the ground (`plantingInGround`); a linked succession sowing
 *  keeps its group link and needs a spot that is free for its whole time
 *  in the new bed (`linkedSowingClash`). A date move re-anchors the
 *  planting's tasks (and a group's members when it anchors one) through
 *  `movePlantingDate`; the members that moved come back as `followers`. */
export function writeFootprint(
  cropId: string,
  req: FootprintWriteRequest,
  lookup: CropLookup,
  nowMs: number = Date.now()
): FootprintWriteResult {
  const current = getCrop(cropId);
  if (!current) return gardenFailure(404, 'planting not found');
  const bed = resolveDesignableBed(req.blockId);
  if (isFailure(bed)) return bed;
  if (
    req.blockId !== current.blockId &&
    plantingInGround(
      {
        status: current.status,
        plantingDateMs: current.plantingDate,
        harvestedAtMs: current.harvestedAt ?? null
      },
      nowMs
    )
  ) {
    return gardenFailure(
      409,
      `${current.varietyDisplayName} is already in the ground in ${getBlock(current.blockId)?.name ?? 'its bed'}. Record a new planting instead.`,
      'IN_GROUND'
    );
  }
  if (req.footprint && !footprintInsideBed(req.footprint, bed)) {
    return gardenFailure(400, `That spot runs past the edge of ${bed.block.name}.`, 'OUTSIDE_AREA');
  }
  if (
    req.blockId !== current.blockId &&
    current.groupId &&
    current.groupSystemKind === 'succession'
  ) {
    const clash = linkedSowingClash(
      current,
      {
        blockId: req.blockId,
        footprint: req.footprint,
        plantingDateMs: req.plantingDateMs === undefined ? current.plantingDate : req.plantingDateMs
      },
      bed.block.name,
      lookup
    );
    if (clash) return gardenFailure(409, clash, 'OVERLAP');
  }
  const plugin = lookup(current.cropPluginId);
  const placement = resolvePlacement(mergePlacementInput(current, req), plugin);

  return db.transaction(() => {
    setPlacement(cropId, placement, req.blockId);
    let reanchored: FootprintWriteResponse['reanchored'] = null;
    let followers: PlacedPlanting[] = [];
    if (req.plantingDateMs !== undefined) {
      if (req.plantingDateMs === null) {
        if (current.plantingDate != null) unscheduleCrop(cropId);
      } else if (req.plantingDateMs !== current.plantingDate) {
        const moved = movePlantingDate(cropId, req.plantingDateMs);
        reanchored = moved?.reanchored ?? null;
        followers = (moved?.followers ?? []).map((f) =>
          placedPlantingFromCrop(f, lookup(f.cropPluginId))
        );
      }
    }
    const saved = getCrop(cropId)!;
    return {
      ok: true as const,
      response: {
        planting: placedPlantingFromCrop(saved, plugin),
        reanchored,
        followers,
        warnings: sharedSpaceWarnings(saved, lookup)
      }
    };
  });
}

export type PlantingCreateResult = { ok: true; plantings: PlacedPlanting[] } | GardenFailure;

/** Creates `planned` plantings straight into beds. Every item is checked
 *  before anything is written, so a bad item writes nothing. */
export function createPlacedPlantings(
  items: PlantingCreateRequest['plantings'],
  lookup: CropLookup
): PlantingCreateResult {
  const checked: Array<{ item: (typeof items)[number]; plugin: GardenCrop }> = [];
  for (const item of items) {
    const bed = resolveDesignableBed(item.blockId);
    if (isFailure(bed)) return bed;
    const plugin = lookup(item.cropPluginId);
    if (!plugin) return gardenFailure(400, `unknown crop plugin ${item.cropPluginId}`);
    if (!footprintInsideBed(item.footprint, bed)) {
      return gardenFailure(
        400,
        `${item.varietyDisplayName} runs past the edge of ${bed.block.name}.`,
        'OUTSIDE_AREA'
      );
    }
    checked.push({ item, plugin });
  }
  return db.transaction(() => ({
    ok: true as const,
    plantings: checked.map(({ item, plugin }) =>
      placedPlantingFromCrop(
        createPlanned({
          blockId: item.blockId,
          cropPluginId: item.cropPluginId,
          varietyDisplayName: item.varietyDisplayName,
          plantingDate: item.plantingDateMs,
          placement: resolvePlacement(item, plugin),
          sourceProvenance: item.source === 'manual' ? undefined : item.source
        }),
        plugin
      )
    )
  }));
}
