/**
 * The prussic acid and nitrate advisory (Phase 33C, C4, M-53 to M-61).
 * Pure and client-safe. It never blocks a move or a hay cut, it is shown
 * for every species, pets included (M-10), and it carries numbers only in
 * the `FORAGE_ADVICE` lines, each quoted from a named source.
 */

import { formatCalendarDate, ymdInZone } from '$lib/prefs';
import type { ForageHazard, ForageHazardKind, ForageTrigger } from '$lib/plugins/schemas';
import { FORAGE_ADVICE, FROST_LOOKBACK_DAYS, type ForageAdvice } from './advice';
import { nitrateAsTyped, nitrateConvertedText } from './interpret';
import { ratingBasisLabel, type ForageLabRating, type NitrateUnits } from './model';
import { t } from '$lib/i18n';

const DAY_MS = 86_400_000;

export interface ForageTriggerOnFile {
  trigger: ForageTrigger;
  text: string;
  atMs: number | null;
}

export interface ForageTestView {
  id: string;
  sampledAt: number;
  ratingText: string | null;
  valueText: string | null;
  convertedText: string | null;
}

export interface ForageAdvisoryItem {
  cropName: string;
  blockId: string | null;
  blockName: string | null;
  hazard: ForageHazardKind;
  /** The plain-English heading for this crop and hazard. */
  headline: string;
  /** "What raises the risk", from the plugin's sourced triggers. */
  raisesRisk: string;
  /** Stronger wording when frost or nitrogen is on file (M-56). */
  elevated: boolean;
  triggersOnFile: ForageTriggerOnFile[];
  frostUnknown: boolean;
  advice: ForageAdvice[];
  latestTest: ForageTestView | null;
}

export interface ForageAdvisory {
  items: ForageAdvisoryItem[];
  provenance: 'plugin' | 'data';
  /** Where "Record a forage test" goes for this Area or cutting. */
  recordHref: string;
  /** The cutting's own latest test, for the hay card (M-61). */
  targetTest: ForageTestView | null;
}

export interface AdvisoryBlock {
  id: string;
  name: string;
}
export interface AdvisoryPlanting {
  blockId: string;
  cropPluginId: string;
  plantingDate: number | null;
}
export interface AdvisoryCut {
  id: string;
  blockId: string;
  cutAt: number;
}
export interface AdvisoryNitrogen {
  blockId: string;
  occurredAt: number;
}
export interface AdvisoryTest {
  id: string;
  blockId: string | null;
  hayCuttingId: string | null;
  stockLotId: string | null;
  sampledAt: number;
  createdAt: number;
  nitrateValue: number | null;
  nitrateUnits: NitrateUnits | null;
  hcnPpm: number | null;
  labRating: ForageLabRating | null;
}

export interface FrostFacts {
  /** Readings at or below freezing, and frost alerts, inside the lookback. */
  seen: Array<{ atMs: number; source: 'observed' | 'alert'; where?: string | null }>;
  /** The weather read failed or timed out and no alert is on file. */
  unknown: boolean;
}

export type AdvisoryTarget =
  | { kind: 'area'; fieldId: string }
  | { kind: 'hay'; cuttingId: string; blockId: string; cropPluginId: string; cutAt: number };

export interface AdvisoryInput {
  target: AdvisoryTarget;
  blocks: readonly AdvisoryBlock[];
  plantings: readonly AdvisoryPlanting[];
  cuts: readonly AdvisoryCut[];
  nitrogen: readonly AdvisoryNitrogen[];
  tests: readonly AdvisoryTest[];
  frost: FrostFacts;
  /** The shipped library's hazards and the farm's display name (M-24). */
  hazardsFor: (pluginId: string) => { name: string; hazards: readonly ForageHazard[] } | null;
  timeZone: string;
  now: number;
  /** Language for lab results; hazard lines stay English. */
  locale?: string | null;
}

const TRIGGER_WORDS: Record<ForageTrigger, string> = {
  frost: 'frost',
  drought: 'drought',
  'young-regrowth': 'young regrowth',
  'heavy-nitrogen': 'heavy nitrogen'
};

const ADVICE_FOR: Record<ForageHazardKind, Partial<Record<ForageTrigger, ForageAdvice>>> = {
  'prussic-acid': {
    frost: FORAGE_ADVICE.frostWait,
    'young-regrowth': FORAGE_ADVICE.minHeight,
    'heavy-nitrogen': FORAGE_ADVICE.nitrogen
  },
  nitrate: {
    'heavy-nitrogen': FORAGE_ADVICE.nitrogen,
    drought: FORAGE_ADVICE.drought
  }
};

function list(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

export function forageDate(ms: number, timeZone: string, locale?: string | null): string {
  return formatCalendarDate(ymdInZone(ms, timeZone), 'date', {}, locale);
}

/** A lab result as text. Lab results are data, not hazard wording, so they
 *  follow `locale`; units and the lab's own words stay as typed. */
export function testView(
  test: AdvisoryTest,
  timeZone: string,
  locale?: string | null
): ForageTestView {
  const rating: string[] = [];
  if (test.labRating?.nitrate) {
    rating.push(t(locale, 'forage.test.nitrateRating', { value: test.labRating.nitrate }));
  }
  if (test.labRating?.hcn) {
    rating.push(t(locale, 'forage.test.hcnRating', { value: test.labRating.hcn }));
  }
  const basis = test.labRating?.basis ? ` (${ratingBasisLabel(test.labRating.basis, locale)})` : '';
  const values: string[] = [];
  if (test.nitrateValue !== null && test.nitrateUnits) {
    values.push(
      t(locale, 'forage.test.nitrateValue', {
        value: nitrateAsTyped(test.nitrateValue, test.nitrateUnits, locale)
      })
    );
  }
  if (test.hcnPpm !== null) {
    values.push(t(locale, 'forage.test.hcnValue', { value: String(test.hcnPpm) }));
  }
  const date = forageDate(test.sampledAt, timeZone, locale);
  return {
    id: test.id,
    sampledAt: test.sampledAt,
    ratingText: rating.length
      ? t(locale, 'forage.test.rating', { rating: rating.join('; '), basis })
      : null,
    valueText: values.length
      ? t(locale, 'forage.test.sampledValues', { date, values: values.join('. ') })
      : t(locale, 'forage.test.sampled', { date }),
    convertedText:
      test.nitrateValue !== null && test.nitrateUnits
        ? nitrateConvertedText(test.nitrateValue, test.nitrateUnits, locale)
        : null
  };
}

function newest<T extends { sampledAt: number; createdAt: number }>(rows: T[]): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (
      !best ||
      r.sampledAt > best.sampledAt ||
      (r.sampledAt === best.sampledAt && r.createdAt > best.createdAt)
    ) {
      best = r;
    }
  }
  return best;
}

/** N on the block since the later of the planting date and the last cut
 *  before `untilMs` (M-55). */
function nitrogenSince(
  input: AdvisoryInput,
  blockId: string,
  plantingDate: number | null,
  untilMs: number
): AdvisoryNitrogen | null {
  const priorCut = input.cuts
    .filter((c) => c.blockId === blockId && c.cutAt < untilMs)
    .reduce((m, c) => Math.max(m, c.cutAt), Number.NEGATIVE_INFINITY);
  const since = Math.max(plantingDate ?? Number.NEGATIVE_INFINITY, priorCut);
  const apps = input.nitrogen
    .filter((n) => n.blockId === blockId && n.occurredAt > since && n.occurredAt <= untilMs)
    .sort((a, b) => b.occurredAt - a.occurredAt);
  return apps[0] ?? null;
}

interface Subject {
  cropPluginId: string;
  blockId: string;
  plantingDate: number | null;
  untilMs: number;
}

function itemFor(
  input: AdvisoryInput,
  s: Subject,
  name: string,
  hazard: ForageHazard,
  blockName: string | null
): ForageAdvisoryItem | null {
  const tz = input.timeZone;
  const triggers = new Set(hazard.triggers);
  const onFile: ForageTriggerOnFile[] = [];
  let frostUnknown = false;

  if (triggers.has('frost')) {
    const seen = [...input.frost.seen].sort((a, b) => b.atMs - a.atMs)[0];
    if (seen) {
      onFile.push({
        trigger: 'frost',
        atMs: seen.atMs,
        text:
          seen.source === 'alert'
            ? `A frost alert was sent on ${forageDate(seen.atMs, tz)}.`
            : `A reading at or below freezing on ${forageDate(seen.atMs, tz)}${
                seen.where ? ` at ${seen.where}` : ''
              }.`
      });
    } else if (input.frost.unknown) {
      frostUnknown = true;
    }
  }
  if (triggers.has('heavy-nitrogen')) {
    const n = nitrogenSince(input, s.blockId, s.plantingDate, s.untilMs);
    if (n) {
      onFile.push({
        trigger: 'heavy-nitrogen',
        atMs: n.occurredAt,
        text: `Nitrogen was applied${blockName ? ` to ${blockName}` : ''} on ${forageDate(n.occurredAt, tz)}.`
      });
    }
  }
  if (hazard.kind === 'prussic-acid' && triggers.has('young-regrowth')) {
    onFile.push({
      trigger: 'young-regrowth',
      atMs: null,
      text: 'Young growth and regrowth can be high in prussic acid. The app does not record plant height.'
    });
  }

  const blockTests = input.tests.filter(
    (t) =>
      t.blockId === s.blockId ||
      (t.hayCuttingId !== null &&
        input.cuts.some((c) => c.id === t.hayCuttingId && c.blockId === s.blockId)) ||
      (input.target.kind === 'hay' && t.hayCuttingId === input.target.cuttingId)
  );
  const latest = newest(blockTests);
  const nitrogenOnFile = onFile.some((t) => t.trigger === 'heavy-nitrogen');
  if (hazard.kind === 'nitrate' && !nitrogenOnFile && !latest) return null;

  const elevated = onFile.some((t) => t.trigger === 'frost' || t.trigger === 'heavy-nitrogen');
  const where = blockName ? ` on ${blockName}` : '';
  const headline =
    hazard.kind === 'prussic-acid'
      ? elevated
        ? `${name}${where}: higher prussic acid risk now.`
        : `${name}${where} can form prussic acid (cyanide).`
      : nitrogenOnFile
        ? `${name}${where}: nitrate can build up after the nitrogen on file.`
        : `${name}${where}: a nitrate test is on file.`;

  const advice: ForageAdvice[] = [];
  for (const t of hazard.triggers) {
    const a = ADVICE_FOR[hazard.kind][t];
    if (a && !advice.includes(a)) advice.push(a);
  }
  if (hazard.kind === 'nitrate') advice.push(FORAGE_ADVICE.hayNitrate);

  return {
    cropName: name,
    blockId: s.blockId,
    blockName,
    hazard: hazard.kind,
    headline,
    raisesRisk: `What raises the risk: ${list(hazard.triggers.map((t) => TRIGGER_WORDS[t]))}.`,
    elevated,
    triggersOnFile: onFile,
    frostUnknown,
    advice,
    latestTest: latest ? testView(latest, tz, input.locale) : null
  };
}

/** The advisory for an Area or a hay cutting. Empty when nothing applies. */
export function buildForageAdvisory(input: AdvisoryInput): ForageAdvisory {
  const blockName = new Map(input.blocks.map((b) => [b.id, b.name]));
  const subjects: Subject[] = [];
  const target = input.target;
  if (target.kind === 'hay') {
    const planting = input.plantings.find(
      (p) => p.blockId === target.blockId && p.cropPluginId === target.cropPluginId
    );
    subjects.push({
      cropPluginId: target.cropPluginId,
      blockId: target.blockId,
      plantingDate: planting?.plantingDate ?? null,
      untilMs: target.cutAt
    });
  } else {
    const seen = new Set<string>();
    for (const p of input.plantings) {
      const key = `${p.blockId}|${p.cropPluginId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sameCrop = input.plantings.filter(
        (q) => q.blockId === p.blockId && q.cropPluginId === p.cropPluginId
      );
      const latestDate = sameCrop.reduce<number | null>(
        (m, q) => (q.plantingDate === null ? m : Math.max(m ?? q.plantingDate, q.plantingDate)),
        null
      );
      subjects.push({
        cropPluginId: p.cropPluginId,
        blockId: p.blockId,
        plantingDate: latestDate,
        untilMs: input.now
      });
    }
  }

  const items: ForageAdvisoryItem[] = [];
  for (const s of subjects) {
    const info = input.hazardsFor(s.cropPluginId);
    if (!info) continue;
    for (const h of info.hazards) {
      const item = itemFor(input, s, info.name, h, blockName.get(s.blockId) ?? null);
      if (item) items.push(item);
    }
  }
  items.sort(
    (a, b) =>
      (a.hazard === b.hazard ? 0 : a.hazard === 'prussic-acid' ? -1 : 1) ||
      (a.blockName ?? '').localeCompare(b.blockName ?? '') ||
      a.cropName.localeCompare(b.cropName)
  );

  const targetTestRow =
    target.kind === 'hay'
      ? newest(input.tests.filter((t) => t.hayCuttingId === target.cuttingId))
      : null;
  const hasData = items.some((i) => i.triggersOnFile.some((t) => t.atMs !== null) || i.latestTest);
  return {
    items,
    provenance: hasData ? 'data' : 'plugin',
    recordHref:
      target.kind === 'hay'
        ? `/forage?hayCuttingId=${encodeURIComponent(target.cuttingId)}`
        : `/forage?fieldId=${encodeURIComponent(target.fieldId)}`,
    targetTest: targetTestRow ? testView(targetTestRow, input.timeZone, input.locale) : null
  };
}

/** The window frost is looked for in, ending at `untilMs` (M-55). */
export function frostWindow(untilMs: number): { fromMs: number; toMs: number } {
  return { fromMs: untilMs - FROST_LOOKBACK_DAYS * DAY_MS, toMs: untilMs };
}

/** Frost facts from observed hours and alert times inside the window. */
export function frostFrom(
  window: { fromMs: number; toMs: number },
  observed: {
    hours: Array<{ t: number; tempF: number | null }>;
    failed: boolean;
    where?: string | null;
  },
  alerts: readonly number[]
): FrostFacts {
  const seen: FrostFacts['seen'] = [];
  const cold = observed.hours
    .filter((h) => h.t >= window.fromMs && h.t <= window.toMs && h.tempF !== null && h.tempF <= 32)
    .sort((a, b) => b.t - a.t)[0];
  if (cold) seen.push({ atMs: cold.t, source: 'observed', where: observed.where ?? null });
  for (const a of alerts) {
    if (a >= window.fromMs && a <= window.toMs) seen.push({ atMs: a, source: 'alert' });
  }
  return { seen, unknown: seen.length === 0 && observed.failed };
}
