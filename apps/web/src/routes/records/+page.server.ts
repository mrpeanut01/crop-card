import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { recordsApproachingRetention } from '$lib/db/sprayEvents';
import { listSprayers } from '$lib/server/sprayers';
import {
  RECORD_KINDS,
  listUnifiedRecords,
  summarizeUnifiedRecords,
  type RecordKind
} from '$lib/db/recordsUnified';

/**
 * Sprint 2 (#155-162, #195) — unified Records page loader.
 *
 * The legacy spray-only loader unioned `listSprayEvents` straight into
 * the page. The Almanac design treats /records as a 9-kind audit ledger;
 * `listUnifiedRecords` is the new source of truth. The sprayer filter is
 * preserved for back-compat (still used by `/records/pending` and the
 * existing CSV/PDF exports), but the table itself is no longer
 * spray-only.
 */
export const load: PageServerLoad = async ({ url }) => {
  const sprayerId = url.searchParams.get('sprayerId') ?? undefined;
  const blockId = url.searchParams.get('blockId') ?? undefined;
  const fromMsRaw = url.searchParams.get('from');
  const toMsRaw = url.searchParams.get('to');
  const fromMs = fromMsRaw ? Date.parse(fromMsRaw) : undefined;
  const toMs = toMsRaw ? Date.parse(toMsRaw) + 24 * 60 * 60 * 1000 - 1 : undefined;

  const kindsParam = url.searchParams.get('kinds');
  const activeKinds: RecordKind[] = kindsParam
    ? (kindsParam
        .split(',')
        .filter((k) => (RECORD_KINDS as readonly string[]).includes(k)) as RecordKind[])
    : [...RECORD_KINDS];

  const allRecords = listUnifiedRecords({
    blockId,
    fromMs: Number.isFinite(fromMs) ? fromMs : undefined,
    toMs: Number.isFinite(toMs) ? toMs : undefined
  });

  // Filter chips operate over the already-fetched superset so the
  // count chips stay accurate when the operator toggles them.
  const filteredRecords = allRecords.filter((r) => activeKinds.includes(r.kind));

  const summary = summarizeUnifiedRecords(allRecords);
  const approaching = recordsApproachingRetention();

  return {
    records: filteredRecords,
    summary,
    approachingRetention: approaching.map((e) => e.id),
    sprayers: listSprayers(),
    blocks: listBlocks(),
    activeSprayerId: sprayerId ?? null,
    activeBlockId: blockId ?? null,
    activeKinds,
    activeFromIso: fromMsRaw ?? null,
    activeToIso: toMsRaw ?? null
  };
};
