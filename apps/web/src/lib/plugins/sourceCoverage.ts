/**
 * Phase 32A source coverage. Every label or agronomy number a Phase 32
 * plugin field carries must have a quoted source in one of the
 * apps/web/scripts/*-sources.json files, keyed pluginId → fact path. The
 * gate tests (`sourceCoverage.gate.test.ts`) run these checks over the
 * shipped library; an unsourced value fails CI.
 */

import { z } from 'zod';
import {
  FORAGE_CROP_ENTRIES_NEVER_COUNTED,
  FORAGE_CROP_ENTRY_PREFIX,
  FORAGE_PLUGIN_EXCLUSIONS,
  FORAGE_TRIGGER_SOURCE_KEYS,
  isPageReaderSource
} from '$lib/forage/hazardSources';
import { SEEDING_RATE_KEYS } from './schemas';
import type {
  ForageHazard,
  ForageHazardKind,
  AnimalHealthPlugin,
  CropPlugin,
  FungicidePlugin,
  GrazingRestrictions,
  HerbicidePlugin,
  InsecticidePlugin,
  PestModelPlugin,
  SpeciesPlugin
} from './schemas';

export const sourceEntrySchema = z.object({
  url: z.url({ protocol: /^https$/ }),
  publisher: z.string().trim().min(3),
  date: z.string().trim().min(4),
  quote: z.string().trim().min(10),
  note: z.string().optional()
});
export type SourceEntry = z.infer<typeof sourceEntrySchema>;

/** pluginId → fact path → source. */
export type SourceMap = Record<string, Record<string, unknown>>;

export interface SourceGap {
  pluginId: string;
  path: string;
  problem: 'missing' | 'invalid';
}

export interface SourcedFacts {
  pluginId: string;
  paths: string[];
}

export function checkSources(items: SourcedFacts[], sources: SourceMap): SourceGap[] {
  const gaps: SourceGap[] = [];
  for (const { pluginId, paths } of items) {
    for (const path of paths) {
      const entry = sources[pluginId]?.[path];
      if (entry === undefined) gaps.push({ pluginId, path, problem: 'missing' });
      else if (!sourceEntrySchema.safeParse(entry).success) {
        gaps.push({ pluginId, path, problem: 'invalid' });
      }
    }
  }
  return gaps;
}

function present(prefix: string, obj: Record<string, unknown>, keys: string[]): string[] {
  return keys.filter((k) => obj[k] !== undefined).map((k) => `${prefix}${k}`);
}

export function grazingFactPaths(g: GrazingRestrictions): string[] {
  const paths = present('', g, [
    'grazeDays',
    'hayDays',
    'lactatingDairyGrazeDays',
    'meatAnimalRemovalBeforeSlaughterDays',
    'manureCarryoverDays'
  ]);
  if (g.notForPasture === true) paths.push('notForPasture');
  if (g.manureCarryover === true) paths.push('manureCarryover');
  if (g.hayOffFarmRestricted === true) paths.push('hayOffFarmRestricted');
  for (const e of g.speciesExceptions ?? []) {
    const prefix = `speciesExceptions.${e.speciesId}${e.lactating ? '.lactating' : ''}.`;
    paths.push(...present(prefix, e, ['grazeDays', 'hayDays']));
  }
  return paths;
}

export function animalHealthFactPaths(p: AnimalHealthPlugin): string[] {
  const paths: string[] = [];
  for (const use of p.labelUses) {
    if (!use.withdrawal) continue;
    const prefix = `withdrawal.${use.speciesId}.${use.class}.`;
    paths.push(...present(prefix, use.withdrawal, ['meatDays', 'milkHours', 'eggsDays']));
    if (use.withdrawal.doNotUseFor) paths.push(`${prefix}doNotUseFor`);
  }
  if (p.organicUse) paths.push('organicUse');
  return paths;
}

/** Label uses with no withdrawal at all, on a species that is (or may be)
 *  food-producing. `isFoodSpecies` returns undefined for an unknown species,
 *  which counts as food-producing. */
export function missingWithdrawals(
  p: AnimalHealthPlugin,
  isFoodSpecies: (speciesId: string) => boolean | undefined
): string[] {
  return p.labelUses
    .filter((u) => u.withdrawal === undefined && isFoodSpecies(u.speciesId) !== false)
    .map((u) => `withdrawal.${u.speciesId}.${u.class}`);
}

export function pestModelFactPaths(p: PestModelPlugin): string[] {
  const paths = present('', p, ['baseTempF', 'upperCutoffF']);
  if (p.biofix.date !== undefined) paths.push('biofix.date');
  for (const s of p.stages) paths.push(...present(`stages.${s.key}.`, s, ['gddFrom', 'gddTo']));
  return paths;
}

export function speciesFactPaths(p: SpeciesPlugin): string[] {
  const paths = ['foodProducingDefault'];
  for (const c of p.careDefaults ?? []) {
    if (c.intervalDays !== undefined) paths.push(`careDefaults.${c.key}.intervalDays`);
  }
  const space = p.housingSpace;
  if (space?.indoorSqFtPerAnimal !== undefined) paths.push('housingSpace.indoorSqFtPerAnimal');
  if (space?.outdoorSqFtPerAnimal !== undefined) paths.push('housingSpace.outdoorSqFtPerAnimal');
  return paths;
}

/** Phase 32A crop fields that carry numbers or animal-safety facts. Paths
 *  match the flat keys crop-data-sources.json already uses. */
export const CROP_SOURCED_GUIDE_FIELDS = [
  'startIndoorsWeeks',
  'transplantOffsetDays',
  'hardenOffDays',
  'germinationTempF',
  'dtmFrom'
] as const;

export function cropFactPaths(c: CropPlugin): string[] {
  const guide = c.plantingGuide ?? {};
  const paths = present('', guide, [...CROP_SOURCED_GUIDE_FIELDS]);
  if (guide.seedingRate)
    paths.push(...present('seedingRate.', guide.seedingRate, [...SEEDING_RATE_KEYS, 'seedBasis']));
  for (const entry of c.animalToxicity ?? []) {
    for (const id of entry.speciesIds) paths.push(`animalToxicity.${id}`);
  }
  for (const row of c.treeSizeClasses ?? []) paths.push(`treeSizeClasses.${row.sizeClass}`);
  if (isTreeCrop(c)) {
    if (guide.rowSpacingIn !== undefined) paths.push('rowSpacingIn');
    if (c.defaultRowSpacingInches !== undefined) paths.push('defaultRowSpacingInches');
  }
  return paths;
}

/** #587: a tree crop (archetype `tree-fruit-multi-pick`, or one with a size
 *  class table) is spaced by its size class rows or its sourced minimum
 *  distance between trees; a between-row value must be sourced like any
 *  other number. */
export function isTreeCrop(c: Pick<CropPlugin, 'archetype' | 'treeSizeClasses'>): boolean {
  return c.archetype === 'tree-fruit-multi-pick' || (c.treeSizeClasses?.length ?? 0) > 0;
}

/** #587: a tree crop's row spacing quote must state the number, in inches or
 *  as feet, and name rows, and a crop with a size class table carries no row spacing at all
 *  (the table spaces it both ways, so the value would never be read).
 *  Returns "pluginId: problem" lines. */
export function treeRowSpacingGaps(
  crops: ReadonlyArray<
    Pick<
      CropPlugin,
      'pluginId' | 'archetype' | 'treeSizeClasses' | 'plantingGuide' | 'defaultRowSpacingInches'
    >
  >,
  sources: SourceMap
): string[] {
  const gaps: string[] = [];
  for (const c of crops) {
    if (!isTreeCrop(c)) continue;
    const values: Array<[string, number | undefined]> = [
      ['rowSpacingIn', c.plantingGuide?.rowSpacingIn],
      ['defaultRowSpacingInches', c.defaultRowSpacingInches]
    ];
    for (const [key, inches] of values) {
      if (inches === undefined) continue;
      if (c.treeSizeClasses?.length) {
        gaps.push(`${c.pluginId}: ${key} is never read when treeSizeClasses spaces the crop`);
        continue;
      }
      const entry = sourceEntrySchema.safeParse(sources[c.pluginId]?.[key]);
      if (!entry.success) continue;
      const figures = [numberPattern(inches)];
      if (Number.isInteger(inches / 12)) figures.push(numberPattern(inches / 12));
      const stated = figures.some((f) =>
        new RegExp(`(^|[^\\d.])${f}([^\\d]|$)`).test(entry.data.quote)
      );
      if (!stated) gaps.push(`${c.pluginId}: ${key} quote does not state ${inches} in`);
      // #587 ruling R2: an unlabelled "A x B" spacing never counts as rows.
      if (!/\brows?\b/i.test(entry.data.quote)) {
        gaps.push(`${c.pluginId}: ${key} quote does not say the figure is between rows`);
      }
    }
  }
  return gaps;
}

/** A tree size class row's spacing and bearing age must both appear in its
 *  quote (a range as "2-3" or "2–3"). Returns "pluginId: problem" lines. */
export function treeSizeClassQuoteGaps(
  crops: ReadonlyArray<Pick<CropPlugin, 'pluginId' | 'treeSizeClasses'>>,
  sources: SourceMap
): string[] {
  const gaps: string[] = [];
  for (const c of crops) {
    for (const row of c.treeSizeClasses ?? []) {
      const key = `treeSizeClasses.${row.sizeClass}`;
      const entry = sourceEntrySchema.safeParse(sources[c.pluginId]?.[key]);
      if (!entry.success) continue;
      const { min, max } = row.yearsToBearing;
      const years = min === max ? `${min}` : `${min}[-–]${max}`;
      if (!new RegExp(`(^|[^\\d.])${row.minSpacingFt}([^\\d.]|$)`).test(entry.data.quote)) {
        gaps.push(`${c.pluginId}: ${key} quote does not state ${row.minSpacingFt} ft`);
      }
      if (!new RegExp(`(^|[^\\d])${years}([^\\d]|$)`).test(entry.data.quote)) {
        gaps.push(`${c.pluginId}: ${key} quote does not state ${min}-${max} years`);
      }
    }
  }
  return gaps;
}

function numberPattern(n: number): string {
  const [int, frac] = String(n).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+$)/g, ',?');
  return frac ? `${grouped}\\.${frac}` : grouped;
}

/** A seeding rate range must appear in its quote ("60-120", "60–120",
 *  "60 to 120", "6- to 7-inch", "7-inch to 8-inch", "25,000 to 33,000"; one
 *  figure when min = max), and a seed basis must match the quote: `pls` names pure live
 *  seed and `bulk` never does. Returns "pluginId: problem" lines. */
export function seedingRateQuoteGaps(
  crops: ReadonlyArray<Pick<CropPlugin, 'pluginId' | 'plantingGuide'>>,
  sources: SourceMap
): string[] {
  const gaps: string[] = [];
  const pls = /\bPLS\b|pure live seed/i;
  for (const c of crops) {
    const rate = c.plantingGuide?.seedingRate;
    if (!rate) continue;
    for (const key of SEEDING_RATE_KEYS) {
      const r = rate[key];
      if (!r) continue;
      const entry = sourceEntrySchema.safeParse(sources[c.pluginId]?.[`seedingRate.${key}`]);
      if (!entry.success) continue;
      const body =
        r.min === r.max
          ? numberPattern(r.min)
          : `${numberPattern(r.min)}(?:-inch)?-?\\s*(?:-|–|—|to)\\s*${numberPattern(r.max)}`;
      if (!new RegExp(`(^|[^\\d.,])${body}([^\\d]|$)`).test(entry.data.quote)) {
        gaps.push(`${c.pluginId}: seedingRate.${key} quote does not state ${r.min}-${r.max}`);
      }
    }
    if (rate.seedBasis) {
      const entry = sourceEntrySchema.safeParse(sources[c.pluginId]?.['seedingRate.seedBasis']);
      if (entry.success && pls.test(entry.data.quote) !== (rate.seedBasis === 'pls')) {
        gaps.push(`${c.pluginId}: seedingRate.seedBasis quote does not say ${rate.seedBasis}`);
      }
    }
  }
  return gaps;
}

/** OC-1 (docs/design/ORCHARD_CALENDAR.md): crop seasonal task rows never
 *  carry spray timing or pesticide wording. Case-insensitive words, plus
 *  acronyms matched only in capitals so ordinary words never trip them. */
export const SEASONAL_PESTICIDE_WORDS =
  /\b(fungicides?|insecticides?|bactericides?|herbicides?|pesticides?|miticides?|nematicides?|pyrethroids?|captan|sulfur|lime-sulfur|copper|streptomycin|apogee|mancozeb|chlorothalonil|myclobutanil|strobilurins?|tank[- ]?mix(es|ed)?|spray(s|ing|ed)?|oils?)\b/i;
export const SEASONAL_PESTICIDE_ACRONYMS = /\b(FRAC|IRAC|PHI|REI|DMI|SDHI)\b/;
/** OP-21: a seasonal row never points at a label ("cover" and "protection"
 *  stay allowed, since row cover and frost protection are cultural). */
export const SEASONAL_LABEL_WORD = /\blabels?\b/i;

export function seasonalTaskWordingProblems(
  crops: readonly Pick<CropPlugin, 'pluginId' | 'seasonalTasks' | 'orchardSeasonalTasks'>[]
): string[] {
  const out: string[] = [];
  for (const c of crops) {
    const lists = [
      ['seasonalTasks', c.seasonalTasks ?? []],
      ['orchardSeasonalTasks', c.orchardSeasonalTasks ?? []]
    ] as const;
    for (const [field, rows] of lists) {
      for (const row of rows as readonly {
        key: string;
        kind?: string;
        category?: string;
        title: string;
        body?: string;
      }[]) {
        const at = `${c.pluginId} ${field}.${row.key}`;
        if (row.kind === 'spray') out.push(`${at}: kind spray`);
        if (row.category === 'spray') out.push(`${at}: category spray`);
        for (const [part, text] of [
          ['title', row.title],
          ['body', row.body ?? '']
        ] as const) {
          const hit =
            text.match(SEASONAL_PESTICIDE_WORDS) ??
            text.match(SEASONAL_PESTICIDE_ACRONYMS) ??
            text.match(SEASONAL_LABEL_WORD);
          if (hit) out.push(`${at}: ${part} says "${hit[0]}"`);
        }
      }
    }
  }
  return out;
}

/** The one stage caution OC-1 keeps: a warning against spraying, not advice to spray. */
const STAGE_BLOOM_CAUTION = /\bavoid insecticides\b/gi;

/** OC-1: growth-stage hints (`inspect`) carry no spray timing or product
 *  wording either, since the Plan swimlane and calendar show them. */
export function stageTemplateWordingProblems(
  tables: Readonly<
    Record<string, { stages: readonly { code: string; inspect?: string }[] } | null | undefined>
  >
): string[] {
  const out: string[] = [];
  for (const [family, table] of Object.entries(tables)) {
    for (const st of table?.stages ?? []) {
      const text = (st.inspect ?? '').replace(STAGE_BLOOM_CAUTION, '');
      const hit = text.match(SEASONAL_PESTICIDE_WORDS) ?? text.match(SEASONAL_PESTICIDE_ACRONYMS);
      if (hit) out.push(`${family} ${st.code}: inspect says "${hit[0]}"`);
      if (/\d/.test(st.inspect ?? '')) out.push(`${family} ${st.code}: inspect has a number`);
    }
  }
  return out;
}

/** The numbers written in a piece of text: "2–3" is 2 and 3, "1/6" is 1 and
 *  6, "1.5" stays 1.5. */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
}

function quoteStates(quote: string, n: string): boolean {
  const plain = quote.replace(/(\d),(?=\d{3})/g, '$1');
  return new RegExp(`(^|[^\\d.])${n.replace('.', '\\.')}([^\\d]|$)`).test(plain);
}

/** OP-21: a number in a seasonal row's title or body ships only with a
 *  source entry under `seasonalTasks.<key>` or `orchardSeasonalTasks.<key>`
 *  whose quote states every number the row writes. Returns
 *  "pluginId field.key: problem" lines. */
export function seasonalTaskNumberGaps(
  crops: readonly Pick<CropPlugin, 'pluginId' | 'seasonalTasks' | 'orchardSeasonalTasks'>[],
  sources: SourceMap
): string[] {
  const out: string[] = [];
  for (const c of crops) {
    const lists = [
      ['seasonalTasks', c.seasonalTasks ?? []],
      ['orchardSeasonalTasks', c.orchardSeasonalTasks ?? []]
    ] as const;
    for (const [field, rows] of lists) {
      for (const row of rows as readonly { key: string; title: string; body?: string }[]) {
        const path = `${field}.${row.key}`;
        const numbers = [...new Set(numbersIn(`${row.title} ${row.body ?? ''}`))];
        if (numbers.length === 0) continue;
        const entry = sourceEntrySchema.safeParse(sources[c.pluginId]?.[path]);
        if (!entry.success) {
          out.push(`${c.pluginId} ${path}: no source for ${numbers.join(', ')}`);
          continue;
        }
        for (const n of numbers) {
          if (!quoteStates(entry.data.quote, n)) {
            out.push(`${c.pluginId} ${path}: quote does not state ${n}`);
          }
        }
      }
    }
  }
  return out;
}

export type PesticidePlugin = HerbicidePlugin | InsecticidePlugin | FungicidePlugin;

const PASTURE_WORDS =
  /\b(pastures?|rangeland|grazing|grazed|hay|hayfields?|forages?|alfalfa|clovers?|timothy|orchard-?grass|fescue|sudangrass)\b/i;

/** True when a pesticide's label crops include pasture, hay or forage: it
 *  claims safety on the forage family or a forage crop, or its text names
 *  pasture, rangeland, grazing, hay, forage or a forage crop such as
 *  alfalfa or clover. A forage pest name ("alfalfa weevil") counts too, so
 *  the gate errs toward asking. */
export function isPastureLabelled(
  p: PesticidePlugin,
  cropFamilyOf: (cropPluginId: string) => string | undefined
): boolean {
  const claims = p.labelClaims as
    { safeForCropPluginIds?: string[]; safeForCropFamilies?: string[] } | undefined;
  if (claims?.safeForCropFamilies?.includes('forage')) return true;
  if (claims?.safeForCropPluginIds?.some((id) => cropFamilyOf(id) === 'forage')) return true;
  const { grazingRestrictions: _ignored, ...rest } = p;
  return PASTURE_WORDS.test(JSON.stringify(rest));
}

export interface PastureAllowlistEntry {
  pluginId: string;
  reason: string;
}

export interface PastureReport {
  /** Pasture-labelled, no grazingRestrictions, not allowlisted. */
  unallowlisted: string[];
  /** Allowlisted but no longer a gap. */
  stale: string[];
}

export function checkPastureCoverage(
  plugins: PesticidePlugin[],
  cropFamilyOf: (cropPluginId: string) => string | undefined,
  allowlist: PastureAllowlistEntry[]
): PastureReport {
  const allowed = new Set(allowlist.map((e) => e.pluginId));
  const gaps = new Set(
    plugins
      .filter((p) => p.grazingRestrictions === undefined && isPastureLabelled(p, cropFamilyOf))
      .map((p) => p.pluginId)
  );
  return {
    unallowlisted: [...gaps].filter((id) => !allowed.has(id)).sort(),
    stale: allowlist
      .map((e) => e.pluginId)
      .filter((id) => !gaps.has(id))
      .sort()
  };
}

/**
 * Phase 33C (M-17): a `manureCarryoverDays` value must appear in its quote
 * as "<n> days". Returns "pluginId: problem" lines.
 */
export function carryoverDaysQuoteGaps(
  plugins: Array<{ pluginId: string; grazingRestrictions?: GrazingRestrictions }>,
  sources: SourceMap
): string[] {
  const gaps: string[] = [];
  for (const p of plugins) {
    const n = p.grazingRestrictions?.manureCarryoverDays;
    if (n === undefined) continue;
    const entry = sourceEntrySchema.safeParse(sources[p.pluginId]?.manureCarryoverDays);
    if (!entry.success) {
      gaps.push(`${p.pluginId}: manureCarryoverDays has no complete source`);
      continue;
    }
    if (!new RegExp(`\\b${n} days\\b`).test(entry.data.quote)) {
      gaps.push(`${p.pluginId}: quote does not say "${n} days"`);
    }
  }
  return gaps;
}

/** One entry of apps/web/scripts/forage-toxicity-sources.json. */
export interface ForageSourceEntry {
  pluginIds?: string[];
  sources?: unknown[];
}

function hasShippableSource(entry: ForageSourceEntry | undefined): boolean {
  return (entry?.sources ?? []).some((raw) => {
    const s = sourceEntrySchema.safeParse(raw);
    return s.success && !isPageReaderSource(s.data);
  });
}

function countedCropEntries(
  entries: Record<string, ForageSourceEntry>,
  kind: ForageHazardKind
): Array<[string, ForageSourceEntry]> {
  return Object.entries(entries).filter(
    ([key]) =>
      key.startsWith(FORAGE_CROP_ENTRY_PREFIX[kind]) &&
      !FORAGE_CROP_ENTRIES_NEVER_COUNTED.includes(key)
  );
}

/**
 * Phase 33C (M-23): every crop forage hazard and trigger rests on a source
 * that is not a page-reader extraction, and every crop research mapped to
 * a hazard either carries it or is excluded with a reason. Returns
 * "pluginId: problem" lines; empty means covered.
 */
export function forageHazardGaps(
  crops: Array<{ pluginId: string; forageHazards?: ForageHazard[] }>,
  entries: Record<string, ForageSourceEntry>,
  exclusions: Readonly<Record<string, string>> = FORAGE_PLUGIN_EXCLUSIONS
): string[] {
  const gaps: string[] = [];
  const byId = new Map(crops.map((c) => [c.pluginId, c]));
  const kinds = Object.keys(FORAGE_CROP_ENTRY_PREFIX) as ForageHazardKind[];

  for (const kind of kinds) {
    for (const [trigger, key] of Object.entries(FORAGE_TRIGGER_SOURCE_KEYS[kind])) {
      if (!hasShippableSource(entries[key])) {
        gaps.push(`${kind} ${trigger}: ${key} has no source that is not a page reader`);
      }
    }
  }

  for (const c of crops) {
    for (const h of c.forageHazards ?? []) {
      const backed = countedCropEntries(entries, h.kind).some(
        ([, e]) => (e.pluginIds ?? []).includes(c.pluginId) && hasShippableSource(e)
      );
      if (!backed) gaps.push(`${c.pluginId}: ${h.kind} is not named by a shippable source`);
      for (const t of h.triggers) {
        if (!FORAGE_TRIGGER_SOURCE_KEYS[h.kind][t]) {
          gaps.push(`${c.pluginId}: ${h.kind} trigger ${t} has no source`);
        }
      }
    }
    if (c.forageHazards && exclusions[c.pluginId]) {
      gaps.push(`${c.pluginId}: excluded but carries forageHazards`);
    }
  }

  const mapped = new Set<string>();
  for (const kind of kinds) {
    for (const [key, e] of countedCropEntries(entries, kind)) {
      for (const id of e.pluginIds ?? []) {
        mapped.add(id);
        if (exclusions[id]) continue;
        const crop = byId.get(id);
        if (!crop) gaps.push(`${id}: named in ${key} but no crop plugin has that id`);
        else if (!(crop.forageHazards ?? []).some((h) => h.kind === kind)) {
          gaps.push(`${id}: named in ${key} but carries no ${kind} hazard and is not excluded`);
        }
      }
    }
  }
  for (const [id, reason] of Object.entries(exclusions)) {
    if (!mapped.has(id)) gaps.push(`${id}: excluded but not named in any crop entry`);
    if (reason.trim().length <= 10) gaps.push(`${id}: exclusion reason is too short`);
  }
  return gaps;
}
