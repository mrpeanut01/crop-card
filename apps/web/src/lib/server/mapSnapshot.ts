import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { listFields, type FieldWithBlocks } from '$lib/db/fields';
import { listBlocks, type BlockWithPlantings } from '$lib/db/blocks';
import { listCrops } from '$lib/db/crops';
import { listTasks } from '$lib/db/tasks';
import { requireOwnerId } from '$lib/db/tenant';
import { snapshotFrostFromSettings } from '$lib/climate/frostSettings.server';
import { RULES_VERSION } from '$lib/safety/version';
import { snapshotAreas, snapshotBlocks } from '$lib/farm/mapSnapshot';
import {
  FARM_SNAPSHOT_VERSION,
  type FarmSnapshot,
  type SnapshotPlanting
} from '$lib/cards/snapshot';
import { listMapFeatureViews } from '$lib/db/mapFeatures';

const DAY_MS = 86_400_000;
const TASK_HORIZON_DAYS = 30;
const HISTORY_PER_BLOCK = 12;

function ymd(ms: number | null | undefined): string | null {
  return ms == null ? null : new Date(ms).toISOString().slice(0, 10);
}

/**
 * The slice of the offline snapshot the farm map needs: Areas, blocks,
 * plantings (with harvested ones for Bed history), open tasks through the
 * next 30 days and frost dates. Every read goes through the tenant-scoped
 * repos for the active Owner. Equipment, stock and plugins stay empty here.
 */
export function buildMapSnapshot(
  opts: {
    now?: number;
    fields?: FieldWithBlocks[];
    blocks?: BlockWithPlantings[];
  } = {}
): FarmSnapshot {
  const ownerId = requireOwnerId();
  const now = opts.now ?? Date.now();
  const fields = opts.fields ?? listFields();
  const blocks = opts.blocks ?? listBlocks();
  const blockIds = new Set(blocks.map((b) => b.id));

  const owner = db.select({ name: owners.name }).from(owners).where(eq(owners.id, ownerId)).get();

  const perBlockHistory = new Map<string, number>();
  const plantings: SnapshotPlanting[] = [];
  for (const c of listCrops()) {
    if (!blockIds.has(c.blockId)) continue;
    if (c.status !== 'planned' && c.status !== 'active' && c.status !== 'harvested') continue;
    if (c.status === 'harvested') {
      const n = perBlockHistory.get(c.blockId) ?? 0;
      if (n >= HISTORY_PER_BLOCK) continue;
      perBlockHistory.set(c.blockId, n + 1);
    }
    plantings.push({
      id: c.id,
      blockId: c.blockId,
      cropPluginId: c.cropPluginId,
      varietyDisplayName: c.varietyDisplayName,
      status: c.status,
      plantingDate: ymd(c.plantingDate),
      harvestedAt: ymd(c.harvestedAt),
      quantityPlanted: c.quantityPlanted ?? null,
      quantityUnit: c.quantityUnit ?? null,
      spacingIn: null,
      rowSpacingIn: null,
      plantCount: null,
      plantCountProvenance: null,
      sourceProvenance: null
    });
  }

  const tasks = listTasks({ status: 'open', toMs: now + TASK_HORIZON_DAYS * DAY_MS, limit: 500 })
    .filter((t) => !t.supersededByTaskId)
    .map((t) => ({
      id: t.id,
      title: t.title,
      category: null,
      scheduledFor: t.scheduledFor,
      cropId: t.cropId ?? null,
      blockId: t.blockId ?? null,
      equipmentId: t.equipmentId ?? null
    }));

  return {
    version: FARM_SNAPSHOT_VERSION,
    ownerId,
    farmName: owner?.name ?? null,
    generatedAt: now,
    rulesVersion: RULES_VERSION,
    origin: process.env.ORIGIN?.trim().replace(/\/+$/, '') || null,
    areas: snapshotAreas(fields),
    blocks: snapshotBlocks(blocks),
    plantings,
    tasks,
    equipment: [],
    stock: [],
    cropPlugins: {},
    frost: snapshotFrostFromSettings(),
    mapFeatures: listMapFeatureViews()
  };
}
