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

function climateNudges(f: ClimateSetupFacts, why: string): SetupNudge[] {
  if (!f.hasLocation) {
    return [
      nudge(
        'location',
        'Your farm location is not set',
        `Set your farm location so ${why} fit your farm.`,
        '/settings/farm',
        'Set farm location',
        'climate'
      )
    ];
  }
  if (!f.hasFrostDates) {
    return [
      nudge(
        'frost',
        'Frost dates are not saved yet',
        'Save your last spring and first fall frost dates so the schedule lines up with your season.',
        '/settings/farm',
        'Save frost dates',
        'climate'
      )
    ];
  }
  return [];
}

/** /today: the weather, frost alerts and the calendar all read the farm
 *  location and frost dates. Nothing here gates the page. */
export function todaySetupPrompts(f: ClimateSetupFacts, role: Role): PageSetupPrompts<never> {
  return {
    gate: null,
    nudges: role === 'owner' ? climateNudges(f, 'the weather, frost alerts and planting dates') : []
  };
}

export function planSetupPrompts(f: PlanSetupFacts, role: Role): PageSetupPrompts<PlanSetupGate> {
  const gate: PlanSetupGate | null = f.hasBlocks ? null : 'blocks';
  if (role !== 'owner') return { gate, nudges: [] };
  const nudges: SetupNudge[] = climateNudges(f, 'frost dates, weather and planting windows');
  if (!f.hasSeasonSetup) {
    nudges.push(
      nudge(
        'season',
        `The ${f.year} season is not set up`,
        'Answer five quick questions (growing style, weeds, pests, fertility, cover crops) so the inputs plan fits how you farm.',
        '/settings/season',
        'Set up the season',
        'season'
      )
    );
  }
  if (!f.hasSeed && f.hasBlocks) {
    nudges.push(
      nudge(
        'seed',
        'No seed in inventory yet',
        'Add the seed you have, have ordered or plan to buy. The planner lays out beds from it.',
        '/inventory/seed/add',
        'Add seed'
      )
    );
  }
  return { gate, nudges };
}
