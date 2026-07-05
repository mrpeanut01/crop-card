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

import { listCrops, type Crop } from '$lib/db/crops';
import { listHarvestEvents } from '$lib/db/harvestEvents';

/** A planting is "resolved" for close-out when its status is a terminal
 *  outcome. `planned` / `active` still block the close. */
const RESOLVED_STATUSES = new Set(['harvested', 'failed', 'archived']);

export interface PlantingResolution {
  cropId: string;
  varietyDisplayName: string;
  blockId: string;
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
  const plantings = listCrops({ year }).map<PlantingResolution>((c) => ({
    cropId: c.id,
    varietyDisplayName: c.varietyDisplayName,
    blockId: c.blockId,
    status: c.status,
    resolved: RESOLVED_STATUSES.has(c.status)
  }));
  const unresolvedCount = plantings.filter((p) => !p.resolved).length;

  const fromMs = new Date(year, 0, 1).getTime();
  const toMs = new Date(year + 1, 0, 1).getTime() - 1;
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
