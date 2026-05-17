/**
 * Per-Owner per-year season setup — SERVER-ONLY repo (Phase 21 / UC-42).
 *
 * `*.server.ts` filename guarantees SvelteKit will refuse to bundle this
 * into the client. The DB read/write path lives here; the pure types,
 * labels, and helpers (`summarizeSeasonSetup`, `isOrganicCompliant`,
 * `allowsSynthetics`, defaults) stay in the sibling `setup.ts` so the
 * Svelte components (`SeasonSetupStep.svelte`, `SeasonSetupChip.svelte`)
 * can import them safely from the browser.
 *
 * History: shipped as a single module in commit 731a770; the import of
 * `$lib/db/settings` (which transitively pulls `better-sqlite3`) leaked
 * server code into the client bundle and broke `/plan` hydration on
 * Phase 21a merge. Split out 2026-05-17 as a hotfix.
 */

import { getSetting, setSetting } from '$lib/db/settings';

import {
  SEASON_SETUP_DEFAULTS,
  PHILOSOPHY_VALUES,
  WEED_VALUES,
  PEST_VALUES,
  FERTILITY_VALUES,
  COVER_VALUES,
  SPRAY_VALUES,
  type SeasonSetup,
  type SeasonSetupField
} from './setup';

function settingKey(year: number, field: SeasonSetupField): string {
  return `season_setup.${year}.${field}`;
}

function parseEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return fallback;
}

function parseTransitioningYear(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1900 || n > 3000) return null;
  return n;
}

/** Load the saved setup for `year`. Returns null when the operator has
 *  never completed the form for that year — callers SHOULD distinguish
 *  "never set" from "set but uses defaults" because the canonical UI path
 *  prompts the form on null. The `philosophy` key is the canary; if it's
 *  absent, we treat the whole setup as absent rather than synthesizing
 *  defaults that the operator never confirmed. */
export function loadSeasonSetup(year: number): SeasonSetup | null {
  const philosophyRaw = getSetting(settingKey(year, 'philosophy'));
  if (!philosophyRaw) return null;

  const setAtRaw = getSetting(settingKey(year, 'setAt'));
  const setAt = setAtRaw ? Number.parseInt(setAtRaw, 10) : Date.now();

  return {
    philosophy: parseEnum(
      philosophyRaw,
      PHILOSOPHY_VALUES,
      SEASON_SETUP_DEFAULTS.philosophy
    ),
    weedStrategy: parseEnum(
      getSetting(settingKey(year, 'weedStrategy')),
      WEED_VALUES,
      SEASON_SETUP_DEFAULTS.weedStrategy
    ),
    pestStrategy: parseEnum(
      getSetting(settingKey(year, 'pestStrategy')),
      PEST_VALUES,
      SEASON_SETUP_DEFAULTS.pestStrategy
    ),
    fertilityApproach: parseEnum(
      getSetting(settingKey(year, 'fertilityApproach')),
      FERTILITY_VALUES,
      SEASON_SETUP_DEFAULTS.fertilityApproach
    ),
    coverCropIntent: parseEnum(
      getSetting(settingKey(year, 'coverCropIntent')),
      COVER_VALUES,
      SEASON_SETUP_DEFAULTS.coverCropIntent
    ),
    sprayCapacity: parseEnum(
      getSetting(settingKey(year, 'sprayCapacity')),
      SPRAY_VALUES,
      SEASON_SETUP_DEFAULTS.sprayCapacity
    ),
    transitioningStartedYear: parseTransitioningYear(
      getSetting(settingKey(year, 'transitioningStartedYear'))
    ),
    year,
    setAt
  };
}

/** Save a partial update for `year`. Missing fields fall back to the
 *  current saved value (if any), then to `SEASON_SETUP_DEFAULTS`. Always
 *  writes all six core fields + `setAt` so a subsequent `loadSeasonSetup`
 *  returns a complete, non-null record. */
export function saveSeasonSetup(
  year: number,
  input: Partial<Omit<SeasonSetup, 'year' | 'setAt'>>
): SeasonSetup {
  const current = loadSeasonSetup(year);
  const base: Omit<SeasonSetup, 'year' | 'setAt'> = current
    ? {
        philosophy: current.philosophy,
        weedStrategy: current.weedStrategy,
        pestStrategy: current.pestStrategy,
        fertilityApproach: current.fertilityApproach,
        coverCropIntent: current.coverCropIntent,
        sprayCapacity: current.sprayCapacity,
        transitioningStartedYear: current.transitioningStartedYear
      }
    : { ...SEASON_SETUP_DEFAULTS };

  const merged = { ...base, ...input };

  setSetting(settingKey(year, 'philosophy'), merged.philosophy);
  setSetting(settingKey(year, 'weedStrategy'), merged.weedStrategy);
  setSetting(settingKey(year, 'pestStrategy'), merged.pestStrategy);
  setSetting(settingKey(year, 'fertilityApproach'), merged.fertilityApproach);
  setSetting(settingKey(year, 'coverCropIntent'), merged.coverCropIntent);
  setSetting(settingKey(year, 'sprayCapacity'), merged.sprayCapacity);

  if (
    merged.philosophy === 'organic-transitioning' &&
    merged.transitioningStartedYear !== null
  ) {
    setSetting(
      settingKey(year, 'transitioningStartedYear'),
      String(merged.transitioningStartedYear)
    );
  } else {
    // Clear when philosophy is anything else so the conditional field
    // never lingers after a change away from 'organic-transitioning'.
    setSetting(settingKey(year, 'transitioningStartedYear'), '');
  }

  const setAt = Date.now();
  setSetting(settingKey(year, 'setAt'), String(setAt));

  return {
    ...merged,
    transitioningStartedYear:
      merged.philosophy === 'organic-transitioning'
        ? merged.transitioningStartedYear
        : null,
    year,
    setAt
  };
}

/** Copy `fromYear`'s setup into `toYear` with a refreshed `setAt`. Returns
 *  null when `fromYear` has nothing saved — caller should fall through to
 *  the empty form. Does NOT overwrite an existing `toYear` setup (if the
 *  operator already started one). */
export function carryForward(fromYear: number, toYear: number): SeasonSetup | null {
  if (fromYear === toYear) return loadSeasonSetup(toYear);
  if (loadSeasonSetup(toYear)) return loadSeasonSetup(toYear);
  const source = loadSeasonSetup(fromYear);
  if (!source) return null;
  return saveSeasonSetup(toYear, {
    philosophy: source.philosophy,
    weedStrategy: source.weedStrategy,
    pestStrategy: source.pestStrategy,
    fertilityApproach: source.fertilityApproach,
    coverCropIntent: source.coverCropIntent,
    sprayCapacity: source.sprayCapacity,
    transitioningStartedYear: source.transitioningStartedYear
  });
}
