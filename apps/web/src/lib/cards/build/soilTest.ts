import {
  EXTRACTION_METHOD_LABEL,
  PH_CLASS_LABEL,
  SOIL_TEST_STALE_YEARS,
  interpretSoilTest,
  type NutrientReading
} from '$lib/fertility/soilInterpret';
import { formatCalendarDate, ymdInZone } from '$lib/prefs';
import {
  cardHref,
  cardKey,
  mergeProvenance,
  type CardFact,
  type CardModel,
  type CardProvenance,
  type CardSection
} from '../model';
import type { FarmSnapshot, SnapshotSoilTest } from '../snapshot';
import { areaDisplayName, blockDisplayName, resolveOptions, trimNumber, type BuildOptions } from './common';

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
  const read = interpretSoilTest(test, opts.now);
  const unit = test.unitsBasis === 'lb-per-acre' ? 'lb/A' : 'ppm';

  const sampled = formatCalendarDate(ymdInZone(test.sampledAt, opts.prefs.timeZone), 'date');
  const facts: CardFact[] = [
    {
      label: 'Sampled',
      value: read.stale ? `${sampled}, over ${SOIL_TEST_STALE_YEARS} years ago` : sampled,
      provenance: 'manual'
    }
  ];
  if (test.lab) facts.push({ label: 'Lab', value: test.lab, provenance: 'manual' });
  if (test.extractionMethod) {
    facts.push({
      label: 'Method',
      value: EXTRACTION_METHOD_LABEL[test.extractionMethod],
      provenance: 'manual'
    });
  }
  if (test.ph !== null) {
    facts.push({
      label: 'pH',
      value: read.phClass
        ? `${test.ph.toFixed(1)} · ${PH_CLASS_LABEL[read.phClass]}`
        : test.ph.toFixed(1),
      provenance: 'manual'
    });
  }
  if (test.bufferPh !== null) {
    facts.push({ label: 'Buffer pH', value: test.bufferPh.toFixed(1), provenance: 'manual' });
  }
  for (const f of [
    nutrientFact('Phosphorus (P)', test.phosphorusPpm, unit, read.p),
    nutrientFact('Potassium (K)', test.potassiumPpm, unit, read.k),
    nutrientFact('Calcium (Ca)', test.caPpm, unit, read.ca),
    nutrientFact('Magnesium (Mg)', test.mgPpm, unit, read.mg)
  ]) {
    if (f) facts.push(f);
  }
  if (test.organicMatterPct !== null) {
    facts.push({
      label: 'Organic matter',
      value: `${trimNumber(test.organicMatterPct, 1)}%`,
      provenance: 'manual'
    });
  }
  if (test.nitratePpm !== null) {
    facts.push({
      label: 'Nitrate',
      value: `${trimNumber(test.nitratePpm, 1)} ${unit}`,
      provenance: 'manual'
    });
  }

  const sections: CardSection[] = [];
  if (read.lime.status !== 'unknown') {
    sections.push({ title: 'Lime', items: [read.lime.text], provenance: 'fallback' });
  }
  if (read.stale) {
    sections.push({
      title: 'Test again',
      items: [
        `This test is more than ${SOIL_TEST_STALE_YEARS} years old. Soil changes over time, so a new test will give better numbers.`
      ]
    });
  }

  const provenance: CardProvenance[] = [{ source: 'manual', detail: 'your lab report' }];
  if (facts.some((f) => f.provenance === 'fallback') || sections.length) {
    provenance.push({ source: 'fallback', detail: 'general soil test classes' });
  }

  const key = cardKey('soilTest', test.id);
  const place = blockDisplayName(block);
  return {
    kind: 'soilTest',
    key,
    kicker: area ? `Soil test · ${areaDisplayName(area)}` : 'Soil test',
    title: place,
    facts,
    next: { label: 'Open fertility', href: `/fertility?block=${encodeURIComponent(block.id)}` },
    sections,
    asOf: snapshot.generatedAt,
    provenance: mergeProvenance(provenance),
    href: cardHref('soilTest', key),
    notices: [FOLLOW_LAB_NOTICE],
    status: read.stale
      ? { id: 'stale', label: 'Due for a new test', tone: 'rust' }
      : { id: 'current', label: 'Current', tone: 'forest' }
  };
}

export function buildSoilTestCards(snapshot: FarmSnapshot, options: BuildOptions = {}): CardModel[] {
  const tests: readonly SnapshotSoilTest[] = snapshot.soilTests ?? [];
  return tests
    .map((t) => buildSoilTestCard(snapshot, t.id, options))
    .filter((c): c is CardModel => c !== null)
    .sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}
