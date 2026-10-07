/**
 * UC-44 — Season close-out preflight (server side, #349).
 *
 * Computes the three-check preflight state the /settings/season/close-out
 * route renders and the /api/season/close endpoint re-verifies before writing
 * the `season_closeouts` row. Server-only (funnels through tenant-scoped
 * repos). The client attests the offline pending count (Dexie is client-only);
 * the two server-verifiable checks — plantings resolved + harvest roll-up —
 * are computed here so a hand-crafted POST can't skip them.
 */

import { farmTimeZone } from '$lib/db/userProfile';
import { localDayStartMs } from '$lib/safety/animalWithdrawal';
import { listBlocks } from '$lib/db/blocks';
import { db } from '$lib/db/client';
import { listCrops, updateStatus, type Crop } from '$lib/db/crops';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { isSeasonClosed } from '$lib/db/seasonCloseouts';

/** A planting is "resolved" for close-out when its status is a terminal
 *  outcome. `planned` / `active` still block the close. */
const RESOLVED_STATUSES = new Set(['harvested', 'failed', 'archived']);

export interface PlantingResolution {
  cropId: string;
  varietyDisplayName: string;
  cropPluginId: string;
  blockId: string;
  blockName: string | null;
  plantingDate: number | null;
  status: Crop['status'];
  resolved: boolean;
}

export interface HarvestRollup {
  eventCount: number;
  /** Per-crop-plugin event tallies, for the attestation summary. */
  byCropPlugin: Record<string, number>;
}

export interface CloseoutPreflight {
  year: number;
  plantings: PlantingResolution[];
  unresolvedCount: number;
  plantingsResolved: boolean;
  harvest: HarvestRollup;
}

/**
 * Build the server-verifiable half of the preflight for `year`. The pending
 * (offline queue) check is client-attested and passed in separately at close
 * time — it is not computable here.
 */
export function buildCloseoutPreflight(year: number): CloseoutPreflight {
  const blockNames = new Map(listBlocks({ plantings: 'none' }).map((b) => [b.id, b.name]));
  const plantings = listCrops({ year }).map<PlantingResolution>((c) => ({
    cropId: c.id,
    varietyDisplayName: c.varietyDisplayName,
    cropPluginId: c.cropPluginId,
    blockId: c.blockId,
    blockName: blockNames.get(c.blockId) ?? null,
    plantingDate: c.plantingDate,
    status: c.status,
    resolved: RESOLVED_STATUSES.has(c.status)
  }));
  const unresolvedCount = plantings.filter((p) => !p.resolved).length;

  const tz = farmTimeZone();
  const fromMs = localDayStartMs(`${year}-01-01`, tz) ?? Date.UTC(year, 0, 1);
  const toMs = (localDayStartMs(`${year + 1}-01-01`, tz) ?? Date.UTC(year + 1, 0, 1)) - 1;
  const events = listHarvestEvents({ fromMs, toMs });
  const byCropPlugin: Record<string, number> = {};
  for (const e of events) {
    byCropPlugin[e.cropPluginId] = (byCropPlugin[e.cropPluginId] ?? 0) + 1;
  }

  return {
    year,
    plantings,
    unresolvedCount,
    plantingsResolved: unresolvedCount === 0,
    harvest: { eventCount: events.length, byCropPlugin }
  };
}

export const BULK_RESOLVE_STATUSES = ['harvested', 'failed', 'archived'] as const;
export type BulkResolveStatus = (typeof BULK_RESOLVE_STATUSES)[number];

export type BulkResolveResult =
  | { ok: true; resolved: string[]; skipped: string[] }
  | { ok: false; code: 'SEASON_CLOSED'; year: number };

/**
 * Resolve many of `year`'s still planned or active plantings at once, in one
 * transaction, through the same status write as a single planting (#754).
 * Ids that are not this farm's, not in `year` or already resolved are
 * skipped, never changed. The status time is now, or the last moment of
 * `year` when closing a past season, so it stays inside the season.
 */
export function bulkResolvePlantings(
  year: number,
  cropIds: readonly string[],
  status: BulkResolveStatus,
  nowMs: number = Date.now()
): BulkResolveResult {
  if (isSeasonClosed(year)) return { ok: false, code: 'SEASON_CLOSED', year };
  const tz = farmTimeZone();
  const yearEnd = (localDayStartMs(`${year + 1}-01-01`, tz) ?? Date.UTC(year + 1, 0, 1)) - 1;
  const occurredAt = Math.min(nowMs, yearEnd);
  const open = new Map(
    listCrops({ year })
      .filter((c) => !RESOLVED_STATUSES.has(c.status))
      .map((c) => [c.id, c])
  );
  const wanted = [...new Set(cropIds)];
  const resolved = wanted.filter((id) => open.has(id));
  const skipped = wanted.filter((id) => !open.has(id));
  db.transaction(() => {
    for (const id of resolved) updateStatus(id, status, occurredAt);
  });
  return { ok: true, resolved, skipped };
}
