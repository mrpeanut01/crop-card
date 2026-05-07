/**
 * Block + planting-record repo. A block is a named field area; planting
 * records associate a crop variety + planting date with a block. The Safety
 * Kernel evaluates against the union of crops present in a block.
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { blocks, plantingRecords } from './schema';

export interface Block {
  id: string;
  name: string;
  acres?: number;
  blockLabel?: string;
  /** GeoJSON Polygon or MultiPolygon (Phase 10 GPS stub). */
  geometryGeojson?: string;
}

export interface PlantingRecord {
  id: string;
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  plantingDate: number;
}

export interface BlockWithPlantings extends Block {
  plantings: PlantingRecord[];
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
      plantingDate: p.plantingDate.getTime()
    });
    grouped.set(p.blockId, list);
  }
  return blockRows.map((b) => ({
    id: b.id,
    name: b.name,
    acres: b.acres ?? undefined,
    blockLabel: b.blockLabel ?? undefined,
    geometryGeojson: b.geometryGeojson ?? undefined,
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
      plantingDate: p.plantingDate.getTime()
    }));
  return {
    id: row.id,
    name: row.name,
    acres: row.acres ?? undefined,
    blockLabel: row.blockLabel ?? undefined,
    geometryGeojson: row.geometryGeojson ?? undefined,
    plantings
  };
}

export function createBlock(input: {
  name: string;
  acres?: number;
  blockLabel?: string;
  geometryGeojson?: string;
}): Block {
  const id = randomUUID();
  const row = db
    .insert(blocks)
    .values({
      id,
      name: input.name,
      acres: input.acres ?? null,
      blockLabel: input.blockLabel ?? null,
      geometryGeojson: input.geometryGeojson ?? null
    })
    .returning()
    .get();
  return {
    id: row.id,
    name: row.name,
    acres: row.acres ?? undefined,
    blockLabel: row.blockLabel ?? undefined,
    geometryGeojson: row.geometryGeojson ?? undefined
  };
}

/** Update a block's GeoJSON geometry (Phase 10 GPS stub). */
export function setBlockGeometry(blockId: string, geometryGeojson: string | null): Block | undefined {
  const row = db
    .update(blocks)
    .set({ geometryGeojson })
    .where(eq(blocks.id, blockId))
    .returning()
    .get();
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    acres: row.acres ?? undefined,
    blockLabel: row.blockLabel ?? undefined,
    geometryGeojson: row.geometryGeojson ?? undefined
  };
}

export function addPlanting(input: {
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  plantingDate: number;
}): PlantingRecord {
  const id = randomUUID();
  const row = db
    .insert(plantingRecords)
    .values({
      id,
      blockId: input.blockId,
      cropPluginId: input.cropPluginId,
      varietyDisplayName: input.varietyDisplayName,
      plantingDate: new Date(input.plantingDate)
    })
    .returning()
    .get();
  return {
    id: row.id,
    blockId: row.blockId,
    cropPluginId: row.cropPluginId,
    varietyDisplayName: row.varietyDisplayName,
    plantingDate: row.plantingDate.getTime()
  };
}

export function deleteBlock(id: string): boolean {
  // Plantings cascade only if FK ON DELETE CASCADE is set; we delete manually.
  db.delete(plantingRecords).where(eq(plantingRecords.blockId, id)).run();
  const result = db.delete(blocks).where(eq(blocks.id, id)).run();
  return result.changes > 0;
}
