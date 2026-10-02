/** Phase 33C (M-41): the payload for /inventory/amendment/[id]. */

import { error } from '@sveltejs/kit';
import { getBatch, listAmendmentLots, listBioassays, listBatchSpreads } from '$lib/db/amendments';
import { listAnimals } from '$lib/db/animals';
import { listAnimalGroups } from '$lib/db/animalGroups';
import { animalLabel } from '$lib/animals/display';
import { AMENDMENT_LOT_CATEGORIES } from '$lib/amendments/model';
import { batchReaches } from '$lib/amendments/carryover';
import { canMutate, type SessionRole } from '$lib/server/session';
import { loadCarryoverData, lotLabel } from './amendmentChain';
import { batchView, dayContext, type BatchView } from './amendmentRoutes';

export interface AmendmentOption {
  id: string;
  label: string;
}

export interface AmendmentBioassayView {
  id: string;
  testedAt: number;
  result: 'no-damage' | 'damage';
  note: string | null;
  /** The block's name for a test on a spread block; null for the batch. */
  blockName: string | null;
}

export interface AmendmentDetailPayload {
  type: 'amendment';
  batch: BatchView;
  bioassays: AmendmentBioassayView[];
  spreads: Array<{ applicationId: string; blockId: string; blockName: string; occurredAt: number }>;
  options: {
    animals: AmendmentOption[];
    groups: AmendmentOption[];
    batches: AmendmentOption[];
    lots: AmendmentOption[];
  };
  canEdit: boolean;
  canDeleteInputs: boolean;
  today: string;
}

export async function amendmentDetail(
  id: string,
  role: SessionRole | undefined
): Promise<AmendmentDetailPayload> {
  const batch = getBatch(id);
  if (!batch) throw error(404, 'batch not found');
  const data = await loadCarryoverData();
  const ctx = dayContext();
  const view = batchView(data, batch, ctx.timeZone);
  const spreads = listBatchSpreads(batch.id).map((s) => ({
    applicationId: s.applicationId,
    blockId: s.blockId,
    blockName: data.names.blocks.get(s.blockId) ?? 'A block no longer on file',
    occurredAt: s.occurredAt
  }));
  const spreadBlocks = new Set(spreads.map((s) => s.blockId));
  const bioassays: AmendmentBioassayView[] = [
    ...listBioassays({ batchId: batch.id }).map((b) => ({ ...b, blockName: null })),
    ...[...spreadBlocks].flatMap((blockId) =>
      listBioassays({ blockId }).map((b) => ({
        ...b,
        blockName: data.names.blocks.get(blockId) ?? 'A block'
      }))
    )
  ]
    .map((b) => ({
      id: b.id,
      testedAt: b.testedAt,
      result: b.result,
      note: b.note,
      blockName: b.blockName
    }))
    .sort((a, b) => b.testedAt - a.testedAt);
  return {
    type: 'amendment',
    batch: view,
    bioassays,
    spreads,
    options: {
      animals: listAnimals({ status: 'active' }).map((a) => ({ id: a.id, label: animalLabel(a) })),
      groups: listAnimalGroups({ status: 'active' }).map((g) => ({ id: g.id, label: g.name })),
      batches: data.batches
        .filter((b) => b.id !== batch.id && !batchReaches(data.inputs, b.id, batch.id))
        .map((b) => ({ id: b.id, label: b.name })),
      lots: listAmendmentLots(AMENDMENT_LOT_CATEGORIES).map((l) => ({
        id: l.id,
        label: lotLabel(l)
      }))
    },
    canEdit: !!role && canMutate(role),
    canDeleteInputs: role === 'owner',
    today: ctx.today
  };
}
