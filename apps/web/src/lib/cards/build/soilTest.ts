import {
  SOIL_TEST_STALE_YEARS,
  extractionMethodLabel,
  interpretSoilTest,
  phClassLabel,
  type NutrientReading
} from '$lib/fertility/soilInterpret';
import { formatCalendarDate, ymdInZone } from '$lib/prefs';
import {
  type CardAction,
  cardHref,
  cardKey,
  mergeProvenance,
  type CardFact,
  type CardModel,
  type CardProvenance,
  type CardSection
} from '../model';
import type { FarmSnapshot, SnapshotSoilTest } from '../snapshot';
import { t } from '$lib/i18n';
import {
  areaDisplayName,
  blockDisplayName,
  resolveOptions,
  trimNumber,
  type BuildOptions
} from './common';

export const FOLLOW_LAB_NOTICE =
  "Follow your lab's recommendation for lime and fertilizer. The classes here are a quick read, not a replacement for it.";

function nutrientFact(
  label: string,
  raw: number | null,
  unit: string,
  reading: NutrientReading
): CardFact | null {
  if (raw === null) return null;
  const rated = reading.label ? ` · ${reading.label}` : '';
  return {
    label,
    value: `${trimNumber(raw, 1)} ${unit}${rated}`,
    provenance: reading.provenance ?? 'manual'
  };
}

/** A typed-by-hand report link is shown only when it is http or https. */
export function safeReportUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** A-38. The lab report line and its screen link. Vault files are never in
 *  the offline snapshot, so the link says it needs a connection. */
export function labReportParts(
  test: SnapshotSoilTest,
  timeZone: string,
  locale?: string | null
): { fact: CardFact | null; links: CardAction[] } {
  const links: CardAction[] = [];
  let fact: CardFact | null = null;
  const r = test.labReport;
  if (r && r.deletedAt !== null) {
    const day = formatCalendarDate(ymdInZone(r.deletedAt, timeZone), 'date', {}, locale);
    fact = {
      label: t(locale, 'cards.soil.labReport'),
      value: t(locale, 'cards.soil.deletedOn', { day }),
      provenance: 'manual'
    };
  } else if (r) {
    fact = {
      label: t(locale, 'cards.soil.labReport'),
      value: t(locale, 'cards.soil.attached'),
      printValue: t(locale, 'cards.soil.onFile'),
      provenance: 'manual'
    };
    links.push({
      label: t(locale, 'cards.soil.openReport'),
      href: `/api/documents/${encodeURIComponent(r.documentId)}/file`
    });
  }
  const typed = safeReportUrl(test.reportPdfUrl);
  if (typed)
    links.push({ label: t(locale, 'cards.soil.typedLink'), href: typed, external: true });
  return { fact, links };
}

export function buildSoilTestCard(
  snapshot: FarmSnapshot,
  testId: string,
  options: BuildOptions = {}
): CardModel | null {
  const test = snapshot.soilTests?.find((t) => t.id === testId);
  if (!test) return null;
  const block = snapshot.blocks.find((b) => b.id === test.blockId);
  if (!block) return null;
  const area = block.areaId ? snapshot.areas.find((a) => a.id === block.areaId) : undefined;
  const opts = resolveOptions(snapshot, options);
  const { tr } = opts;
  const loc = opts.prefs.locale;
  const read = interpretSoilTest(test, opts.now, loc);
  const unit = test.unitsBasis === 'lb-per-acre' ? 'lb/A' : 'ppm';

  const sampled = formatCalendarDate(
    ymdInZone(test.sampledAt, opts.prefs.timeZone),
    'date',
    {},
    loc
  );
  const facts: CardFact[] = [
    {
      label: tr('cards.soil.sampled'),
      value: read.stale
        ? tr('cards.soil.overYears', { date: sampled, years: SOIL_TEST_STALE_YEARS })
        : sampled,
      provenance: 'manual'
    }
  ];
  if (test.lab) facts.push({ label: tr('cards.soil.lab'), value: test.lab, provenance: 'manual' });
  if (test.extractionMethod) {
    facts.push({
      label: tr('cards.soil.method'),
      value: extractionMethodLabel(test.extractionMethod, loc),
      provenance: 'manual'
    });
  }
  if (test.ph !== null) {
    facts.push({
      label: 'pH',
      value: read.phClass
        ? `${test.ph.toFixed(1)} · ${phClassLabel(read.phClass, loc)}`
        : test.ph.toFixed(1),
      provenance: 'manual'
    });
  }
  if (test.bufferPh !== null) {
    facts.push({
      label: tr('cards.soil.bufferPh'),
      value: test.bufferPh.toFixed(1),
      provenance: 'manual'
    });
  }
  for (const f of [
    nutrientFact(tr('cards.soil.phosphorus'), test.phosphorusPpm, unit, read.p),
    nutrientFact(tr('cards.soil.potassium'), test.potassiumPpm, unit, read.k),
    nutrientFact(tr('cards.soil.calcium'), test.caPpm, unit, read.ca),
    nutrientFact(tr('cards.soil.magnesium'), test.mgPpm, unit, read.mg)
  ]) {
    if (f) facts.push(f);
  }
  if (test.organicMatterPct !== null) {
    facts.push({
      label: tr('cards.soil.organicMatter'),
      value: `${trimNumber(test.organicMatterPct, 1)}%`,
      provenance: 'manual'
    });
  }
  if (test.nitratePpm !== null) {
    facts.push({
      label: tr('cards.soil.nitrate'),
      value: `${trimNumber(test.nitratePpm, 1)} ${unit}`,
      provenance: 'manual'
    });
  }

  const report = labReportParts(test, opts.prefs.timeZone, loc);
  if (report.fact) facts.push(report.fact);

  const sections: CardSection[] = [];
  if (read.lime.status !== 'unknown') {
    sections.push({ title: tr('cards.soil.lime'), items: [read.lime.text], provenance: 'fallback' });
  }
  if (read.stale) {
    sections.push({
      title: tr('cards.soil.testAgain'),
      items: [tr('cards.soil.testAgainText', { years: SOIL_TEST_STALE_YEARS })]
    });
  }

  const provenance: CardProvenance[] = [
    { source: 'manual', detail: tr('cards.soil.provReport') }
  ];
  if (facts.some((f) => f.provenance === 'fallback') || sections.length) {
    provenance.push({ source: 'fallback', detail: tr('cards.soil.provClasses') });
  }

  const key = cardKey('soilTest', test.id);
  const place = blockDisplayName(block, loc);
  return {
    kind: 'soilTest',
    key,
    kicker: area
      ? tr('cards.soil.kickerArea', { area: areaDisplayName(area, loc) })
      : tr('cards.soil.kicker'),
    title: place,
    facts,
    next: {
      label: tr('cards.soil.openFertility'),
      href: `/fertility?block=${encodeURIComponent(block.id)}`
    },
    sections,
    asOf: snapshot.generatedAt,
    provenance: mergeProvenance(provenance),
    href: cardHref('soilTest', key),
    notices: [tr('cards.soil.followLab')],
    ...(report.links.length ? { links: report.links } : {}),
    status: read.stale
      ? { id: 'stale', label: tr('cards.soil.statusStale'), tone: 'rust' }
      : { id: 'current', label: tr('cards.soil.statusCurrent'), tone: 'forest' }
  };
}

export function buildSoilTestCards(snapshot: FarmSnapshot, options: BuildOptions = {}): CardModel[] {
  const tests: readonly SnapshotSoilTest[] = snapshot.soilTests ?? [];
  return tests
    .map((t) => buildSoilTestCard(snapshot, t.id, options))
    .filter((c): c is CardModel => c !== null)
    .sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}
