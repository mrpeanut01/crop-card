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
import { CROP_PRESERVING_METHODS, SEEDING_RATE_KEYS } from './schemas';
import { calendarWindowFromWords } from '../plan/calendarWords';
import { numberPattern, statesDays, statesInches } from './quoteNumbers';
import { quoteNamesAny, quoteNamesCrop } from '../garden/herbQuoteNames';
import { isHerbGardenCrop } from '$lib/garden/herbs';
import {
  quoteNamesHerb,
  quoteStatesLifecycle,
  quoteStatesZone
} from '$lib/garden/lifecycleSources';
import type {
  ForageHazard,
  ForageHazardKind,
  AnimalHealthPlugin,
  CropPlugin,
  CropSprayWindow,
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
  if (guide.seedingRate) {
    const rate = guide.seedingRate;
    paths.push(
      ...present('seedingRate.', rate, [
        ...SEEDING_RATE_KEYS,
        'seedBasis',
        'purpose',
        'droughtySoilCutPct'
      ])
    );
    for (const m of rate.sownBy ?? []) paths.push(`seedingRate.sownBy.${m}`);
  }
  for (const entry of c.animalToxicity ?? []) {
    for (const id of entry.speciesIds) paths.push(`animalToxicity.${id}`);
  }
  for (const row of c.treeSizeClasses ?? []) paths.push(`treeSizeClasses.${row.sizeClass}`);
  if (c.nitrogenNeedLbPerAcre) paths.push('nitrogenNeedLbPerAcre');
  if (c.harvestSeason) paths.push('harvestSeason');
  if (c.waterNeed) paths.push('waterNeed'); // Phase 37E
  if (c.sunNeed) paths.push('sunNeed'); // Close-out D2
  for (const t of c.careTasks ?? []) paths.push(`careTasks.${t.key}`); // Phase 37F
  if (c.growthHabit) paths.push('growthHabit'); // Phase 37F
  for (const [, key] of rowSpacingFields(c)) if (!paths.includes(key)) paths.push(key);
  if (guide.inRowSpacingIn !== undefined) paths.push('inRowSpacingIn');
  if (c.fertility) {
    paths.push(
      ...present('fertility.preplant.', c.fertility.preplant, [...FERTILITY_PREPLANT_KEYS])
    );
    for (const t of c.fertility.topdressN ?? []) {
      paths.push(`fertility.topdressN.${t.stageCode ?? 'calendar'}`);
    }
  }
  if (!UNSOURCED_SPRAY_WINDOW_CROPS.has(c.pluginId)) {
    for (const w of c.sprayWindows ?? []) {
      const key = sprayWindowSourceKey(w);
      if (!paths.includes(key)) paths.push(key);
    }
  }
  if (isHerbGardenCrop(c.pluginId))
    for (const r of c.seasonalTasks ?? []) paths.push(`seasonalTasks.${r.key}`);
  paths.push(...herbHarvestFactPaths(c)); // Phase 37C
  paths.push(...harvestTimingFactPaths(c)); // #867 drying hint
  if (c.winterHardyToZone) paths.push('winterHardyToZone');
  return paths;
}

export const FERTILITY_PREPLANT_KEYS = ['nLbPerAcre', 'p2o5LbPerAcre', 'k2oLbPerAcre'] as const;

/** #720: the source key for a crop spray window. */
export function sprayWindowSourceKey(
  w: Pick<CropSprayWindow, 'purpose' | 'chemistryClass'>
): string {
  return `sprayWindows.${w.purpose ?? 'unknown'}.${w.chemistryClass}`;
}

/** #720: crops whose spray windows predate the source rule (Phase 17 and
 *  Phase 21 defaults for sweet and ornamental corn and cucurbits). None was
 *  quoted from a source; source them and take them off this list, or drop
 *  them. Every other crop's windows must be quoted. */
export const UNSOURCED_SPRAY_WINDOW_CROPS: ReadonlySet<string> = new Set([
  'acorn-squash-table-queen',
  'bloody-butcher-ornamental-corn-raw-untreated-non-gmo-1-2-lb',
  'butternut-squash-waltham',
  'cantaloupe-hales-best',
  'corn-bantam-sweet',
  'corn-bloody-butcher',
  'corn-sweet-bodacious',
  'cucumber-marketmore-76',
  'fairytale-pumpkin-film-coated-treated-seed',
  'ornamental-corn-earth-tones-dent-raw-untreated-non-gmo',
  'ornamental-corn-oxacana-green-dent',
  'popcorn-strawberry',
  'pumpkin-cinderella-film-coated-treated',
  'pumpkin-ez-gro-monster',
  'pumpkin-flat-white-boer-ford-standard-treated-harris-seeds',
  'pumpkin-grizzly-bear-film-coated-farmore-harris-seeds',
  'pumpkin-jarrahdale-film-coat-treated',
  'pumpkin-rouge-vif-d-etampes-film-coated-treated',
  'pumpkin-silver-moon-film-coated-treated',
  'pumpkin',
  'squash-butterkin-film-coated-farmore',
  'squash-marina-de-chioggia-film-coated-treated',
  'squash-queensland-blue-raw-untreated-non-gmo',
  'squash-sunshine-standard-treated',
  'summer-squash-yellow-crookneck',
  'watermelon-sugar-baby',
  'zucchini-black-beauty'
]);

/** #720: every sourced spray window comes from an extension, government or
 *  label page, and its quote states each day offset (a 0 offset from
 *  planting names planting) and, for a stage window, the stage is one of
 *  the crop's growth stages. Returns "pluginId: problem" lines. */
export function sprayWindowQuoteGaps(
  crops: ReadonlyArray<Pick<CropPlugin, 'pluginId' | 'sprayWindows' | 'growthStageTable'>>,
  sources: SourceMap
): string[] {
  const gaps: string[] = [];
  for (const c of crops) {
    if (UNSOURCED_SPRAY_WINDOW_CROPS.has(c.pluginId)) continue;
    for (const w of c.sprayWindows ?? []) {
      const key = sprayWindowSourceKey(w);
      if (!w.purpose) gaps.push(`${c.pluginId}: ${key} has no purpose`);
      const entry = sourceEntrySchema.safeParse(sources[c.pluginId]?.[key]);
      if (!entry.success) continue;
      if (!isAllowedSpacingSource(entry.data.url)) {
        gaps.push(`${c.pluginId}: ${key} source is not an extension or government page`);
      }
      for (const d of new Set([w.offsetDaysMin, w.offsetDaysMax])) {
        if (d === 0) {
          if (w.anchor === 'planting' && !/\bplant(ed|ing)?\b/i.test(entry.data.quote)) {
            gaps.push(`${c.pluginId}: ${key} quote does not name planting`);
          }
        } else if (!statesDays(entry.data.quote, d)) {
          gaps.push(`${c.pluginId}: ${key} quote does not state ${d} days`);
        }
      }
      if (w.anchor === 'stage' && !c.growthStageTable?.stages.some((s) => s.code === w.stageCode)) {
        gaps.push(`${c.pluginId}: ${key} stage ${w.stageCode} is not in the growth stage table`);
      }
    }
  }
  return gaps;
}

/** #720: each fertility figure appears in its quote ("zero N" for a 0 N),
 *  and each topdress stage is one of the crop's growth stages. */
export function fertilityQuoteGaps(
  crops: ReadonlyArray<Pick<CropPlugin, 'pluginId' | 'fertility' | 'growthStageTable'>>,
  sources: SourceMap
): string[] {
  const gaps: string[] = [];
  const quoteOf = (id: string, key: string) => {
    const e = sourceEntrySchema.safeParse(sources[id]?.[key]);
    return e.success ? e.data : null;
  };
  for (const c of crops) {
    if (!c.fertility) continue;
    for (const k of FERTILITY_PREPLANT_KEYS) {
      const v = c.fertility.preplant[k];
      if (v === undefined) continue;
      const entry = quoteOf(c.pluginId, `fertility.preplant.${k}`);
      if (!entry) continue;
      if (!isAllowedSpacingSource(entry.url)) {
        gaps.push(`${c.pluginId}: fertility.preplant.${k} source is not an extension page`);
      }
      const ok =
        v === 0
          ? k === 'nLbPerAcre' && /\bzero N\b/i.test(entry.quote)
          : quoteStates(entry.quote, String(v));
      if (!ok) gaps.push(`${c.pluginId}: fertility.preplant.${k} quote does not state ${v}`);
    }
    for (const t of c.fertility.topdressN ?? []) {
      const key = `fertility.topdressN.${t.stageCode ?? 'calendar'}`;
      const entry = quoteOf(c.pluginId, key);
      if (entry && !quoteStates(entry.quote, String(t.nLbPerAcre))) {
        gaps.push(`${c.pluginId}: ${key} quote does not state ${t.nLbPerAcre}`);
      }
      if (entry && !isAllowedSpacingSource(entry.url)) {
        gaps.push(`${c.pluginId}: ${key} source is not an extension page`);
      }
      if (t.calendar) {
        const words = t.calendar.sourceWords;
        if (entry && !entry.quote.includes(words)) {
          gaps.push(`${c.pluginId}: ${key} quote does not contain "${words}"`);
        }
        const w = calendarWindowFromWords(words);
        const same = (a: { month: number; day: number }, b: { month: number; day: number }) =>
          a.month === b.month && a.day === b.day;
        if (!w || !same(w.start, t.calendar.start) || !same(w.end, t.calendar.end)) {
          gaps.push(`${c.pluginId}: ${key} window is not what "${words}" names (ruling R720-2)`);
        }
      } else if (!c.growthStageTable?.stages.some((s) => s.code === t.stageCode)) {
        gaps.push(`${c.pluginId}: ${key} stage is not in the growth stage table`);
      }
    }
  }
  return gaps;
}

type RowSpacingKey = 'rowSpacingIn' | 'defaultRowSpacingInches';

/** #591: the row spacing fields a crop carries, each with the source key that
 *  covers it. `defaultRowSpacingInches` shares the `rowSpacingIn` source only
 *  when the two values are equal (ruling Q5); a different value needs its own. */
export function rowSpacingFields(
  c: Pick<CropPlugin, 'plantingGuide' | 'defaultRowSpacingInches'>
): Array<[field: RowSpacingKey, sourceKey: RowSpacingKey, inches: number]> {
  const out: Array<[RowSpacingKey, RowSpacingKey, number]> = [];
  const row = c.plantingGuide?.rowSpacingIn;
  const def = c.defaultRowSpacingInches;
  if (row !== undefined) out.push(['rowSpacingIn', 'rowSpacingIn', row]);
  if (def !== undefined) {
    out.push([
      'defaultRowSpacingInches',
      row === def ? 'rowSpacingIn' : 'defaultRowSpacingInches',
      def
    ]);
  }
  return out;
}

/** #587: a tree crop (archetype `tree-fruit-multi-pick`, or one with a size
 *  class table) is spaced by its size class rows or its sourced minimum
 *  distance between trees; a between-row value must be sourced like any
 *  other number. */
export function isTreeCrop(c: Pick<CropPlugin, 'archetype' | 'treeSizeClasses'>): boolean {
  return c.archetype === 'tree-fruit-multi-pick' || (c.treeSizeClasses?.length ?? 0) > 0;
}

/** #587 / #591: every crop's row spacing (`plantingGuide.rowSpacingIn`,
 *  `defaultRowSpacingInches`) quote must state the number, in inches or as
 *  feet, and name rows; a crop with a size class table carries no row spacing
 *  at all (the table spaces it both ways, so the value would never be read).
 *  Every crop's in-row spacing quote is checked by `inRowSpacingQuoteGaps`
 *  (#600). Missing sources are
 *  reported by `checkSources` over `cropFactPaths`. Returns "pluginId:
 *  problem" lines. */
export function rowSpacingGaps(
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
    for (const [field, key, inches] of rowSpacingFields(c)) {
      if (c.treeSizeClasses?.length) {
        gaps.push(`${c.pluginId}: ${field} is never read when treeSizeClasses spaces the crop`);
        continue;
      }
      const entry = sourceEntrySchema.safeParse(sources[c.pluginId]?.[key]);
      if (!entry.success) continue;
      if (!statesInches(entry.data.quote, inches)) {
        gaps.push(`${c.pluginId}: ${field} quote does not state ${inches} in`);
      }
      // #587 ruling R2: an unlabelled "A x B" spacing never counts as rows.
      if (!/\brows?\b/i.test(entry.data.quote)) {
        gaps.push(`${c.pluginId}: ${field} quote does not say the figure is between rows`);
      }
    }
    const inRow = c.plantingGuide?.inRowSpacingIn;
    if (inRow) gaps.push(...inRowSpacingQuoteGaps(c, inRow, sources));
  }
  return gaps;
}

/** #600: hosts outside .edu and .gov that publish land-grant extension
 *  work (UF/IFAS EDIS is served from the Florida library network). */
const EXTENSION_HOSTS_OUTSIDE_EDU_GOV = ['journals.flvc.org'];

/** #600: an in-row source is a land-grant extension or government page;
 *  seed-company catalogs never count (#591 ruling Q3). */
export function isAllowedSpacingSource(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host.endsWith('.edu') || host.endsWith('.gov') || EXTENSION_HOSTS_OUTSIDE_EDU_GOV.includes(host)
  );
}

/** #600: the quote says the figure is spacing between plants, not rows
 *  ("Distance between plants in row", "12 inches apart", "thin to 4
 *  inches", "in-row spacing"). An unlabelled "18 x 36" names no axis. */
const IN_ROW_WORDS =
  /\bbetween plants\b|\bplants? in (the )?rows?\b|\bin[- ]row\b|\bin the row\b|\bapart\b|\bthin(ned|ning)?\b|\bplant spacing\b|\bwithin (a |the )?rows?\b|\bin all directions\b|\brow plants\b|\bbetween (trees|vines|bushes|hills|crowns|bulbs|cloves)\b/i;

/** #591 / #600: every crop's in-row spacing quote comes from an allowed
 *  host, states both ends of the stored range and, off tree crops (whose
 *  minimum distance between trees is used both ways), names the in-row
 *  axis. */
function inRowSpacingQuoteGaps(
  c: Pick<CropPlugin, 'pluginId' | 'archetype' | 'treeSizeClasses'>,
  inRow: { min: number; max: number },
  sources: SourceMap
): string[] {
  const entry = sourceEntrySchema.safeParse(sources[c.pluginId]?.inRowSpacingIn);
  if (!entry.success) return [];
  const gaps: string[] = [];
  if (!isAllowedSpacingSource(entry.data.url)) {
    gaps.push(`${c.pluginId}: inRowSpacingIn source is not an extension or government page`);
  }
  for (const end of new Set([inRow.min, inRow.max])) {
    if (!statesInches(entry.data.quote, end)) {
      gaps.push(`${c.pluginId}: inRowSpacingIn quote does not state ${end} in`);
    }
  }
  if (!isTreeCrop(c) && !IN_ROW_WORDS.test(entry.data.quote)) {
    gaps.push(`${c.pluginId}: inRowSpacingIn quote does not say the figure is between plants`);
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

const MONTH_WORDS = [
  'Jan(?:\\.|uary)?',
  'Feb(?:\\.|ruary)?',
  'Mar(?:\\.|ch)?',
  'Apr(?:\\.|il)?',
  'May',
  'June?\\.?',
  'July?\\.?',
  'Aug(?:\\.|ust)?',
  'Sep(?:t)?(?:\\.|tember)?',
  'Oct(?:\\.|ober)?',
  'Nov(?:\\.|ember)?',
  'Dec(?:\\.|ember)?'
] as const;

/** True when `quote` names the date as "<month> <day>" ("July 25",
 *  "Aug. 3", "Sept. 15"). */
export function statesMonthDay(quote: string, month: number, day: number): boolean {
  return new RegExp(`\\b${MONTH_WORDS[month - 1]}\\s+${day}(?!\\d)`, 'i').test(quote);
}

/** #686: a harvest season's quote comes from an extension or government
 *  page and states both dates; an end in the same month may give the day
 *  alone ("Aug. 25 to 31"). Returns "pluginId: problem" lines. */
export function harvestSeasonQuoteGaps(
  crops: ReadonlyArray<Pick<CropPlugin, 'pluginId' | 'harvestSeason'>>,
  sources: SourceMap
): string[] {
  const gaps: string[] = [];
  for (const c of crops) {
    const season = c.harvestSeason;
    if (!season) continue;
    const entry = sourceEntrySchema.safeParse(sources[c.pluginId]?.harvestSeason);
    if (!entry.success) continue;
    const quote = entry.data.quote;
    if (!isAllowedSpacingSource(entry.data.url)) {
      gaps.push(`${c.pluginId}: harvestSeason source is not an extension or government page`);
    }
    const { start, end } = season;
    if (!statesMonthDay(quote, start.month, start.day)) {
      gaps.push(`${c.pluginId}: harvestSeason quote does not state the start date`);
    }
    const endShort =
      end.month === start.month &&
      new RegExp(
        `\\b${MONTH_WORDS[start.month - 1]}\\s+${start.day}\\s*(?:-|–|—|to)\\s*${end.day}(?!\\d)`,
        'i'
      ).test(quote);
    if (!endShort && !statesMonthDay(quote, end.month, end.day)) {
      gaps.push(`${c.pluginId}: harvestSeason quote does not state the end date`);
    }
  }
  return gaps;
}

/** #739: a crop's N need quote comes from an extension or government page,
 *  names N and states every part ("125-150 lbs N", "20 lbs of N", "40-80
 *  lbs"; a part of 0 as "zero N"). Returns "pluginId: problem" lines. */
export function nitrogenNeedQuoteGaps(
  crops: ReadonlyArray<Pick<CropPlugin, 'pluginId' | 'nitrogenNeedLbPerAcre'>>,
  sources: SourceMap
): string[] {
  const gaps: string[] = [];
  for (const c of crops) {
    const parts = c.nitrogenNeedLbPerAcre;
    if (!parts) continue;
    const entry = sourceEntrySchema.safeParse(sources[c.pluginId]?.nitrogenNeedLbPerAcre);
    if (!entry.success) continue;
    const quote = entry.data.quote;
    if (!isAllowedSpacingSource(entry.data.url)) {
      gaps.push(
        `${c.pluginId}: nitrogenNeedLbPerAcre source is not an extension or government page`
      );
    }
    if (!/\bN\b/.test(quote)) {
      gaps.push(`${c.pluginId}: nitrogenNeedLbPerAcre quote does not name N`);
    }
    for (const { min, max } of parts) {
      const stated =
        max === 0
          ? /\b(zero|no) N\b/i.test(quote)
          : new RegExp(
              `(^|[^\\d.,])${
                min === max
                  ? numberPattern(min)
                  : `${numberPattern(min)}\\s*(?:-|–|—|to)\\s*${numberPattern(max)}`
              }\\s*lbs?\\b`
            ).test(quote);
      if (!stated) {
        gaps.push(`${c.pluginId}: nitrogenNeedLbPerAcre quote does not state ${min}-${max} lbs`);
      }
    }
  }
  return gaps;
}

const PURPOSE_WORDS: Record<'smother' | 'green-manure', RegExp> = {
  smother: /\bsmother/i,
  'green-manure': /\bgreen[- ]manure/i
};

const SOWN_WORDS: Record<'drilled' | 'broadcast', RegExp> = {
  drilled: /\bdrill/i,
  broadcast: /\bbroadcast/i
};

/** A seeding rate range must appear in its quote ("60-120", "60–120",
 *  "60 to 120", "6- to 7-inch", "7-inch to 8-inch", "25,000 to 33,000"; one
 *  figure when min = max), and a seed basis must match the quote: `pls` names pure live
 *  seed and `bulk` never does. #576: a purpose quote names the purpose and
 *  shares a rate entry's URL; a droughty-soil cut states its percent range,
 *  "droughty" and the high-potential condition; each `sownBy` method's quote
 *  names it; a seedingRate needs a rate, a row width or `sownBy`. Returns
 *  "pluginId: problem" lines. */
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
    const entryFor = (key: string) => {
      const e = sourceEntrySchema.safeParse(sources[c.pluginId]?.[`seedingRate.${key}`]);
      return e.success ? e.data : null;
    };
    const rateKeys = SEEDING_RATE_KEYS.filter((k) => k !== 'drillRowSpacingIn' && rate[k]);
    if (!SEEDING_RATE_KEYS.some((k) => rate[k]) && !rate.sownBy?.length) {
      gaps.push(`${c.pluginId}: seedingRate has no rate, row width or sownBy`);
    }
    if (rate.purpose) {
      const entry = entryFor('purpose');
      if (entry) {
        if (!PURPOSE_WORDS[rate.purpose].test(entry.quote)) {
          gaps.push(`${c.pluginId}: seedingRate.purpose quote does not say ${rate.purpose}`);
        }
        const urls = rateKeys.map((k) => entryFor(k)?.url).filter(Boolean);
        if (!urls.includes(entry.url)) {
          gaps.push(`${c.pluginId}: seedingRate.purpose is not from a rate's own source`);
        }
      }
      if (rateKeys.length === 0) gaps.push(`${c.pluginId}: seedingRate.purpose has no rate`);
    }
    if (rate.droughtySoilCutPct) {
      const entry = entryFor('droughtySoilCutPct');
      const { min, max } = rate.droughtySoilCutPct;
      const pct = new RegExp(`(^|[^\\d])${min}%?\\s*(?:-|–|—|to)\\s*${max}%`);
      if (
        entry &&
        !(
          pct.test(entry.quote) &&
          /droughty/i.test(entry.quote) &&
          /high production potential/i.test(entry.quote)
        )
      ) {
        gaps.push(
          `${c.pluginId}: seedingRate.droughtySoilCutPct quote does not state ${min}-${max}% on droughty soils against a high-potential rate`
        );
      }
    }
    for (const m of rate.sownBy ?? []) {
      const entry = entryFor(`sownBy.${m}`);
      if (entry && !SOWN_WORDS[m].test(entry.quote)) {
        gaps.push(`${c.pluginId}: seedingRate.sownBy.${m} quote does not name ${m}`);
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
  crops: readonly Pick<CropPlugin, 'pluginId' | 'seasonalTasks'>[]
): string[] {
  const out: string[] = [];
  for (const c of crops) {
    const lists = [['seasonalTasks', c.seasonalTasks ?? []]] as const;
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
 *  source entry under `seasonalTasks.<key>`
 *  whose quote states every number the row writes. Returns
 *  "pluginId field.key: problem" lines. */
export function seasonalTaskNumberGaps(
  crops: readonly Pick<CropPlugin, 'pluginId' | 'seasonalTasks'>[],
  sources: SourceMap
): string[] {
  const out: string[] = [];
  for (const c of crops) {
    const lists = [['seasonalTasks', c.seasonalTasks ?? []]] as const;
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
  const forage = (f: string | undefined) => f === 'forage' || f === 'forage-grass';
  if (claims?.safeForCropFamilies?.some(forage)) return true;
  if (claims?.safeForCropPluginIds?.some((id) => forage(cropFamilyOf(id)))) return true;
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

// ─── Phase 37C: preserving and harvest cadence ─────────────────────────

/** Phase 37C: the source keys for a crop's `preserving` entries and its
 *  `harvestCadence`; an infuse entry also needs its food-safety line. */
export function herbHarvestFactPaths(
  c: Pick<CropPlugin, 'preserving' | 'harvestCadence'>
): string[] {
  const paths: string[] = [];
  for (const p of c.preserving ?? []) {
    paths.push(preservingSourceKey(p));
    if (p.method === 'infuse') paths.push(`${preservingSourceKey(p)}.safety`); // Close-out D2
  }
  if (c.harvestCadence) paths.push('harvestCadence');
  return paths;
}

type PreservingMethodKey = NonNullable<CropPlugin['preserving']>[number]['method'];

const FREEZE_DRY_WORDS = /\bfreeze[- ]?dr(?:y|ied|ies|ying|ier)\b|\blyophili[sz]/gi;

/** The quote names the method. "Freeze-dried" names freeze-dry only, never
 *  dry or freeze. */
const PRESERVING_METHOD_WORDS: Record<Exclude<PreservingMethodKey, 'freeze-dry'>, RegExp> = {
  fresh: /\bfresh\b/i,
  dry: /\bdr(?:y|ied|ies|ying)\b/i,
  freeze: /\bfr(?:eez(?:e|es|ing)|oz(?:en)?)\b/i,
  infuse:
    /\binfus(?:e|ed|es|ing|ion)\b|\bin (?:olive )?oil\b|\b(?:herb|herbal|flavou?red) (?:oils?|vinegars?)\b/i
};

/** Qualifying words a source uses when a method works only fairly well, or
 *  poorly. A `good` entry needs none and must carry none (CO-9); a bare
 *  "do not" or "less" never qualifies. */
const SUITABILITY_WORDS: Record<'fair' | 'poor', RegExp> = {
  fair: /\b(?:fairly|moderately|somewhat|less (?:flavou?rful|aromatic|well|successfully|satisfactory|desirable)|(?:will|may) mold|not as (?:well|good)|loses? some|some of (?:the|its) (?:flavou?r|aroma|colou?r)|acceptable)\b/i,
  poor: /\b(?:poor(?:ly)?|(?:does not|do not|don't|doesn't)\s+(?:[a-z]+\s+){0,2}?(?:well|retain|keep|hold)|not recommended|not suitable|unsuitable|loses? (?:most|much)|best (?:used )?fresh|turns? (?:an? )?(?:[a-z]+ ){0,2}?(?:black|brown))\b/i
};

/** The fair or poor words a quote's sentences that name the crop carry for
 *  the method, if any. "Best used fresh" is never a warning about fresh
 *  use. */
export function preservingWarningOf(
  quote: string,
  method: PreservingMethodKey,
  crop: { pluginId: string; displayName: string }
): 'fair' | 'poor' | null {
  const sentences = quote
    .split(/(?<=[.!?])\s+/)
    .filter((s) => quoteNamesCrop(s, crop))
    .map((s) => (method === 'fresh' ? s.replace(/\bbest (?:used )?fresh\b/gi, ' ') : s));
  if (sentences.some((s) => SUITABILITY_WORDS.poor.test(s))) return 'poor';
  if (sentences.some((s) => SUITABILITY_WORDS.fair.test(s))) return 'fair';
  return null;
}

function namesMethod(quote: string, method: PreservingMethodKey): boolean {
  if (method === 'freeze-dry') return new RegExp(FREEZE_DRY_WORDS.source, 'i').test(quote);
  const rest =
    method === 'dry' || method === 'freeze' ? quote.replace(FREEZE_DRY_WORDS, ' ') : quote;
  return PRESERVING_METHOD_WORDS[method].test(rest);
}

/** Phase 37C: each `preserving.<method>` quote comes from an extension or
 *  government page, names the method and the crop, and for `fair` or `poor`
 *  carries the source's qualifying words. An infuse entry is checked by
 *  `infuseRowGaps`. Returns "pluginId: problem" lines; a missing source is
 *  `checkSources`' report. */
export function preservingQuoteGaps(
  crops: ReadonlyArray<Pick<CropPlugin, 'pluginId' | 'displayName' | 'preserving'>>,
  sources: SourceMap
): string[] {
  const gaps: string[] = [];
  for (const c of crops) {
    for (const p of c.preserving ?? []) {
      const key = preservingSourceKey(p);
      if (sources[c.pluginId]?.[preservingNotRecordedKey(p.method)] !== undefined) {
        gaps.push(`${c.pluginId}: ${key} is set; drop ${preservingNotRecordedKey(p.method)}`);
      }
      const entry = sourceEntrySchema.safeParse(sources[c.pluginId]?.[key]);
      if (entry.success) {
        const quote = entry.data.quote;
        if (!isAllowedSpacingSource(entry.data.url)) {
          gaps.push(`${c.pluginId}: ${key} source is not an extension or government page`);
        }
        if (!namesMethod(quote, p.method)) {
          gaps.push(`${c.pluginId}: ${key} quote does not name the method`);
        }
        if (!quoteNamesCrop(quote, c)) {
          gaps.push(`${c.pluginId}: ${key} quote does not name the crop`);
        }
        if (p.suitability !== 'good' && !SUITABILITY_WORDS[p.suitability].test(quote)) {
          gaps.push(`${c.pluginId}: ${key} quote has no words that say ${p.suitability}`);
        }
        const warning = p.suitability === 'good' ? preservingWarningOf(quote, p.method, c) : null;
        if (warning) {
          gaps.push(`${c.pluginId}: ${key} is good but its quote has words that say ${warning}`);
        }
      }
      if (p.method === 'infuse') gaps.push(...infuseRowGaps(c, p, sources)); // Close-out D2
    }
  }
  return gaps;
}

function isEduHost(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().endsWith('.edu');
  } catch {
    return false;
  }
}

const CADENCE_INTERVAL_WORDS =
  /\bevery\b|\bbetween (?:cuts|cuttings|harvests|clippings|pickings)\b|\bapart\b|\bintervals?\b|\bagain (?:in|after)\b/i;
const VAGUE_INTERVAL_WORDS =
  /\b(?:a few|several|a couple of|couple of|a couple)\s+(?:days|weeks)\b/i;
/** CO-6 (F867-1): the interval is between cuts or harvests; pinching and
 *  pruning are not a harvest cadence. */
const CADENCE_HARVEST_VERB =
  /\b(?:cut|cuts|cutting|cuttings|harvest|harvests|harvested|harvesting|clip|clips|clipped|clipping|clippings|pick|picks|picked|picking|pickings)\b/i;
const CADENCE_NOT_HARVEST_VERB = /\bpinch(?:es|ed|ing)?\b|\bprun(?:e|es|ed|ing)\b/i;

/** Phase 37C: a `harvestCadence` quote comes from an extension or
 *  government page, names the crop, states both ends of the interval as
 *  days or whole weeks and says it is the time between cuts. "A few weeks"
 *  never counts. */
export function harvestCadenceQuoteGaps(
  crops: ReadonlyArray<Pick<CropPlugin, 'pluginId' | 'displayName' | 'harvestCadence'>>,
  sources: SourceMap
): string[] {
  const gaps: string[] = [];
  for (const c of crops) {
    const cadence = c.harvestCadence;
    if (!cadence) continue;
    if (sources[c.pluginId]?.[HARVEST_CADENCE_NOT_RECORDED_KEY] !== undefined) {
      gaps.push(`${c.pluginId}: harvestCadence is set; drop ${HARVEST_CADENCE_NOT_RECORDED_KEY}`);
    }
    const entry = sourceEntrySchema.safeParse(sources[c.pluginId]?.harvestCadence);
    if (!entry.success) continue;
    const quote = entry.data.quote;
    if (!isAllowedSpacingSource(entry.data.url)) {
      gaps.push(`${c.pluginId}: harvestCadence source is not an extension or government page`);
    }
    if (!quoteNamesCrop(quote, c)) {
      gaps.push(`${c.pluginId}: harvestCadence quote does not name the crop`);
    }
    if (!CADENCE_INTERVAL_WORDS.test(quote)) {
      gaps.push(`${c.pluginId}: harvestCadence quote does not say it is the time between cuts`);
    }
    if (!CADENCE_HARVEST_VERB.test(quote)) {
      gaps.push(`${c.pluginId}: harvestCadence quote has no cut or harvest verb`);
    }
    if (CADENCE_NOT_HARVEST_VERB.test(quote)) {
      gaps.push(`${c.pluginId}: harvestCadence quote is about pinching or pruning, not harvest`);
    }
    const { min, max } = cadence.everyDays;
    if (!(statesDays(quote, min) && statesDays(quote, max))) {
      gaps.push(
        VAGUE_INTERVAL_WORDS.test(quote)
          ? `${c.pluginId}: harvestCadence quote gives no number ("a few weeks" never counts)`
          : `${c.pluginId}: harvestCadence quote does not state ${min}-${max} days`
      );
    }
  }
  return gaps;
}

// ─── #867: when to cut for a preserving method ─────────────────────────

/** Why a crop has no `harvestTiming` although a source was read (sources
 *  disagree): `{ reason }` under `harvestTiming.notRecorded`. */
export const HARVEST_TIMING_NOT_RECORDED_KEY = 'harvestTiming.notRecorded';

/** The source key for each `harvestTiming` row. */
export function harvestTimingFactPaths(c: Pick<CropPlugin, 'harvestTiming'>): string[] {
  return (c.harvestTiming ?? []).map((r) => `harvestTiming.${r.method}`);
}

type HarvestTimingStageKey = NonNullable<CropPlugin['harvestTiming']>[number]['stage'];

const FLOWER_WORD = String.raw`(?:flowers?|flowering|blooms?|blooming|blossoms?|blossoming)`;

/** CO-9: words after "before the flowers" that put the cut in or after
 *  bloom ("before the flowers fade", "before the blooms open fully"). */
const LATE_BLOOM_WORDS = String.raw`(?:(?:have|are|begin to|start to)\s+)?(?:fade|fades|faded|fading|fully\s+open(?:ed)?|open(?:s|ed)?\s+fully|go(?:es)?\s+to\s+seed|set\s+seed|drop|dry\s+up)\b`;

/** The words a source uses for each stage. "Before" covers "prior to the
 *  appearance of flowers" and "before the plant flowers"; "begins" covers
 *  "just as flowering begins" and "when the first flowers open". */
const HARVEST_TIMING_STAGE_WORDS: Record<HarvestTimingStageKey, RegExp> = {
  'before-bloom': new RegExp(
    String.raw`\b(?:before|prior to)\s+(?:(?:the|its|it|any)\s+)?(?:(?:appearance|opening)\s+of\s+(?:the\s+)?)?(?:plants?\s+)?${FLOWER_WORD}\b(?!\s+${LATE_BLOOM_WORDS})`,
    'i'
  ),
  'bloom-begins': new RegExp(
    String.raw`\bjust\s+as\s+(?:the\s+)?(?:flowers?\s+(?:begin|begins|start|starts)\s+to\s+(?:appear|open)|flowering\s+(?:begins|starts))\b|\bwhen\s+(?:the\s+)?first\s+(?:flowers|blossoms|blooms)\s+(?:begin\s+to\s+)?(?:appear|open)\b`,
    'i'
  )
};

/** Timing words for a stage the field has no value for (in or after bloom).
 *  A quote holding them, or the words of two stages, reads both ways. */
const OTHER_BLOOM_TIMING_WORDS = new RegExp(
  String.raw`\bin\s+(?:full\s+)?(?:bloom|flower)\b|\bwhile\s+in\s+flower\b|\bduring\s+(?:the\s+)?(?:bloom|blooming|flowering)\b|\bat\s+(?:full\s+)?bloom\b|\bafter\s+(?:flowering|blooming|bloom|blossoming)\b|\bfull\s+(?:flower|bloom)\b|\b${FLOWER_WORD}\s+${LATE_BLOOM_WORDS}`,
  'i'
);

/** #867 (rulings DH-1 to DH-8 in docs/design/phase-37-followups/drying-hint.md):
 *  each `harvestTiming.<method>` quote comes from an extension or government
 *  page, names the crop, the method and the stage, and states no other
 *  stage, so a source that allows "before or when the first blossoms open"
 *  never counts. A crop recorded as `harvestTiming.notRecorded` (sources
 *  disagree) carries no row. Returns "pluginId: problem" lines; a missing
 *  source is `checkSources`' report. */
export function harvestTimingQuoteGaps(
  crops: ReadonlyArray<Pick<CropPlugin, 'pluginId' | 'displayName' | 'harvestTiming'>>,
  sources: SourceMap
): string[] {
  const gaps: string[] = [];
  for (const c of crops) {
    const rows = c.harvestTiming ?? [];
    if (rows.length > 0 && sources[c.pluginId]?.[HARVEST_TIMING_NOT_RECORDED_KEY] !== undefined) {
      gaps.push(`${c.pluginId}: harvestTiming is set; drop ${HARVEST_TIMING_NOT_RECORDED_KEY}`);
    }
    for (const r of rows) {
      const key = `harvestTiming.${r.method}`;
      const entry = sourceEntrySchema.safeParse(sources[c.pluginId]?.[key]);
      if (!entry.success) continue;
      const quote = entry.data.quote;
      if (!isAllowedSpacingSource(entry.data.url)) {
        gaps.push(`${c.pluginId}: ${key} source is not an extension or government page`);
      }
      if (!quoteNamesCrop(quote, c)) {
        gaps.push(`${c.pluginId}: ${key} quote does not name the crop`);
      }
      if (!namesMethod(quote, r.method)) {
        gaps.push(`${c.pluginId}: ${key} quote does not name the method`);
      }
      if (!HARVEST_TIMING_STAGE_WORDS[r.stage].test(quote)) {
        gaps.push(`${c.pluginId}: ${key} quote does not state ${r.stage}`);
      }
      const others = (Object.keys(HARVEST_TIMING_STAGE_WORDS) as HarvestTimingStageKey[]).filter(
        (s) => s !== r.stage && HARVEST_TIMING_STAGE_WORDS[s].test(quote)
      );
      if (others.length > 0 || OTHER_BLOOM_TIMING_WORDS.test(quote)) {
        gaps.push(`${c.pluginId}: ${key} quote also states another stage`);
      }
    }
  }
  return gaps;
}

// Phase 37B (R-17): lifecycle and winter zone sources, herbs only.

/** Why a herb's lifecycle has no quote yet: `{ reason }` under
 *  `lifecycle.notRecorded`. */
export const LIFECYCLE_NOT_RECORDED_KEY = 'lifecycle.notRecorded';
/** Why a perennial herb has no `winterHardyToZone` yet. */
export const ZONE_NOT_RECORDED_KEY = 'winterHardyToZone.notRecorded';

/** CO-7: why a Phase 37 herb field is empty, under `<field>.notRecorded`:
 *  the reason, the pages checked and the day they were checked, plus the
 *  disagreeing `quotes` when sources were read (CO-3). */
export const notRecordedEntrySchema = z
  .object({
    reason: z.string().trim().min(11),
    checked: z.array(z.string().regex(/^https?:\/\/\S+$/)).min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quotes: z.array(sourceEntrySchema).optional()
  })
  .strict();
export type NotRecordedEntry = z.infer<typeof notRecordedEntrySchema>;

export const WATER_NEED_NOT_RECORDED_KEY = 'waterNeed.notRecorded';
export const HARVEST_CADENCE_NOT_RECORDED_KEY = 'harvestCadence.notRecorded';

export function preservingNotRecordedKey(method: string): string {
  return `preserving.${method}.notRecorded`;
}

function notRecordedReason(
  sources: SourceMap,
  pluginId: string,
  key: string = LIFECYCLE_NOT_RECORDED_KEY
): string | null {
  const entry = notRecordedEntrySchema.safeParse(sources[pluginId]?.[key]);
  return entry.success ? entry.data.reason : null;
}

/** A listed herb's `agronomy.lifecycle` carries a `lifecycle` source from
 *  an extension or government page whose quote names the crop and states
 *  the lifecycle word (or its plural, as a table heading), or a
 *  `lifecycle.notRecorded` reason. A herb with no lifecycle needs the
 *  reason too. Returns "pluginId: problem" lines. */
export function lifecycleQuoteGaps(
  crops: ReadonlyArray<Pick<CropPlugin, 'pluginId' | 'agronomy'>>,
  sources: SourceMap
): string[] {
  const gaps: string[] = [];
  for (const c of crops) {
    if (!isHerbGardenCrop(c.pluginId)) continue;
    const lifecycle = c.agronomy?.lifecycle;
    const raw = sources[c.pluginId]?.lifecycle;
    const reason = notRecordedReason(sources, c.pluginId);
    if (raw === undefined) {
      if (!reason) {
        gaps.push(`${c.pluginId}: no lifecycle source and no ${LIFECYCLE_NOT_RECORDED_KEY} reason`);
      }
      continue;
    }
    const entry = sourceEntrySchema.safeParse(raw);
    if (!entry.success) {
      gaps.push(`${c.pluginId}: lifecycle source is invalid`);
      continue;
    }
    if (!lifecycle) {
      gaps.push(`${c.pluginId}: lifecycle source but the plugin has no agronomy.lifecycle`);
      continue;
    }
    if (reason)
      gaps.push(`${c.pluginId}: lifecycle is sourced; drop ${LIFECYCLE_NOT_RECORDED_KEY}`);
    const { url, quote } = entry.data;
    if (!isAllowedSpacingSource(url)) {
      gaps.push(`${c.pluginId}: lifecycle source is not an extension or government page`);
    }
    if (!quoteNamesHerb(c.pluginId, quote)) {
      gaps.push(`${c.pluginId}: lifecycle quote does not name the crop`);
    }
    if (!quoteStatesLifecycle(lifecycle, quote)) {
      gaps.push(`${c.pluginId}: lifecycle quote does not state ${lifecycle}`);
    }
  }
  return gaps;
}

/** A listed herb's `winterHardyToZone` is on a perennial and its quote,
 *  from an extension or government page, names the crop, says "zone" and
 *  states the stored number (and letter when stored). A perennial herb with
 *  no zone needs a `winterHardyToZone.notRecorded` reason. A missing source
 *  is reported by `checkSources` over `cropFactPaths`. */
export function winterHardyToZoneQuoteGaps(
  crops: ReadonlyArray<Pick<CropPlugin, 'pluginId' | 'agronomy' | 'winterHardyToZone'>>,
  sources: SourceMap
): string[] {
  const gaps: string[] = [];
  for (const c of crops) {
    if (!isHerbGardenCrop(c.pluginId)) continue;
    const zone = c.winterHardyToZone;
    const reason = notRecordedReason(sources, c.pluginId, ZONE_NOT_RECORDED_KEY);
    if (!zone) {
      if (c.agronomy?.lifecycle === 'perennial' && !reason) {
        gaps.push(
          `${c.pluginId}: perennial with no winterHardyToZone and no ${ZONE_NOT_RECORDED_KEY} reason`
        );
      }
      continue;
    }
    if (reason) gaps.push(`${c.pluginId}: winterHardyToZone is set; drop ${ZONE_NOT_RECORDED_KEY}`);
    if (c.agronomy?.lifecycle !== 'perennial') {
      gaps.push(`${c.pluginId}: winterHardyToZone on a crop that is not a perennial`);
    }
    const entry = sourceEntrySchema.safeParse(sources[c.pluginId]?.winterHardyToZone);
    if (!entry.success) continue;
    const { url, quote } = entry.data;
    if (!isAllowedSpacingSource(url)) {
      gaps.push(`${c.pluginId}: winterHardyToZone source is not an extension or government page`);
    }
    if (!quoteNamesHerb(c.pluginId, quote)) {
      gaps.push(`${c.pluginId}: winterHardyToZone quote does not name the crop`);
    }
    if (!quoteStatesZone(zone, quote)) {
      gaps.push(`${c.pluginId}: winterHardyToZone quote does not state zone ${zone}`);
    }
  }
  return gaps;
}

/** Phase 37F: quotes compare word for word, ignoring only spacing and
 *  typographic quote marks. */
function plainQuoteText(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const GROWTH_HABIT_WORDS: Record<'woody' | 'clumping', RegExp> = {
  woody: /\bwoody\b/i,
  clumping: /\bclump(s|ing)?\b/i
};

/** Phase 37F (R-20): a crop's care task is quoted from an extension or
 *  government page, and its title and body each appear in the quote word
 *  for word; a growth habit's quote names it ("woody", "clump"). Returns
 *  "pluginId: problem" lines; missing entries are `checkSources`' job. */
export function cropCareQuoteGaps(
  crops: ReadonlyArray<Pick<CropPlugin, 'pluginId' | 'careTasks' | 'growthHabit'>>,
  sources: SourceMap
): string[] {
  const gaps: string[] = [];
  for (const c of crops) {
    for (const task of c.careTasks ?? []) {
      const key = `careTasks.${task.key}`;
      const entry = sourceEntrySchema.safeParse(sources[c.pluginId]?.[key]);
      if (!entry.success) continue;
      if (!isAllowedSpacingSource(entry.data.url)) {
        gaps.push(`${c.pluginId}: ${key} source is not an extension or government page`);
      }
      const quote = plainQuoteText(entry.data.quote);
      for (const part of [task.title, task.body]) {
        if (part !== undefined && !quote.includes(plainQuoteText(part))) {
          gaps.push(`${c.pluginId}: ${key} text is not in its quote word for word`);
        }
      }
    }
    if (c.growthHabit) {
      const entry = sourceEntrySchema.safeParse(sources[c.pluginId]?.growthHabit);
      if (!entry.success) continue;
      if (!isAllowedSpacingSource(entry.data.url)) {
        gaps.push(`${c.pluginId}: growthHabit source is not an extension or government page`);
      }
      if (!GROWTH_HABIT_WORDS[c.growthHabit].test(entry.data.quote)) {
        gaps.push(`${c.pluginId}: growthHabit quote does not name ${c.growthHabit}`);
      }
    }
  }
  return gaps;
}

// ─── Phase 37E: watering need ───────────────────────────────────────────

/** The fixed phrases a `waterNeed` quote is read through. Longer phrases are
 *  matched first and blanked out, so "moderately moist soil" reads medium
 *  and never also high. */
export const WATER_NEED_PHRASES: Readonly<Record<'low' | 'medium' | 'high', readonly string[]>> = {
  low: [
    'dry soil',
    'drier soil',
    'dry side',
    'dry conditions',
    'dry, rocky',
    'rocky, dry',
    'drought tolerant',
    'drought-tolerant',
    'tolerates drought',
    'tolerant of drought',
    'allow the soil to dry',
    'let the soil dry'
  ],
  medium: [
    'moderate moisture',
    'moderate water',
    'moderately moist',
    'somewhat moist',
    'average moisture',
    'medium moisture'
  ],
  high: [
    'moist soil',
    'moist but well-drained',
    'moist but well drained',
    'moist, well-drained',
    'moist, but well-drained',
    'evenly moist',
    'consistently moist',
    'constantly moist',
    'uniformly moist',
    'uniform soil moisture',
    'keep the soil moist',
    'keep soil moist',
    'well-watered',
    'well watered',
    'plenty of water',
    'abundant moisture',
    'wet soil'
  ]
};

export type WaterNeed = 'low' | 'medium' | 'high';
const WATER_NEED_ORDER: readonly WaterNeed[] = ['low', 'medium', 'high'];

/** CO-9: the end words of a moisture range, so "dry to medium moisture"
 *  reads as low and medium and overlaps "drought-tolerant" at low. */
const WATER_RANGE_ENDS: Readonly<Record<string, WaterNeed>> = {
  dry: 'low',
  medium: 'medium',
  moist: 'high',
  wet: 'high'
};
const WATER_RANGE = new RegExp(
  String.raw`(?<![a-z])(${Object.keys(WATER_RANGE_ENDS).join('|')})\s+to\s+(${Object.keys(WATER_RANGE_ENDS).join('|')})(?![a-z])(?:\s+(?:moisture|soils?|conditions))?`,
  'g'
);

/** A negation up to three words before a phrase, or right after it, in the
 *  same clause: "never let the soil dry out", "not drought tolerant". */
const WATER_NEGATION_BEFORE =
  /(?:^|\s)(?:not|never|no|nor|don't|doesn't|isn't|aren't|cannot|can't|avoid|without)(?:\s+[a-z'-]+){0,3}\s*$/;
const WATER_NEGATION_AFTER = /^\s*(?:is|are)?\s*(?:not|never)\b/;

function spanOf(a: WaterNeed, b: WaterNeed): WaterNeed[] {
  const [i, j] = [WATER_NEED_ORDER.indexOf(a), WATER_NEED_ORDER.indexOf(b)].sort((x, y) => x - y);
  return WATER_NEED_ORDER.slice(i, j + 1);
}

function isNegated(text: string, start: number, end: number): boolean {
  const before =
    text
      .slice(0, start)
      .split(/[.,;:!?]/)
      .pop() ?? '';
  const after = text.slice(end).split(/[.,;:!?]/)[0] ?? '';
  return WATER_NEGATION_BEFORE.test(before) || WATER_NEGATION_AFTER.test(after);
}

/** The needs a quote states: one need, or every need a range spans
 *  ("dry to medium moisture" is low and medium). `'negated'` when a phrase
 *  is negated, null when it states none or two that do not overlap. */
export function waterNeedsOfQuote(quote: string): readonly WaterNeed[] | 'negated' | null {
  let text = ` ${quote.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ')} `;
  const statements: WaterNeed[][] = [];
  let negated = false;
  const blank = (m: RegExpExecArray) =>
    text.slice(0, m.index) + ' '.repeat(m[0].length) + text.slice(m.index + m[0].length);
  for (const m of [...text.matchAll(WATER_RANGE)]) {
    if (isNegated(text, m.index, m.index + m[0].length)) negated = true;
    statements.push(spanOf(WATER_RANGE_ENDS[m[1]], WATER_RANGE_ENDS[m[2]]));
    text = blank(m);
  }
  const phrases = (Object.entries(WATER_NEED_PHRASES) as Array<[WaterNeed, readonly string[]]>)
    .flatMap(([need, list]) => list.map((p) => ({ need, p })))
    .sort((a, b) => b.p.length - a.p.length);
  for (const { need, p } of phrases) {
    const re = new RegExp(`(?<![a-z])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'g');
    for (const m of [...text.matchAll(re)]) {
      if (isNegated(text, m.index, m.index + m[0].length)) negated = true;
      statements.push([need]);
      text = blank(m);
    }
  }
  if (negated) return 'negated';
  if (statements.length === 0) return null;
  const agreed = statements.reduce((acc, s) => acc.filter((n) => s.includes(n)));
  return agreed.length > 0 ? agreed : null;
}

/** The single water need a quote states, or null when it states none, a
 *  range of more than one, two that differ, or a negated one. */
export function waterNeedOfQuote(quote: string): WaterNeed | null {
  const needs = waterNeedsOfQuote(quote);
  return Array.isArray(needs) && needs.length === 1 ? needs[0] : null;
}

/** F867-2: a `waterNeed` quote is one passage that names the crop. Pieces
 *  joined with "...", " | " or as separate quoted strings are refused, save
 *  the ruled page-title name piece (hyssop, at review). */
export const WATER_NEED_TITLE_PIECES: Readonly<Record<string, string>> = {
  'hyssop-officinalis': 'Hyssopus officinalis'
};

export function isStitchedQuote(quote: string): boolean {
  return /\.\.\.|…|\s\|\s|"[^"]*"\s*;\s*"/.test(quote);
}

function waterNeedStitchAllowed(pluginId: string, quote: string): boolean {
  const title = WATER_NEED_TITLE_PIECES[pluginId];
  if (!title) return false;
  const pieces = [...quote.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return pieces.length === 2 && pieces[0] === title && !isStitchedQuote(pieces[1]);
}

/** Words that never name a crop on their own ("Summer Savory" is not named
 *  by "summer"). */
const GENERIC_NAME_WORDS: ReadonlySet<string> = new Set([
  'anise',
  'bee',
  'common',
  'east',
  'english',
  'french',
  'german',
  'greek',
  'green',
  'holy',
  'italian',
  'lemon',
  'mountain',
  'summer',
  'sweet'
]);

/** Ways a quote may name the crop: the name before the variety ("Basil —
 *  Genovese" gives basil), its first two words ("bee balm"), its first word
 *  unless that word is generic, the variety ("Mint — Spearmint" gives
 *  spearmint) and a binomial in parentheses ("origanum majorana"). */
export function cropNameWords(displayName: string): string[] {
  const lower = displayName.toLowerCase();
  const base = (lower.split(/[—–(,]/)[0] ?? lower).trim();
  const words = base.split(/\s+/).filter(Boolean);
  const out = new Set<string>([base]);
  if (words.length >= 2) out.add(`${words[0]} ${words[1]}`);
  if (words[0] && words[0].length >= 4 && !GENERIC_NAME_WORDS.has(words[0])) out.add(words[0]);
  const variety = (lower.split(/\s[—–]\s/)[1] ?? '').split(/[(,]/)[0]?.trim();
  if (variety && variety.length >= 4) out.add(variety);
  for (const m of lower.matchAll(/\(([^)]+)\)/g)) {
    const inner = m[1].trim().split(/\s+/);
    if (inner.length >= 2) out.add(`${inner[0]} ${inner[1]}`);
  }
  return [...out].filter(Boolean);
}

/** True when the quote names the crop by one of `cropNameWords` as whole
 *  words, and not inside a longer herb name ("sagebrush" and "mountain
 *  mint" name neither sage nor spearmint, CO-9). */
export function quoteNamesCropName(quote: string, displayName: string): boolean {
  return quoteNamesAny(quote, cropNameWords(displayName));
}

/** #37E: every counted `waterNeed` source (`waterNeed` and any
 *  `waterNeed.<n>`) comes from an extension or government page, is one
 *  passage that names the crop (F867-2) and states a need through
 *  `WATER_NEED_PHRASES`; a range counts as every need it spans (CO-9). The
 *  stored value is the one need every counted source allows; when they
 *  allow none in common, or more than one, the field stays empty with a
 *  `waterNeed.notRecorded` entry holding the quotes (CO-3). Returns
 *  "pluginId: problem" lines. */
export function waterNeedQuoteGaps(
  crops: ReadonlyArray<Pick<CropPlugin, 'pluginId' | 'displayName' | 'waterNeed'>>,
  sources: SourceMap
): string[] {
  const gaps: string[] = [];
  for (const c of crops) {
    const own = sources[c.pluginId] ?? {};
    const keys = Object.keys(own).filter((k) => k === 'waterNeed' || /^waterNeed\.\d+$/.test(k));
    const notRecorded = own[WATER_NEED_NOT_RECORDED_KEY];
    if (!c.waterNeed && keys.length === 0 && notRecorded === undefined) continue;
    if (c.waterNeed && notRecorded !== undefined) {
      gaps.push(`${c.pluginId}: waterNeed is set; drop ${WATER_NEED_NOT_RECORDED_KEY}`);
    }
    if (!c.waterNeed && keys.length > 0) {
      gaps.push(
        `${c.pluginId}: waterNeed sources with no value; move them into ${WATER_NEED_NOT_RECORDED_KEY}`
      );
    }
    let agreed: readonly WaterNeed[] | null = null;
    for (const key of keys) {
      const { needs, counts } = countedWaterNeeds(c, key, own[key], gaps);
      if (!needs) continue;
      if (c.waterNeed && !needs.includes(c.waterNeed)) {
        gaps.push(`${c.pluginId}: ${key} quote reads ${needs.join(' to ')}, not ${c.waterNeed}`);
      }
      if (counts) agreed = agreed ? agreed.filter((n) => needs.includes(n)) : needs;
    }
    if (c.waterNeed && agreed && agreed.length === 0) {
      gaps.push(`${c.pluginId}: waterNeed sources disagree; leave the field empty`);
    } else if (c.waterNeed && agreed && agreed.length > 1) {
      gaps.push(
        `${c.pluginId}: waterNeed sources allow ${agreed.join(' to ')}; leave the field empty`
      );
    }
    const entry = notRecordedEntrySchema.safeParse(notRecorded);
    if (c.waterNeed || !entry.success) continue;
    let held: readonly WaterNeed[] | null = null;
    for (const [i, q] of (entry.data.quotes ?? []).entries()) {
      const { needs, counts } = countedWaterNeeds(
        c,
        `${WATER_NEED_NOT_RECORDED_KEY}.quotes.${i}`,
        q,
        []
      );
      if (!needs || !counts) continue;
      held = held ? held.filter((n) => needs.includes(n)) : needs;
    }
    if (held && held.length === 1) {
      gaps.push(`${c.pluginId}: the recorded waterNeed quotes agree on ${held[0]}; ship it`);
    }
  }
  return gaps;
}

// ─── CO-7: every Phase 37 herb field is filled or recorded as empty ─────

/** A Phase 37 herb field the coverage gate checks: filled on the plugin,
 *  or a `<key>.notRecorded` entry in crop-data-sources.json. */
export interface HerbDataField {
  key: string;
  appliesTo?: (c: CropPlugin) => boolean;
  filled: (c: CropPlugin) => boolean;
}

export const HERB_DATA_FIELDS: readonly HerbDataField[] = [
  { key: 'lifecycle', filled: (c) => !!c.agronomy?.lifecycle },
  {
    key: 'winterHardyToZone',
    appliesTo: (c) => c.agronomy?.lifecycle === 'perennial',
    filled: (c) => !!c.winterHardyToZone
  },
  ...CROP_PRESERVING_METHODS.map((m): HerbDataField => ({
    key: `preserving.${m}`,
    filled: (c) => !!c.preserving?.some((p) => p.method === m)
  })),
  { key: 'harvestCadence', filled: (c) => !!c.harvestCadence },
  { key: 'waterNeed', filled: (c) => !!c.waterNeed },
  { key: 'harvestTiming', filled: (c) => (c.harvestTiming?.length ?? 0) > 0 }
];

/** CO-7: every `HERB_PLUGIN_IDS` plugin has each field in `fields` filled
 *  or carries a valid `<field>.notRecorded: { reason, checked, date }`, and
 *  never both. Returns "pluginId: problem" lines. */
export function herbDataCoverageGaps(
  crops: readonly CropPlugin[],
  sources: SourceMap,
  fields: readonly HerbDataField[] = HERB_DATA_FIELDS
): string[] {
  const gaps: string[] = [];
  for (const c of crops) {
    if (!isHerbGardenCrop(c.pluginId)) continue;
    const own = sources[c.pluginId] ?? {};
    for (const f of fields) {
      const key = `${f.key}.notRecorded`;
      const raw = own[key];
      if (f.appliesTo && !f.appliesTo(c)) {
        if (raw !== undefined)
          gaps.push(`${c.pluginId}: ${key} on a crop the field does not apply to`);
        continue;
      }
      if (f.filled(c)) {
        if (raw !== undefined) gaps.push(`${c.pluginId}: ${f.key} is filled; drop ${key}`);
      } else if (raw === undefined) {
        gaps.push(`${c.pluginId}: ${f.key} is neither filled nor recorded under ${key}`);
      } else if (!notRecordedEntrySchema.safeParse(raw).success) {
        gaps.push(`${c.pluginId}: ${key} needs { reason, checked: [url...], date }`);
      }
    }
  }
  return gaps;
}

/** The needs a waterNeed source's quote states and whether the source
 *  counts; each problem is pushed onto `gaps`. */
function countedWaterNeeds(
  c: Pick<CropPlugin, 'pluginId' | 'displayName'>,
  key: string,
  raw: unknown,
  gaps: string[]
): { needs: readonly WaterNeed[] | null; counts: boolean } {
  const entry = sourceEntrySchema.safeParse(raw);
  if (!entry.success) {
    gaps.push(`${c.pluginId}: ${key} source is not a valid entry`);
    return { needs: null, counts: false };
  }
  const { url, quote } = entry.data;
  let counts = true;
  if (!isAllowedSpacingSource(url)) {
    gaps.push(`${c.pluginId}: ${key} source is not an extension or government page`);
    counts = false;
  }
  const titled = waterNeedStitchAllowed(c.pluginId, quote);
  if (isStitchedQuote(quote) && !titled) {
    gaps.push(`${c.pluginId}: ${key} quote joins pieces; it must be one passage (F867-2)`);
    counts = false;
  } else if (!titled && !quoteNamesCropName(quote, c.displayName)) {
    gaps.push(`${c.pluginId}: ${key} quote does not name the crop`);
    counts = false;
  }
  const needs = waterNeedsOfQuote(quote);
  if (needs === 'negated') {
    gaps.push(`${c.pluginId}: ${key} quote negates its water phrase`);
    return { needs: null, counts: false };
  }
  if (needs === null) {
    gaps.push(`${c.pluginId}: ${key} quote states no single dry, moderate or moist need`);
  }
  return { needs, counts };
}

// Phase 37D
/** The herb's own name words from its display name ("Basil — Genovese" is
 *  basil; "Tulsi Rama (Holy Basil)" is tulsi, rama, holy and basil). */
function herbNameWords(displayName: string): string[] {
  const [head] = displayName.split(/\s+[—–-]\s+/);
  const inParens = [...displayName.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).join(' ');
  const words = `${head.replace(/\([^)]*\)/g, ' ')} ${inParens}`.toLowerCase().split(/[^a-z]+/);
  return [...new Set(words)].filter((w) => w.length >= 4);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function quoteHasWordStarting(quote: string, stem: string): boolean {
  return quote
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((w) => w.startsWith(stem));
}

/** The stem a row's action verb is matched by: "Pinch" matches "pinching",
 *  "Divide" matches "division", "Cut" matches "cutting". */
export function herbActionStem(title: string): string {
  const verb = (title.trim().split(/\s+/)[0] ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return verb.slice(0, 4);
}

/**
 * Phase 37D (R-25): every seasonal row on an herb garden plugin ships only
 * with a source under `seasonalTasks.<rowKey>` from an .edu or .gov page
 * whose quote names the row's action (its first word, by stem) and the
 * herb (a word of its display name). Numbers stay with
 * `seasonalTaskNumberGaps`. Returns "pluginId seasonalTasks.key: problem".
 */
export function herbSeasonalRowSourceGaps(
  crops: readonly Pick<CropPlugin, 'pluginId' | 'displayName' | 'seasonalTasks'>[],
  sources: SourceMap,
  isHerb: (pluginId: string) => boolean
): string[] {
  const out: string[] = [];
  for (const c of crops) {
    if (!isHerb(c.pluginId)) continue;
    for (const row of c.seasonalTasks ?? []) {
      const path = `seasonalTasks.${row.key}`;
      const at = `${c.pluginId} ${path}`;
      const entry = sourceEntrySchema.safeParse(sources[c.pluginId]?.[path]);
      if (!entry.success) {
        out.push(`${at}: no source`);
        continue;
      }
      if (!/\.(edu|gov)$/.test(hostOf(entry.data.url)))
        out.push(`${at}: source is not an .edu or .gov page`);
      const stem = herbActionStem(row.title);
      if (!stem || !quoteHasWordStarting(entry.data.quote, stem)) {
        out.push(`${at}: quote does not name the action "${row.title.trim().split(/\s+/)[0]}"`);
      }
      const names = herbNameWords(c.displayName);
      if (!names.some((n) => quoteHasWordStarting(entry.data.quote, n.replace(/s$/, '')))) {
        out.push(`${at}: quote does not name the herb`);
      }
    }
  }
  return out;
}

// Close-out D2 ──────────────────────────────────────────────────────────
// CO-4 infuse media and CO-5 sun need.

type InfuseMediumKey = 'oil' | 'vinegar';

/** The source key of one `preserving` row: `preserving.<method>`, or
 *  `preserving.infuse.<medium>` for an infuse row (CO-4). */
export function preservingSourceKey(p: { method: string; medium?: InfuseMediumKey }): string {
  return p.method === 'infuse' && p.medium
    ? `preserving.infuse.${p.medium}`
    : `preserving.${p.method}`;
}

/** Words that name each infusion medium. */
export const INFUSE_MEDIUM_WORDS: Readonly<Record<InfuseMediumKey, RegExp>> = {
  oil: /\boils?\b/i,
  vinegar: /\bvinegars?\b/i
};

/** What each medium's safety quote must state (CO-4): oil names the hazard
 *  (botulism) and the control (refrigeration and a time limit); vinegar
 *  names vinegar, discarding on mold or fermentation, cold or cool storage
 *  and commercially produced vinegar. */
export const INFUSE_SAFETY_RULES: Readonly<
  Record<InfuseMediumKey, ReadonlyArray<{ what: string; re: RegExp }>>
> = {
  oil: [
    { what: 'botulism', re: /\bbotulism\b|\bbotulinum\b/i },
    { what: 'refrigeration', re: /\brefrigerat(?:e|ed|or|ion)\b/i },
    {
      what: 'a time limit',
      re: /\b(?:\d+|one|two|three|four|five|six|seven)\s+(?:days?|weeks?|hours?)\b/i
    }
  ],
  vinegar: [
    { what: 'vinegar', re: /\bvinegars?\b/i },
    {
      what: 'discard on mold or fermentation',
      re: /\b(?:discard(?:ed|s)?|throw (?:it |them )?(?:out|away))\b[^.]*\b(?:mold|ferment|bubbl|cloud|slim)|\b(?:mold|ferment)[^.]*\b(?:discard(?:ed|s)?|throw (?:it |them )?(?:out|away))\b/i
    },
    { what: 'refrigerated or cool storage', re: /\brefrigerat|\bcool (?:places?|dark|spots?)\b/i },
    { what: 'commercially produced vinegar', re: /\bcommercially produced vinegars?\b/i }
  ]
};

/** CO-4: an infuse row's quote names its own medium and never the other,
 *  and its `preserving.infuse.<medium>.safety` quote comes from a .edu
 *  food-safety page and states that medium's safety rules. A row with no
 *  medium is the schema's refusal; here it reads as missing its medium. */
export function infuseRowGaps(
  c: Pick<CropPlugin, 'pluginId'>,
  p: { method: string; medium?: InfuseMediumKey },
  sources: SourceMap
): string[] {
  if (p.method !== 'infuse') return [];
  if (!p.medium) return [`${c.pluginId}: preserving.infuse needs a medium (oil or vinegar)`];
  const key = preservingSourceKey(p);
  const gaps: string[] = [];
  const other: InfuseMediumKey = p.medium === 'oil' ? 'vinegar' : 'oil';
  const row = sourceEntrySchema.safeParse(sources[c.pluginId]?.[key]);
  if (row.success) {
    if (!INFUSE_MEDIUM_WORDS[p.medium].test(row.data.quote)) {
      gaps.push(`${c.pluginId}: ${key} quote does not name ${p.medium}`);
    }
    if (INFUSE_MEDIUM_WORDS[other].test(row.data.quote)) {
      gaps.push(`${c.pluginId}: ${key} quote names ${other}, the other medium`);
    }
  }
  const safety = sourceEntrySchema.safeParse(sources[c.pluginId]?.[`${key}.safety`]);
  if (!safety.success) return gaps;
  if (!isEduHost(safety.data.url)) {
    gaps.push(`${c.pluginId}: ${key}.safety source is not a .edu food-safety page`);
  }
  for (const rule of INFUSE_SAFETY_RULES[p.medium]) {
    if (!rule.re.test(safety.data.quote)) {
      gaps.push(`${c.pluginId}: ${key}.safety quote does not state ${rule.what}`);
    }
  }
  return gaps;
}

type SunNeedKey = 'full' | 'part' | 'shade';

/** The ruled phrases a `sunNeed` quote is read through (CO-5), matched
 *  longest first and blanked out, so "tolerates some shade" is never also
 *  read for another phrase. */
export const SUN_NEED_PHRASES: Readonly<Record<SunNeedKey, readonly string[]>> = {
  full: [
    'full sun',
    '6 or more hours',
    'six or more hours',
    'at least 6 hours',
    'at least six hours'
  ],
  part: [
    'partial shade',
    'part shade',
    'light shade',
    'partial sun',
    'part sun',
    'afternoon shade',
    'tolerates some shade',
    'shade tolerant',
    'shade-tolerant'
  ],
  shade: ['full shade', 'deep shade']
};

const SUN_SHADE_ORDER: Readonly<Record<SunNeedKey, number>> = { full: 0, part: 1, shade: 2 };

const SUN_NEGATION =
  /\b(?:not|no|never|avoid|avoids|avoiding|without|nor|cannot|can't|won't|doesn't|don't|isn't|aren't)\s+(?:[a-z'-]+\s+){0,3}$/;

export interface SunNeedReading {
  /** The most shade the quote says the crop takes, or null when it states
   *  no ruled phrase. */
  need: SunNeedKey | null;
  /** A ruled phrase sits under a negation ("avoid full shade"). */
  negated: boolean;
}

/** How a quote reads under CO-5: a quote with full sun and part shade reads
 *  part, the most shade the crop takes. */
export function sunNeedOfQuote(quote: string): SunNeedReading {
  let text = ` ${quote.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ')} `;
  const phrases = (Object.entries(SUN_NEED_PHRASES) as Array<[SunNeedKey, readonly string[]]>)
    .flatMap(([need, list]) => list.map((p) => ({ need, p })))
    .sort((a, b) => b.p.length - a.p.length);
  let need: SunNeedKey | null = null;
  let negated = false;
  for (const { need: n, p } of phrases) {
    const re = new RegExp(`(?<![a-z])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'g');
    for (const m of text.matchAll(re)) {
      if (SUN_NEGATION.test(text.slice(0, m.index))) {
        negated = true;
        continue;
      }
      if (need === null || SUN_SHADE_ORDER[n] > SUN_SHADE_ORDER[need]) need = n;
    }
    text = text.replace(re, ' ');
  }
  return { need, negated };
}

/** Why a herb has no sun need: `{ reason, checked: [url...], date }`. */
export const SUN_NEED_NOT_RECORDED_KEY = 'sunNeed.notRecorded';

function sunNeedNotRecordedProblems(sources: SourceMap, pluginId: string): string[] {
  const entry = sources[pluginId]?.[SUN_NEED_NOT_RECORDED_KEY] as
    { reason?: unknown; checked?: unknown; date?: unknown } | undefined;
  if (!entry) return ['missing'];
  const out: string[] = [];
  if (!(typeof entry.reason === 'string' && entry.reason.trim().length > 10)) out.push('a reason');
  if (
    !Array.isArray(entry.checked) ||
    entry.checked.length === 0 ||
    !entry.checked.every((u) => typeof u === 'string' && isAllowedSpacingSource(u))
  ) {
    out.push('the extension pages checked');
  }
  if (!(typeof entry.date === 'string' && entry.date.trim())) out.push('a date');
  return out;
}

/**
 * CO-5: every counted sun source (`sunNeed` and any `sunNeed.<n>`) comes
 * from an extension or government page, names the crop and states a ruled
 * phrase that is not negated. The stored value is the `sunNeed` quote's
 * reading and the sunniest reading across sources (the others belong in
 * the note). A herb with no value carries a `sunNeed.notRecorded` entry.
 * Returns "pluginId: problem" lines.
 */
export function sunNeedQuoteGaps(
  crops: ReadonlyArray<Pick<CropPlugin, 'pluginId' | 'displayName' | 'sunNeed'>>,
  sources: SourceMap
): string[] {
  const gaps: string[] = [];
  for (const c of crops) {
    const own = sources[c.pluginId] ?? {};
    const keys = Object.keys(own).filter(
      (k) => k === 'sunNeed' || (k.startsWith('sunNeed.') && k !== SUN_NEED_NOT_RECORDED_KEY)
    );
    if (!c.sunNeed) {
      if (keys.length > 0) gaps.push(`${c.pluginId}: sunNeed sources but no sunNeed value`);
      if (!isHerbGardenCrop(c.pluginId)) continue;
      const problems = sunNeedNotRecordedProblems(sources, c.pluginId);
      if (problems[0] === 'missing') {
        gaps.push(`${c.pluginId}: no sunNeed and no ${SUN_NEED_NOT_RECORDED_KEY} entry`);
      } else if (problems.length) {
        gaps.push(`${c.pluginId}: ${SUN_NEED_NOT_RECORDED_KEY} needs ${problems.join(', ')}`);
      }
      continue;
    }
    if (own[SUN_NEED_NOT_RECORDED_KEY]) {
      gaps.push(`${c.pluginId}: sunNeed is set; drop ${SUN_NEED_NOT_RECORDED_KEY}`);
    }
    let sunniest: SunNeedKey | null = null;
    for (const key of keys) {
      const entry = sourceEntrySchema.safeParse(own[key]);
      if (!entry.success) {
        gaps.push(`${c.pluginId}: ${key} source is not a valid entry`);
        continue;
      }
      if (!isAllowedSpacingSource(entry.data.url)) {
        gaps.push(`${c.pluginId}: ${key} source is not an extension or government page`);
      }
      if (!quoteNamesCrop(entry.data.quote, c)) {
        gaps.push(`${c.pluginId}: ${key} quote does not name the crop`);
      }
      const reading = sunNeedOfQuote(entry.data.quote);
      if (reading.negated) gaps.push(`${c.pluginId}: ${key} quote negates a sun phrase`);
      if (reading.need === null) {
        gaps.push(`${c.pluginId}: ${key} quote states no full sun, part shade or shade phrase`);
        continue;
      }
      if (key === 'sunNeed' && reading.need !== c.sunNeed) {
        gaps.push(`${c.pluginId}: sunNeed quote reads ${reading.need}, not ${c.sunNeed}`);
      }
      if (sunniest === null || SUN_SHADE_ORDER[reading.need] < SUN_SHADE_ORDER[sunniest]) {
        sunniest = reading.need;
      }
    }
    if (sunniest && SUN_SHADE_ORDER[sunniest] < SUN_SHADE_ORDER[c.sunNeed]) {
      gaps.push(`${c.pluginId}: a source reads ${sunniest}; store the sunnier value`);
    }
  }
  return gaps;
}
