/**
 * Per-bed frost dates for planning (Phase 32E, season extension). Pure and
 * client-safe. Works on season-resolved dates (after `frostDatesFromMmDd`),
 * so seasons that cross the new year are handled once, upstream.
 *
 * Rules ("32E rulings" in docs/design/PHASE_32_PLAN.md, E2-2 to E2-8): per side the largest
 * single shift among the covers that count wins, shifts never add; spring
 * moves earlier and fall later; saved hard-frost dates cap the move; a heated
 * greenhouse, or a shift so large the season never freezes, is frost-free.
 */

import { dateToLocaleDateString } from '$lib/intlCache';
import { t } from '$lib/i18n';
import { intlLocale } from '$lib/prefs';
import type { FrostDatesIso } from '$lib/plan/plantingWindow';
import {
  MAX_SHIFT_DAYS,
  isHeated,
  protectionDefaults,
  type BlockProtection,
  type ProtectionKind,
  type ProtectionProvenance
} from './protection';

const DAY_MS = 86_400_000;

export interface SeasonFrostMs {
  lastSpringFrostMs: number;
  firstFallFrostMs: number;
}

export interface EffectiveFrost extends SeasonFrostMs {
  frostFree: boolean;
  springShiftDays: number;
  fallShiftDays: number;
  springBy: ProtectionKind | null;
  fallBy: ProtectionKind | null;
  /** Provenance of the winning shift; null when nothing shifted. */
  provenance: 'data' | 'manual' | 'fallback' | null;
  /** Covers that count but whose shift is not known (E2-1). */
  unknownShift: ProtectionKind[];
}

export interface EffectiveFrostInput {
  seasonYear: number;
  protections: readonly BlockProtection[];
  heatedArea?: boolean;
  unheatedGreenhouseArea?: boolean;
  hardFrost?: Partial<SeasonFrostMs>;
}

function countsAt(p: BlockProtection, seasonYear: number, frostMs: number): boolean {
  if (p.seasonYear !== null && p.seasonYear !== seasonYear) return false;
  if (p.installedOn !== null && p.installedOn > frostMs) return false;
  if (p.removedOn !== null && p.removedOn <= frostMs) return false;
  return true;
}

function clampShift(n: number | null): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  return Math.max(0, Math.min(MAX_SHIFT_DAYS, Math.round(n)));
}

function outProvenance(p: ProtectionProvenance): 'data' | 'manual' | 'fallback' {
  return p === 'plugin' ? 'data' : p;
}

function implicitUnheated(blockId: string): BlockProtection {
  const d = protectionDefaults('greenhouse-unheated');
  return {
    id: `implicit:${blockId}`,
    blockId,
    kind: 'greenhouse-unheated',
    springShiftDays: d.springShiftDays,
    fallShiftDays: d.fallShiftDays,
    provenance: 'data',
    installedOn: null,
    removedOn: null,
    seasonYear: null
  };
}

function frostFreeResult(
  seasonYear: number,
  by: ProtectionKind | null,
  provenance: EffectiveFrost['provenance']
): EffectiveFrost {
  return {
    lastSpringFrostMs: new Date(seasonYear, 0, 1).getTime(),
    firstFallFrostMs: new Date(seasonYear, 11, 31).getTime(),
    frostFree: true,
    springShiftDays: 0,
    fallShiftDays: 0,
    springBy: by,
    fallBy: by,
    provenance,
    unknownShift: []
  };
}

export function effectiveFrostDates(
  farm: SeasonFrostMs,
  input: EffectiveFrostInput
): EffectiveFrost {
  const { seasonYear } = input;
  const covers = [...input.protections];
  if (input.unheatedGreenhouseArea && !input.heatedArea) {
    covers.push(implicitUnheated(covers[0]?.blockId ?? ''));
  }

  const springCovers = covers.filter((p) => countsAt(p, seasonYear, farm.lastSpringFrostMs));
  const fallCovers = covers.filter((p) => countsAt(p, seasonYear, farm.firstFallFrostMs));

  if (input.heatedArea) return frostFreeResult(seasonYear, 'greenhouse-heated', 'manual');
  const heated = [...springCovers, ...fallCovers].find((p) => isHeated(p.kind));
  if (heated) return frostFreeResult(seasonYear, heated.kind, outProvenance(heated.provenance));

  const unknown = new Set<ProtectionKind>();
  const pick = (list: BlockProtection[], side: 'springShiftDays' | 'fallShiftDays') => {
    let best: BlockProtection | null = null;
    let bestDays = 0;
    for (const p of list) {
      const days = clampShift(p[side]);
      if (days === null) {
        unknown.add(p.kind);
        continue;
      }
      if (days > bestDays) {
        best = p;
        bestDays = days;
      }
    }
    return { best, days: bestDays };
  };
  const spring = pick(springCovers, 'springShiftDays');
  const fall = pick(fallCovers, 'fallShiftDays');

  let lastSpring = farm.lastSpringFrostMs - spring.days * DAY_MS;
  let firstFall = farm.firstFallFrostMs + fall.days * DAY_MS;
  const hardLast = input.hardFrost?.lastSpringFrostMs;
  if (typeof hardLast === 'number' && hardLast <= farm.lastSpringFrostMs) {
    lastSpring = Math.max(lastSpring, hardLast);
  }
  const hardFirst = input.hardFrost?.firstFallFrostMs;
  if (typeof hardFirst === 'number' && hardFirst >= farm.firstFallFrostMs) {
    firstFall = Math.min(firstFall, hardFirst);
  }

  const provs = [spring.best, fall.best]
    .filter((p): p is BlockProtection => p !== null)
    .map((p) => outProvenance(p.provenance));
  const provenance: EffectiveFrost['provenance'] =
    provs.length === 0
      ? null
      : provs.includes('manual')
        ? 'manual'
        : provs.includes('data')
          ? 'data'
          : 'fallback';

  if (firstFall - lastSpring >= 365 * DAY_MS) {
    const r = frostFreeResult(seasonYear, spring.best?.kind ?? fall.best?.kind ?? null, provenance);
    return { ...r, unknownShift: [...unknown] };
  }

  return {
    lastSpringFrostMs: lastSpring,
    firstFallFrostMs: firstFall,
    frostFree: false,
    springShiftDays: Math.round((farm.lastSpringFrostMs - lastSpring) / DAY_MS),
    fallShiftDays: Math.round((firstFall - farm.firstFallFrostMs) / DAY_MS),
    springBy: lastSpring === farm.lastSpringFrostMs ? null : (spring.best?.kind ?? null),
    fallBy: firstFall === farm.firstFallFrostMs ? null : (fall.best?.kind ?? null),
    provenance:
      lastSpring === farm.lastSpringFrostMs && firstFall === farm.firstFallFrostMs
        ? null
        : provenance,
    unknownShift: [...unknown]
  };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isoToMs(iso: string): number {
  return ISO_DAY.test(iso) ? Date.parse(`${iso}T00:00:00Z`) : NaN;
}

function msToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO-day variant for plantingWindow callers. Day strings are read as UTC
 *  midnights; frost-free returns the season's Jan 1 and Dec 31. */
export function effectiveFrostIso(
  farm: FrostDatesIso,
  input: EffectiveFrostInput
): FrostDatesIso & { frostFree: boolean } {
  const lastMs = isoToMs(farm.lastSpring);
  const firstMs = isoToMs(farm.firstFall);
  if (!Number.isFinite(lastMs) || !Number.isFinite(firstMs)) {
    return { ...farm, frostFree: false };
  }
  const eff = effectiveFrostDates({ lastSpringFrostMs: lastMs, firstFallFrostMs: firstMs }, input);
  if (eff.frostFree) {
    return {
      lastSpring: `${input.seasonYear}-01-01`,
      firstFall: `${input.seasonYear}-12-31`,
      frostFree: true
    };
  }
  return {
    lastSpring: msToIso(eff.lastSpringFrostMs),
    firstFall: msToIso(eff.firstFallFrostMs),
    frostFree: false
  };
}

/** Frost as the planners take it, per block. */
export type BlockFrost = SeasonFrostMs & { frostFree?: boolean };

/** "Covered: frost from Apr 2" style summary for a bed, or null when the
 *  bed has no cover that counts. */
export function effectiveFrostSummary(eff: EffectiveFrost, locale?: string | null): string | null {
  if (eff.frostFree) {
    return eff.springBy === 'greenhouse-heated' || eff.fallBy === 'greenhouse-heated'
      ? t(locale, 'climate.cover.heatedNoLimit')
      : t(locale, 'climate.cover.noLimit');
  }
  if (eff.springBy === null && eff.fallBy === null) {
    return eff.unknownShift.length > 0 ? t(locale, 'climate.cover.shiftUnknown') : null;
  }
  const fmt = (ms: number) =>
    dateToLocaleDateString(new Date(ms), locale ? intlLocale(locale) : 'en-US', {
      month: 'short',
      day: 'numeric'
    });
  const parts: string[] = [];
  if (eff.springBy)
    parts.push(t(locale, 'climate.cover.frostEnds', { date: fmt(eff.lastSpringFrostMs) }));
  if (eff.fallBy)
    parts.push(t(locale, 'climate.cover.firstFrost', { date: fmt(eff.firstFallFrostMs) }));
  return t(locale, 'climate.cover.covered', { parts: parts.join(', ') });
}
