import type { HerbicidePlugin, SprayWindowPurpose } from '$lib/plugins/schemas';
import { isProductAllowed } from './philosophyFilter';
import type { Philosophy, SeasonSetup, WeedStrategy } from './setup';

const WEED_TIER: Record<WeedStrategy, number> = {
  'cultivate-first': 0,
  'pre-emergence-ok': 1,
  'post-emergence-ok': 2
};

const HERBICIDE_PURPOSES: ReadonlySet<SprayWindowPurpose> = new Set([
  'burndown',
  'pre-emergent',
  'post-emergent',
  'cover-terminate'
]);

export function isHerbicidePurpose(purpose: SprayWindowPurpose | undefined): boolean {
  return purpose != null && HERBICIDE_PURPOSES.has(purpose);
}

/** The weed strategy a window needs. A plugin's own gate wins; without one
 *  the purpose sets it, so a post-emergent spray never reaches a farm that
 *  only allows pre-emergence herbicides, and no herbicide window reaches a
 *  cultivate-first farm. */
export function effectiveWeedGate(window: {
  purpose?: SprayWindowPurpose;
  weedStrategyGate?: WeedStrategy;
}): WeedStrategy | undefined {
  const implied: WeedStrategy | undefined =
    window.purpose === 'post-emergent'
      ? 'post-emergence-ok'
      : isHerbicidePurpose(window.purpose)
        ? 'pre-emergence-ok'
        : undefined;
  if (!window.weedStrategyGate) return implied;
  if (!implied) return window.weedStrategyGate;
  return WEED_TIER[window.weedStrategyGate] >= WEED_TIER[implied]
    ? window.weedStrategyGate
    : implied;
}

export function weedStrategyAllows(gate: WeedStrategy | undefined, setup: WeedStrategy): boolean {
  if (!gate) return true;
  return WEED_TIER[setup] >= WEED_TIER[gate];
}

/** What a season's setup allows of the calendar's herbicide windows.
 *  `allowedHerbicideClasses` is null when every product is allowed. */
export interface SeasonSprayFilter {
  philosophy: Philosophy;
  weedStrategy: WeedStrategy;
  allowedHerbicideClasses: string[] | null;
}

export function buildSeasonSprayFilter(
  setup: Pick<SeasonSetup, 'philosophy' | 'weedStrategy'>,
  herbicides: ReadonlyArray<HerbicidePlugin>
): SeasonSprayFilter {
  if (setup.philosophy === 'conventional' || setup.philosophy === 'no-till') {
    return {
      philosophy: setup.philosophy,
      weedStrategy: setup.weedStrategy,
      allowedHerbicideClasses: null
    };
  }
  const classes = new Set<string>();
  for (const h of herbicides) {
    if (!isProductAllowed(h, setup.philosophy)) continue;
    for (const ai of h.activeIngredients) classes.add(ai.chemistryClass);
  }
  return {
    philosophy: setup.philosophy,
    weedStrategy: setup.weedStrategy,
    allowedHerbicideClasses: [...classes].sort()
  };
}

/** True when a herbicide window may be suggested under the season's setup:
 *  the weed strategy allows it, and the philosophy allows at least one
 *  herbicide of the window's chemistry. A window with no chemistry on file
 *  is only allowed where every product is. */
export function herbicideWindowAllowed(
  window: {
    purpose?: SprayWindowPurpose;
    weedStrategyGate?: WeedStrategy;
    chemistryClass?: string;
  },
  filter: SeasonSprayFilter
): boolean {
  const purpose = window.purpose ?? 'post-emergent';
  if (!weedStrategyAllows(effectiveWeedGate({ ...window, purpose }), filter.weedStrategy)) {
    return false;
  }
  if (filter.allowedHerbicideClasses == null) return true;
  if (!window.chemistryClass) return false;
  return filter.allowedHerbicideClasses.includes(window.chemistryClass);
}

interface SprayWindowEventLike {
  kind: string;
  detail?: Record<string, unknown>;
}

/** Drops calendar `spray-window` events the season's setup does not allow.
 *  `seasonOf` maps the window's planting date to its season; `filterFor`
 *  returns null for a season with no saved setup, which keeps the events as
 *  they are. Every calendar spray window is a herbicide window. */
export function filterSprayWindowsBySeason<E extends SprayWindowEventLike>(
  events: ReadonlyArray<E>,
  seasonOf: (plantedAt: number) => number,
  filterFor: (year: number) => SeasonSprayFilter | null
): E[] {
  return events.filter((e) => {
    if (e.kind !== 'spray-window') return true;
    const d = e.detail ?? {};
    if (typeof d.plantedAt !== 'number') return true;
    const filter = filterFor(seasonOf(d.plantedAt));
    if (!filter) return true;
    return herbicideWindowAllowed(
      {
        purpose: typeof d.purpose === 'string' ? (d.purpose as SprayWindowPurpose) : undefined,
        weedStrategyGate:
          typeof d.weedStrategyGate === 'string' ? (d.weedStrategyGate as WeedStrategy) : undefined,
        chemistryClass: typeof d.chemistryClass === 'string' ? d.chemistryClass : undefined
      },
      filter
    );
  });
}
