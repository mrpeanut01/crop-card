import { and, eq, gte, isNotNull, lte, or } from 'drizzle-orm';
import { db } from './client';
import { blocks, crops } from './schema';
import { withTenant } from './tenant';
import { currentPlantingsCutoff } from './blocks';
import type { AreaPlanting } from '$lib/animals/toxicAdjacency';

/**
 * Crops in the ground on each Area of the active Owner, for the toxic-plant
 * advisory (Phase 32D, D5). A planting counts when it is active, or planned
 * with a planting date that has come, or harvested since Jan 1 of last year
 * (plants and residue stay after a harvest). Failed, archived and undated
 * plans do not count. Blocks with no Area are left out.
 */
export function plantsInGroundByArea(now: number = Date.now()): AreaPlanting[] {
  const blockAreas = new Map(
    db
      .select({ id: blocks.id, fieldId: blocks.fieldId })
      .from(blocks)
      .where(withTenant(blocks, isNotNull(blocks.fieldId)))
      .all()
      .map((b) => [b.id, b.fieldId as string])
  );
  if (blockAreas.size === 0) return [];
  const rows = db
    .select({ blockId: crops.blockId, cropPluginId: crops.cropPluginId })
    .from(crops)
    .where(
      withTenant(
        crops,
        or(
          eq(crops.status, 'active'),
          and(eq(crops.status, 'planned'), lte(crops.plantingDate, new Date(now))),
          and(
            eq(crops.status, 'harvested'),
            gte(crops.plantingDate, new Date(currentPlantingsCutoff(now)))
          )
        )
      )
    )
    .all();
  const out: AreaPlanting[] = [];
  for (const r of rows) {
    const areaId = blockAreas.get(r.blockId);
    if (areaId) out.push({ areaId, cropPluginId: r.cropPluginId });
  }
  return out;
}
