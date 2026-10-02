/**
 * #475 — setup questions asked on the page where they matter, for a farm
 * that went only part way through the setup checklist. Pure and
 * client-safe; the page loader gathers the facts from tenant-scoped reads.
 *
 * A gap that would make the page produce a wrong or empty plan is a `gate`:
 * the page stops and asks in place (through its existing setup sheet). A
 * gap that only makes the result less exact is a `nudge`: a dismissible
 * banner that never blocks. Only the owner can answer them, so helpers and
 * inspectors get no nudges: a list of things they cannot act on is clutter.
 */

import { t } from '$lib/i18n';

export interface PlanSetupFacts {
  /** The owner saved a farm location (not the built-in default). */
  hasLocation: boolean;
  /** Both frost dates are saved for the farm. */
  hasFrostDates: boolean;
  /** Season Setup exists for the planning year. */
  hasSeasonSetup: boolean;
  hasBlocks: boolean;
  /** Any seed in inventory, whatever its quantity. */
  hasSeed: boolean;
  year: number;
}

export type PlanSetupGate = 'blocks';
export type SetupNudgeId = 'location' | 'frost' | 'season' | 'seed';

/** A question the page can ask in place, in a setup sheet. */
export type SetupAsk = 'climate' | 'season';

export interface SetupNudge {
  id: SetupNudgeId;
  title: string;
  body: string;
  href: string | null;
  action: string | null;
  /** Owner only: answer here instead of following `href`. */
  ask?: SetupAsk | null;
}

export interface PageSetupPrompts<G extends string> {
  gate: G | null;
  nudges: SetupNudge[];
}

export interface ClimateSetupFacts {
  hasLocation: boolean;
  hasFrostDates: boolean;
}

type Role = 'owner' | 'helper' | 'inspector' | string;

function nudge(
  id: SetupNudgeId,
  title: string,
  body: string,
  href: string,
  action: string,
  ask: SetupAsk | null = null
): SetupNudge {
  return { id, title, body, href, action, ask };
}

function climateNudges(
  f: ClimateSetupFacts,
  page: 'today' | 'plan',
  locale: string | null | undefined
): SetupNudge[] {
  if (!f.hasLocation) {
    return [
      nudge(
        'location',
        t(locale, 'nudge.location.title'),
        t(locale, page === 'today' ? 'nudge.location.bodyToday' : 'nudge.location.bodyPlan'),
        '/settings/farm',
        t(locale, 'nudge.location.action'),
        'climate'
      )
    ];
  }
  if (!f.hasFrostDates) {
    return [
      nudge(
        'frost',
        t(locale, 'nudge.frost.title'),
        t(locale, 'nudge.frost.body'),
        '/settings/farm',
        t(locale, 'nudge.frost.action'),
        'climate'
      )
    ];
  }
  return [];
}

/** /today: the weather, frost alerts and the calendar all read the farm
 *  location and frost dates. Nothing here gates the page. */
export function todaySetupPrompts(
  f: ClimateSetupFacts,
  role: Role,
  locale?: string | null
): PageSetupPrompts<never> {
  return {
    gate: null,
    nudges: role === 'owner' ? climateNudges(f, 'today', locale) : []
  };
}

export function planSetupPrompts(
  f: PlanSetupFacts,
  role: Role,
  locale?: string | null
): PageSetupPrompts<PlanSetupGate> {
  const gate: PlanSetupGate | null = f.hasBlocks ? null : 'blocks';
  if (role !== 'owner') return { gate, nudges: [] };
  const nudges: SetupNudge[] = climateNudges(f, 'plan', locale);
  if (!f.hasSeasonSetup) {
    nudges.push(
      nudge(
        'season',
        t(locale, 'nudge.season.title', { year: f.year }),
        t(locale, 'nudge.season.body'),
        '/settings/season',
        t(locale, 'nudge.season.action'),
        'season'
      )
    );
  }
  if (!f.hasSeed && f.hasBlocks) {
    nudges.push(
      nudge(
        'seed',
        t(locale, 'nudge.seed.title'),
        t(locale, 'nudge.seed.body'),
        '/inventory/seed/add',
        t(locale, 'nudge.seed.action')
      )
    );
  }
  return { gate, nudges };
}
