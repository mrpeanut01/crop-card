import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { recordsApproachingRetention } from '$lib/db/sprayEvents';
import { listSprayers } from '$lib/server/sprayers';
import { listYearsWithCrops } from '$lib/db/crops';
import { requireUser } from '$lib/server/auth';
import { buildYearSummary } from '$lib/records/yearSummary.server';
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
export const load: PageServerLoad = async (event) => {
  const { url } = event;
  const user = requireUser(event);
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

  // UC-46 — Year in review. Deterministic aggregate for the selected year.
  // The year selector defaults to the current calendar year; the option
  // list unions the current year with every year that has planting data.
  const currentYear = new Date().getFullYear();
  const yearParamRaw = url.searchParams.get('year');
  const selectedYear =
    yearParamRaw && /^\d{4}$/.test(yearParamRaw) ? Number(yearParamRaw) : currentYear;
  const availableYears = Array.from(
    new Set<number>([currentYear, ...listYearsWithCrops(), selectedYear])
  ).sort((a, b) => b - a);
  const yearSummary = await buildYearSummary(selectedYear, user.activeOwnerId);

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
    activeToIso: toMsRaw ?? null,
    yearSummary,
    selectedYear,
    availableYears
  };
};
