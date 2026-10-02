import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth';
import { listFields } from '$lib/db/fields';
import { listBlocks } from '$lib/db/blocks';
import { listAnimals } from '$lib/db/animals';
import { listAnimalGroups } from '$lib/db/animalGroups';
import { getCrop } from '$lib/db/crops';
import { getDocument, documentPeople } from '$lib/db/documents';
import { prefsFor } from '$lib/db/userProfile';
import { isCropBearing } from '$lib/farm/areaKinds';
import { parseExportDateRange } from '$lib/exports/dateRange';
import { identityLabel } from '$lib/identity';
import { formatInstant, todayYmd } from '$lib/prefs';
import {
  blockOrganicStatuses,
  farmOrganicChrome,
  listOrganicStatusHistory,
  organicDateFormatter
} from '$lib/organic/status.server';
import { animalOrganicProjection } from '$lib/organic/animalStatus.server';
import { organicHealthPlugins } from '$lib/organic/plugins.server';
import { loadBlockOrganicFacts } from '$lib/organic/blockFacts.server';
import { organicUseFactLine, treatmentOutcomeText } from '$lib/organic/animalStatus';
import { ORGANIC_INPUT_CLASS_LABEL } from '$lib/organic/inputCompliance';
import { withholdTreatmentLine, ASK_YOUR_CERTIFIER } from '$lib/organic/nopRules';
import {
  ORGANIC_STATUS_LABEL,
  maxEffectiveDay,
  organicStatusLine,
  resolveAreaStatus
} from '$lib/organic/status';
import { LOCK_WINDOW_MS } from '$lib/db/recordKinds';

const KIND_LABEL = {
  spray: 'Herbicide',
  insecticide: 'Insecticide',
  fungicide: 'Fungicide',
  fertility: 'Fertility'
} as const;

function shiftYears(ymd: string, years: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const out = new Date(Date.UTC(y + years, m - 1, d));
  if (out.getUTCMonth() !== m - 1) out.setUTCDate(0);
  return out.toISOString().slice(0, 10);
}

/**
 * 33B /records/organic. The owner enters statuses and answers treatment
 * reviews; helpers and inspectors read (B-12). The page always loads, even
 * for a farm whose chrome is `none` (B-15), and reports facts only.
 */
export const load: PageServerLoad = async (event) => {
  const user = requireUser(event);
  const prefs = prefsFor(user.id);
  const fmt = organicDateFormatter();
  const day = (ms: number) => formatInstant(ms, prefs, 'date');
  const now = Date.now();
  const today = todayYmd(prefs);

  const fromParam = event.url.searchParams.get('from');
  const toParam = event.url.searchParams.get('to');
  const fromYmd =
    fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : shiftYears(today, -3);
  const toYmd = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? toParam : today;
  const range = parseExportDateRange(new URLSearchParams({ from: fromYmd, to: toYmd }), prefs);
  const window = { fromMs: range.fromMs ?? 0, toMs: range.toMs ?? now };

  const areas = listFields().filter((f) => isCropBearing(f.kind));
  const areaNames = new Map(listFields().map((f) => [f.id, f.name]));
  const blocks = listBlocks({ plantings: 'none' });
  const animals = listAnimals();
  const groups = listAnimalGroups();
  const names = new Map<string, string>([
    ...areas.map((a) => [`field:${a.id}`, a.name] as const),
    ...blocks.map((b) => [`block:${b.id}`, b.blockLabel ?? b.name] as const),
    ...animals.map(
      (a) => [`animal:${a.id}`, a.name ?? (a.tag ? `Tag ${a.tag}` : 'Unnamed animal')] as const
    ),
    ...groups.map((g) => [`group:${g.id}`, g.name] as const)
  ]);
  const nameOf = (type: string, id: string) => names.get(`${type}:${id}`) ?? 'A removed record';

  const history = listOrganicStatusHistory();
  const people = documentPeople([...history.map((h) => h.createdBy)]);
  const historyRows = history
    .map((h) => ({
      id: h.id,
      subject: nameOf(h.subjectType, h.subjectId),
      subjectType: h.subjectType,
      status: ORGANIC_STATUS_LABEL[h.status],
      effective:
        h.effectiveAt > now ? `starts ${fmt(h.effectiveAt)}` : `effective ${fmt(h.effectiveAt)}`,
      certifier: h.certifier,
      note: h.note,
      by: h.createdBy && people.get(h.createdBy) ? identityLabel(people.get(h.createdBy)!) : null,
      savedAt: day(h.createdAt),
      documents: h.documentIds
        .map((id) => getDocument(id))
        .filter((d) => d !== undefined)
        .map((d) => ({ id: d.id, title: d.title }))
    }))
    .reverse();

  const areaLines = areas
    .map((a) => ({
      id: a.id,
      name: a.name,
      line: organicStatusLine(
        resolveAreaStatus(
          history.filter((h) => h.subjectType === 'field' && h.subjectId === a.id),
          now
        ),
        fmt
      )
    }))
    .filter((a) => a.line);

  const blockStatus = blockOrganicStatuses(
    blocks.map((b) => b.id),
    now
  );
  const ownBlockEntries = new Set(
    history.filter((h) => h.subjectType === 'block').map((h) => h.subjectId)
  );
  const statusBlocks = blocks.filter((b) => blockStatus.has(b.id));
  const facts = await loadBlockOrganicFacts(
    statusBlocks.map((b) => b.id),
    window,
    day
  );
  const blockRows = statusBlocks.map((b) => {
    const status = blockStatus.get(b.id)!;
    const f = facts.get(b.id);
    const areaEntry =
      b.fieldId && ownBlockEntries.has(b.id)
        ? resolveAreaStatus(
            history.filter((h) => h.subjectType === 'field' && h.subjectId === b.fieldId),
            now
          )
        : null;
    return {
      id: b.id,
      name: b.blockLabel ?? b.name,
      areaName: b.fieldId ? (areaNames.get(b.fieldId) ?? null) : null,
      line: organicStatusLine(status, fmt),
      areaNotApplied: areaEntry
        ? `This block has its own entry; the Area's entry of ${fmt(areaEntry.effectiveAt)} does not apply.`
        : null,
      applications: (f?.applications ?? []).map((a) => ({
        key: `${a.kind}:${a.id}:${a.pluginId ?? a.product}`,
        date: day(a.occurredAt),
        kind: KIND_LABEL[a.kind],
        product: a.product,
        mark: ORGANIC_INPUT_CLASS_LABEL[a.inputClass],
        inputClass: a.inputClass,
        deleted: a.deleted
      })),
      treatedSeed: (f?.treatedSeedPlantings ?? []).map((p) => ({
        key: `${p.cropId}:${p.stockLotId}:${p.at}`,
        date: day(p.at),
        crop: getCrop(p.cropId)?.varietyDisplayName ?? 'A planting'
      })),
      lastNonAllowed: f?.lastNonAllowedAt ? day(f.lastNonAllowedAt) : null,
      transitionLine: f?.transitionLine ?? null
    };
  });

  const projection = animalOrganicProjection(await organicHealthPlugins());
  const animalLines = [
    ...groups.map((g) => ({
      key: `group:${g.id}`,
      name: g.name,
      href: `/animals/groups/${g.id}`,
      line: organicStatusLine(projection.statusAt({ type: 'group', id: g.id }, now), fmt)
    })),
    ...animals.map((a) => ({
      key: `animal:${a.id}`,
      name: nameOf('animal', a.id),
      href: `/animals/${a.id}`,
      line: organicStatusLine(projection.statusAt({ type: 'animal', id: a.id }, now), fmt)
    }))
  ].filter((a) => a.line);

  const isOwner = user.role === 'owner' && !user.impersonating;
  const treatments = projection.rows
    .filter((r) => r.administeredAt >= window.fromMs && r.administeredAt <= window.toMs)
    .map((r) => {
      const locked =
        r.review !== null &&
        (r.review.lockedAt !== null || now - r.review.createdAt >= LOCK_WINDOW_MS);
      return {
        id: r.healthEventId,
        date: day(r.administeredAt),
        product: r.product,
        subjects: r.subjects.map((s) => nameOf(s.type, s.id)),
        healthHref: `/animals/${r.subjects[0].id}/health`,
        outcome: r.outcome,
        outcomeText: treatmentOutcomeText(r),
        review: r.review
          ? {
              outcome: r.review.outcome,
              reason: r.review.reason,
              by: r.review.by?.label ?? null,
              at: day(r.review.createdAt)
            }
          : null,
        canAnswer: isOwner && !r.deleted && r.basis !== 'rule' && !locked,
        deleted: r.deleted,
        organicUseLine: r.organicUse ? organicUseFactLine(r.organicUse) : null
      };
    })
    .reverse();

  const subjects = {
    areas: areas.map((a) => ({ id: a.id, name: a.name })),
    blocks: blocks.map((b) => ({
      id: b.id,
      name:
        b.fieldId && areaNames.get(b.fieldId)
          ? `${areaNames.get(b.fieldId)} · ${b.blockLabel ?? b.name}`
          : (b.blockLabel ?? b.name)
    })),
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    animals: animals.map((a) => ({ id: a.id, name: nameOf('animal', a.id) }))
  };

  return {
    chrome: farmOrganicChrome(),
    canEdit: isOwner,
    isHelper: user.role !== 'owner' && user.role !== 'inspector',
    canExportPack: user.role === 'owner' || user.role === 'inspector',
    today,
    maxDay: maxEffectiveDay(today),
    window: { from: fromYmd, to: toYmd },
    subjects,
    history: historyRows,
    areaLines,
    blockRows,
    animalLines,
    treatments,
    welfareLine: animalLines.length || treatments.length ? withholdTreatmentLine() : null,
    askCertifier: ASK_YOUR_CERTIFIER
  };
};
