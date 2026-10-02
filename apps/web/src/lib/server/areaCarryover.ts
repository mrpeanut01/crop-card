/**
 * Phase 33C after-spread lines per block (M-47, M-48, M-65). One cheap read
 * of the spreads first; the chain only loads when some application spread a
 * batch, so farms that never use the feature pay one query.
 */

import { listBatchSpreads, listBioassays, listDismissals } from '$lib/db/amendments';
import { farmTimeZone } from '$lib/db/userProfile';
import { loadCarryoverData } from '$lib/server/amendmentChain';
import { buildCarryoverLines, type CarryoverByBlock } from '$lib/farm/areaCarryover';
import type { CarryoverState } from '$lib/amendments/carryover';
import type { SnapshotCarryoverLine } from '$lib/cards/snapshot';

export async function loadCarryoverLines(now: number = Date.now()): Promise<CarryoverByBlock> {
  const spreads = listBatchSpreads();
  if (spreads.length === 0) return {};
  const data = await loadCarryoverData(now);
  const states = new Map<string, CarryoverState>();
  for (const [id, chain] of data.chains) states.set(id, chain.state);
  const newestInputAt = new Map<string, number>();
  for (const i of data.inputs) {
    const prev = newestInputAt.get(i.batchId);
    if (prev === undefined || i.createdAt > prev) newestInputAt.set(i.batchId, i.createdAt);
  }
  return buildCarryoverLines({
    spreads,
    states,
    batchNames: new Map(data.batches.map((b) => [b.id, b.name])),
    newestInputAt,
    bioassays: listBioassays(),
    dismissedApplicationIds: new Set(listDismissals().map((d) => d.fertilityApplicationId)),
    timeZone: farmTimeZone()
  });
}

/** The offline snapshot's copy (M-52): text only, in block order. */
export function snapshotCarryover(byBlock: CarryoverByBlock): SnapshotCarryoverLine[] {
  return Object.keys(byBlock)
    .sort()
    .flatMap((blockId) => byBlock[blockId].map((l) => ({ blockId, text: l.text, tone: l.tone })));
}

/** A live page's map snapshot with the carryover lines added, so the Area
 *  Card, Block cards and Planting cards built from it show them. */
export async function withLiveCarryover<T extends { carryover?: SnapshotCarryoverLine[] }>(
  snapshot: T,
  now: number = Date.now()
): Promise<T> {
  const lines = snapshotCarryover(await loadCarryoverLines(now));
  return lines.length ? { ...snapshot, carryover: lines } : snapshot;
}
