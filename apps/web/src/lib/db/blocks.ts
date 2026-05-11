/**
 * Block + planting-record repo. A block is a named field area; planting
 * records associate a crop variety + planting date with a block. The Safety
 * Kernel evaluates against the union of crops present in a block.
 *
 * Phase 13: blocks now belong to a Field (auto "Home Field" for single-field
 * users). On creation, an unspecified fieldId resolves via ensureHomeField().
 *
 * Phase 14 (swim-lane): blocks carry `eastWestIndex` / `northSouthIndex`
 * dense ranks computed from `geometryGeojson` centroid. Convention is
 * documented in the schema (E increases east, N increases north).
 */

import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from './client';
import { ensureHomeField } from './fields';
import { blocks, plantingRecords } from './schema';
import { geojsonAreaAcres } from '$lib/geo/area';

export type TillageMethod = 'conventional' | 'reduced-till' | 'no-till';
export type SunExposure = 'full' | 'partial' | 'shade';

export interface Block {
  id: string;
  name: string;
  acres?: number;
  blockLabel?: string;
  fieldId?: string;
  /** GeoJSON Polygon or MultiPolygon (Phase 10 GPS stub). */
  geometryGeojson?: string;
  tillageMethod: TillageMethod;
  /** Phase 14: increases going east; null for blocks without geometry
   *  (caller falls back to alphabetical name). */
  eastWestIndex?: number;
  /** Phase 14: increases going north. */
  northSouthIndex?: number;
  /** Phase 14: when true, `inferBlockAxes` won't overwrite this row's
   *  indices on subsequent writes. */
  axesLocked: boolean;
  sunExposure?: SunExposure;
  /** v1.3 shade model — slope steepness, percent (0–100). */
  slopePercent?: number;
  /** v1.3 shade model — downhill-facing aspect (0–360 compass bearing). */
  slopeAspectDeg?: number;
}

export interface PlantingRecord {
  id: string;
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  plantingDate: number | null;
  /** Phase 14a: quantity allocated to this planting (e.g. 0.5 lb of corn). */
  quantityPlanted?: number;
  quantityUnit?: string;
}

export interface BlockWithPlantings extends Block {
  plantings: PlantingRecord[];
}

/**
 * Compute the canonical acres for a block: when geometry exists, the polygon
 * area wins over any manually-entered `acres` column value. Returns `null`
 * when geometry is absent or unparseable; callers fall back to `row.acres`.
 *
 * Centralised here so the manual-acres-then-draw-polygon case (Block created
 * in /plan?tab=layout, geometry drawn after) works in every consumer
 * without each page having to remember to call `geojsonAreaAcres` itself.
 */
export function effectiveAcresFor(input: {
  acres: number | null | undefined;
  geometryGeojson: string | null | undefined;
}): number | undefined {
  const fromGeo = geojsonAreaAcres(input.geometryGeojson ?? null);
  if (fromGeo !== null && Number.isFinite(fromGeo) && fromGeo > 0) return fromGeo;
  return input.acres == null ? undefined : input.acres;
}

function rowToBlock(row: typeof blocks.$inferSelect): Block {
  return {
    id: row.id,
    name: row.name,
    acres: effectiveAcresFor({ acres: row.acres, geometryGeojson: row.geometryGeojson }),
    blockLabel: row.blockLabel ?? undefined,
    fieldId: row.fieldId ?? undefined,
    geometryGeojson: row.geometryGeojson ?? undefined,
    tillageMethod: (row.tillageMethod ?? 'conventional') as TillageMethod,
    eastWestIndex: row.eastWestIndex ?? undefined,
    northSouthIndex: row.northSouthIndex ?? undefined,
    axesLocked: row.axesLocked ?? false,
    sunExposure: (row.sunExposure as SunExposure | null) ?? undefined,
    slopePercent: row.slopePercent ?? undefined,
    slopeAspectDeg: row.slopeAspectDeg ?? undefined
  };
}

export function listBlocks(): BlockWithPlantings[] {
  const blockRows = db.select().from(blocks).all();
  if (blockRows.length === 0) return [];
  const all = db.select().from(plantingRecords).all();
  const grouped = new Map<string, PlantingRecord[]>();
  for (const p of all) {
    const list = grouped.get(p.blockId) ?? [];
    list.push({
      id: p.id,
      blockId: p.blockId,
      cropPluginId: p.cropPluginId,
      varietyDisplayName: p.varietyDisplayName,
      plantingDate: p.plantingDate?.getTime() ?? null,
      quantityPlanted:
        p.quantityPlantedHundredths != null ? p.quantityPlantedHundredths / 100 : undefined,
      quantityUnit: p.quantityUnit ?? undefined
    });
    grouped.set(p.blockId, list);
  }
  return blockRows.map((b) => ({
    ...rowToBlock(b),
    plantings: grouped.get(b.id) ?? []
  }));
}

export function getBlock(id: string): BlockWithPlantings | undefined {
  const row = db.select().from(blocks).where(eq(blocks.id, id)).get();
  if (!row) return undefined;
  const plantings = db
    .select()
    .from(plantingRecords)
    .where(eq(plantingRecords.blockId, id))
    .all()
    .map((p) => ({
      id: p.id,
      blockId: p.blockId,
      cropPluginId: p.cropPluginId,
      varietyDisplayName: p.varietyDisplayName,
      plantingDate: p.plantingDate?.getTime() ?? null,
      quantityPlanted:
        p.quantityPlantedHundredths != null ? p.quantityPlantedHundredths / 100 : undefined,
      quantityUnit: p.quantityUnit ?? undefined
    }));
  return { ...rowToBlock(row), plantings };
}

export function createBlock(input: {
  name: string;
  acres?: number;
  blockLabel?: string;
  fieldId?: string;
  geometryGeojson?: string;
  tillageMethod?: TillageMethod;
  sunExposure?: SunExposure;
  /** Manual override; if provided, axes are written and locked. */
  eastWestIndex?: number;
  northSouthIndex?: number;
}): Block {
  const id = randomUUID();
  const fieldId = input.fieldId ?? ensureHomeField();
  const acresToPersist =
    effectiveAcresFor({ acres: input.acres, geometryGeojson: input.geometryGeojson }) ?? null;
  const row = db
    .insert(blocks)
    .values({
      id,
      name: input.name,
      acres: acresToPersist,
      blockLabel: input.blockLabel ?? null,
      fieldId,
      geometryGeojson: input.geometryGeojson ?? null,
      tillageMethod: input.tillageMethod ?? 'conventional',
      sunExposure: input.sunExposure ?? null,
      eastWestIndex: input.eastWestIndex ?? null,
      northSouthIndex: input.northSouthIndex ?? null,
      axesLocked: input.eastWestIndex !== undefined || input.northSouthIndex !== undefined
    })
    .returning()
    .get();
  // Recompute axes for any block that didn't get a manual override and isn't
  // locked. Single batched UPDATE; safe to call after every write.
  recomputeBlockAxes();
  // Re-read so the caller sees the (possibly updated) indices.
  const fresh = db.select().from(blocks).where(eq(blocks.id, id)).get();
  return fresh ? rowToBlock(fresh) : rowToBlock(row);
}

/** Update a block's GeoJSON geometry (Phase 10 GPS stub). When geometry is
 *  set, the `acres` column is recomputed to match the polygon area so raw
 *  SQL queries / exports / the sync queue all see a truthful value without
 *  having to call `geojsonAreaAcres` themselves. When geometry is cleared
 *  (`null`), the prior manual `acres` column is preserved. */
export function setBlockGeometry(
  blockId: string,
  geometryGeojson: string | null
): Block | undefined {
  const update: { geometryGeojson: string | null; acres?: number } = { geometryGeojson };
  const fromGeo = geojsonAreaAcres(geometryGeojson);
  if (fromGeo !== null && Number.isFinite(fromGeo) && fromGeo > 0) {
    update.acres = fromGeo;
  }
  const row = db
    .update(blocks)
    .set(update)
    .where(eq(blocks.id, blockId))
    .returning()
    .get();
  if (!row) return undefined;
  recomputeBlockAxes();
  const fresh = db.select().from(blocks).where(eq(blocks.id, blockId)).get();
  return fresh ? rowToBlock(fresh) : rowToBlock(row);
}

/** Phase 13 / Phase 14: edit name/acres/blockLabel/fieldId/tillageMethod/
 *  sunExposure/axes. Manual axis edits set `axesLocked = true`. */
export function updateBlock(
  id: string,
  patch: {
    name?: string;
    acres?: number | null;
    blockLabel?: string | null;
    fieldId?: string;
    tillageMethod?: TillageMethod;
    sunExposure?: SunExposure | null;
    eastWestIndex?: number | null;
    northSouthIndex?: number | null;
    axesLocked?: boolean;
    slopePercent?: number | null;
    slopeAspectDeg?: number | null;
  }
): Block | undefined {
  const set: Partial<typeof blocks.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.acres !== undefined) set.acres = patch.acres;
  if (patch.blockLabel !== undefined) set.blockLabel = patch.blockLabel;
  if (patch.fieldId !== undefined) set.fieldId = patch.fieldId;
  if (patch.tillageMethod !== undefined) set.tillageMethod = patch.tillageMethod;
  if (patch.sunExposure !== undefined) set.sunExposure = patch.sunExposure;
  if (patch.slopePercent !== undefined) set.slopePercent = patch.slopePercent;
  if (patch.slopeAspectDeg !== undefined) set.slopeAspectDeg = patch.slopeAspectDeg;
  const axisManualEdit =
    patch.eastWestIndex !== undefined || patch.northSouthIndex !== undefined;
  if (patch.eastWestIndex !== undefined) set.eastWestIndex = patch.eastWestIndex;
  if (patch.northSouthIndex !== undefined) set.northSouthIndex = patch.northSouthIndex;
  if (patch.axesLocked !== undefined) set.axesLocked = patch.axesLocked;
  else if (axisManualEdit) set.axesLocked = true;
  if (Object.keys(set).length === 0) {
    const cur = db.select().from(blocks).where(eq(blocks.id, id)).get();
    return cur ? rowToBlock(cur) : undefined;
  }
  const row = db.update(blocks).set(set).where(eq(blocks.id, id)).returning().get();
  if (!row) return undefined;
  recomputeBlockAxes();
  const fresh = db.select().from(blocks).where(eq(blocks.id, id)).get();
  return fresh ? rowToBlock(fresh) : rowToBlock(row);
}

export function addPlanting(input: {
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  plantingDate: number | null;
  quantityPlanted?: number;
  quantityUnit?: string;
}): PlantingRecord {
  // If the new planting is a tray-bucket entry (planned status, no date),
  // merge into an existing matching planned row on the same block instead of
  // creating a duplicate. Same crop plugin + same unit = same bucket; we add
  // quantities. Different units fall through to a fresh insert.
  if (input.plantingDate === null && input.quantityPlanted !== undefined) {
    const conds = [
      eq(plantingRecords.blockId, input.blockId),
      eq(plantingRecords.cropPluginId, input.cropPluginId),
      eq(plantingRecords.status, 'planned'),
      isNull(plantingRecords.plantingDate)
    ];
    if (input.quantityUnit) {
      conds.push(eq(plantingRecords.quantityUnit, input.quantityUnit));
    } else {
      conds.push(isNull(plantingRecords.quantityUnit));
    }
    const existing = db
      .select()
      .from(plantingRecords)
      .where(and(...conds))
      .limit(1)
      .get();
    if (existing) {
      const addHundredths = Math.round(input.quantityPlanted * 100);
      const updated = db
        .update(plantingRecords)
        .set({
          quantityPlantedHundredths: sql`COALESCE(${plantingRecords.quantityPlantedHundredths}, 0) + ${addHundredths}`
        })
        .where(eq(plantingRecords.id, existing.id))
        .returning()
        .get();
      return {
        id: updated.id,
        blockId: updated.blockId,
        cropPluginId: updated.cropPluginId,
        varietyDisplayName: updated.varietyDisplayName,
        plantingDate: updated.plantingDate?.getTime() ?? null
      };
    }
  }

  const id = randomUUID();
  const row = db
    .insert(plantingRecords)
    .values({
      id,
      blockId: input.blockId,
      cropPluginId: input.cropPluginId,
      varietyDisplayName: input.varietyDisplayName,
      plantingDate: input.plantingDate !== null ? new Date(input.plantingDate) : null,
      status: input.plantingDate === null ? 'planned' : 'active',
      quantityPlantedHundredths:
        input.quantityPlanted !== undefined ? Math.round(input.quantityPlanted * 100) : null,
      quantityUnit: input.quantityUnit ?? null
    })
    .returning()
    .get();
  return {
    id: row.id,
    blockId: row.blockId,
    cropPluginId: row.cropPluginId,
    varietyDisplayName: row.varietyDisplayName,
    plantingDate: row.plantingDate?.getTime() ?? null
  };
}

export function deleteBlock(id: string): boolean {
  // Plantings cascade only if FK ON DELETE CASCADE is set; we delete manually.
  db.delete(plantingRecords).where(eq(plantingRecords.blockId, id)).run();
  const result = db.delete(blocks).where(eq(blocks.id, id)).run();
  recomputeBlockAxes();
  return result.changes > 0;
}

// ─── Phase 14: axis inference from geometry centroid ────────────────────

/** Compute polygon-or-multipolygon centroid as a simple lon/lat mean of
 *  the outer ring vertices. Good enough for ranking; we never use it for
 *  area math. */
export function geometryCentroid(geojson: string): { lon: number; lat: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(geojson);
  } catch {
    return null;
  }
  const coords = extractOuterRing(parsed);
  if (!coords || coords.length === 0) return null;
  let sumLon = 0;
  let sumLat = 0;
  for (const [lon, lat] of coords) {
    sumLon += lon;
    sumLat += lat;
  }
  return { lon: sumLon / coords.length, lat: sumLat / coords.length };
}

function extractOuterRing(g: unknown): [number, number][] | null {
  if (!g || typeof g !== 'object') return null;
  const obj = g as Record<string, unknown>;
  const type = obj.type;
  if (type === 'Feature') return extractOuterRing(obj.geometry);
  if (type === 'Polygon') {
    const coords = obj.coordinates as unknown;
    if (Array.isArray(coords) && Array.isArray(coords[0])) {
      return (coords[0] as unknown[]).filter(isLonLat) as [number, number][];
    }
  }
  if (type === 'MultiPolygon') {
    const coords = obj.coordinates as unknown;
    if (Array.isArray(coords) && Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
      return (coords[0][0] as unknown[]).filter(isLonLat) as [number, number][];
    }
  }
  return null;
}

function isLonLat(v: unknown): boolean {
  return Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
}

/** Pure: rank an array of blocks into dense E/N indices. Locked blocks
 *  keep whatever index they already had; unlocked blocks are re-ranked
 *  among themselves so the relative order matches centroid order. */
export function inferBlockAxes(
  all: ReadonlyArray<Block>
): Map<string, { east: number | null; north: number | null }> {
  const out = new Map<string, { east: number | null; north: number | null }>();
  for (const b of all) {
    out.set(b.id, {
      east: b.eastWestIndex ?? null,
      north: b.northSouthIndex ?? null
    });
  }
  const candidates = all
    .filter((b) => !b.axesLocked && b.geometryGeojson)
    .map((b) => {
      const c = geometryCentroid(b.geometryGeojson!);
      return c ? { id: b.id, lon: c.lon, lat: c.lat } : null;
    })
    .filter((x): x is { id: string; lon: number; lat: number } => x !== null);
  if (candidates.length === 0) return out;

  const eastSorted = [...candidates].sort((a, b) => a.lon - b.lon);
  const northSorted = [...candidates].sort((a, b) => a.lat - b.lat);
  eastSorted.forEach((c, i) => {
    const cur = out.get(c.id)!;
    cur.east = i;
  });
  northSorted.forEach((c, i) => {
    const cur = out.get(c.id)!;
    cur.north = i;
  });
  return out;
}

/** Read all blocks, compute axes via `inferBlockAxes`, persist any changed
 *  rows. Idempotent; safe to call after every block-mutating write. */
export function recomputeBlockAxes(): void {
  const rows = db.select().from(blocks).all().map(rowToBlock);
  const next = inferBlockAxes(rows);
  for (const b of rows) {
    if (b.axesLocked) continue;
    const want = next.get(b.id);
    if (!want) continue;
    if (want.east !== (b.eastWestIndex ?? null) || want.north !== (b.northSouthIndex ?? null)) {
      db.update(blocks)
        .set({ eastWestIndex: want.east, northSouthIndex: want.north })
        .where(eq(blocks.id, b.id))
        .run();
    }
  }
}
