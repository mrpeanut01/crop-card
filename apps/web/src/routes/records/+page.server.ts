import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { listSprayEvents, recordsApproachingRetention } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { complianceChromeLevel } from '$lib/records/complianceChrome';
import { getFarmProfile } from '$lib/onboarding/state.server';
import { listSprayers } from '$lib/server/sprayers';
import { hasSoilTest } from '$lib/db/fertility';
import { listYearsWithCrops } from '$lib/db/crops';
import { requireUser } from '$lib/server/auth';
import { buildYearSummary } from '$lib/records/yearSummary.server';
import { prefsFor } from '$lib/db/userProfile';
import { parseExportDateRange } from '$lib/exports/dateRange';
import { todayYmd } from '$lib/prefs';
import { pageOf, parseShow } from '$lib/records/pagination';
import { listIrrigationEvents } from '$lib/db/irrigation';
import { listFields } from '$lib/db/fields';
import { farmOrganicChrome } from '$lib/organic/status.server';
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
  const prefs = prefsFor(user.id);
  const sprayerId = url.searchParams.get('sprayerId') ?? undefined;
  const blockId = url.searchParams.get('blockId') ?? undefined;
  const fromMsRaw = url.searchParams.get('from');
  const toMsRaw = url.searchParams.get('to');
  const { fromMs, toMs } = parseExportDateRange(url.searchParams, prefs);

  const kindsParam = url.searchParams.get('kinds');
  const activeKinds: RecordKind[] = kindsParam
    ? (kindsParam
        .split(',')
        .filter((k) => (RECORD_KINDS as readonly string[]).includes(k)) as RecordKind[])
    : [...RECORD_KINDS];

  const allRecords = listUnifiedRecords({ blockId, fromMs, toMs }, prefs);

  // Filter chips operate over the already-fetched superset so the
  // count chips stay accurate when the operator toggles them.
  const filteredRecords = allRecords.filter((r) => activeKinds.includes(r.kind));
  const show = parseShow(url.searchParams.get('show'));
  const page = pageOf(filteredRecords, show);

  const summary = summarizeUnifiedRecords(allRecords, prefs);
  const approaching = recordsApproachingRetention();

  // UC-46 — Year in review. Deterministic aggregate for the selected year.
  // The year selector defaults to the current calendar year; the option
  // list unions the current year with every year that has planting data.
  const currentYear = Number(todayYmd(prefs).slice(0, 4));
  const yearParamRaw = url.searchParams.get('year');
  const selectedYear =
    yearParamRaw && /^\d{4}$/.test(yearParamRaw) ? Number(yearParamRaw) : currentYear;
  const availableYears = Array.from(
    new Set<number>([currentYear, ...listYearsWithCrops(), selectedYear])
  ).sort((a, b) => b - a);
  const yearSummary = await buildYearSummary(selectedYear, user.activeOwnerId, prefs, {
    includeCosts: user.role === 'owner'
  });

  const chrome = complianceChromeLevel(getFarmProfile(), {
    sprays: listSprayEvents({ limit: 1 }).length,
    insecticides: listInsecticideEvents({ limit: 1 }).length,
    fungicides: listFungicideEvents({ limit: 1 }).length
  });

  const blocks = listBlocks();
  const soilNudgePlaces =
    chrome === 'quiet' && user.role === 'owner' && blocks.length > 0 && !hasSoilTest()
      ? blocks.map((b) => ({ id: b.id, name: b.name }))
      : null;

  // Phase 32E (E4-14): watering logs are a light record, listed only
  // behind their own chip and never counted with the compliance ledger.
  const wateringActive = url.searchParams.get('watering') === '1';
  const wateringRows = listIrrigationEvents({ fromMs, toMs, limit: 200 });
  const areaNames = wateringActive ? new Map(listFields().map((f) => [f.id, f.name])) : null;
  const bedNames = new Map(blocks.map((b) => [b.id, b.blockLabel ?? b.name]));
  const watering = {
    active: wateringActive,
    count: wateringRows.length,
    rows: areaNames
      ? wateringRows.map((w) => ({
          id: w.id,
          occurredAt: w.occurredAt,
          areaName: areaNames.get(w.fieldId) ?? 'Area',
          bedName: w.blockId ? (bedNames.get(w.blockId) ?? null) : null,
          inches: w.inches,
          gallons: w.gallons,
          durationMin: w.durationMin
        }))
      : []
  };

  const organicChrome = farmOrganicChrome();
  const organicLink =
    organicChrome === 'full' || (organicChrome === 'entry' && user.role === 'owner');

  return {
    organicLink,
    watering,
    chrome,
    soilNudgePlaces,
    records: page.rows,
    filteredTotal: page.total,
    nextShow: page.nextShow,
    summary,
    approachingRetention: approaching.map((e) => e.id),
    sprayers: listSprayers(),
    blocks,
    activeSprayerId: sprayerId ?? null,
    activeBlockId: blockId ?? null,
    activeKinds,
    activeFromIso: fromMsRaw ?? null,
    activeToIso: toMsRaw ?? null,
    yearSummary,
    selectedYear,
    availableYears,
    showMoneyLink: user.role === 'owner',
    canExportAnimalLog: user.role === 'owner' || user.role === 'inspector'
  };
};
