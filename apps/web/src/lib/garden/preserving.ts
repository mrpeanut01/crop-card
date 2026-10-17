/** How a herb harvest is kept (Phase 37, R-6). One enum is shared by the
 *  crop plugin `preserving` field, `harvest_dispositions.preserved_as`, the
 *  garden brief and the card snapshot. Pesto is a brief goal that maps to
 *  `freeze`; canning and jelly have no plant-data method. */
export const PRESERVING_METHODS = ['fresh', 'dry', 'freeze', 'freeze-dry', 'infuse'] as const;
export type PreservingMethod = (typeof PRESERVING_METHODS)[number];

/** What the owner wants to do with the harvest, as the brief asks it. */
export const BRIEF_STORAGE_GOALS = [
  'fresh',
  'dry',
  'freeze',
  'freeze-dry',
  'pesto',
  'infuse',
  'can-or-jelly'
] as const;
export type BriefStorageGoal = (typeof BRIEF_STORAGE_GOALS)[number];

/** How well a crop keeps by one method, as a source states it. */
export const PRESERVING_SUITABILITY = ['good', 'fair', 'poor'] as const;
export type PreservingSuitability = (typeof PRESERVING_SUITABILITY)[number];

const GOAL_METHOD: Record<BriefStorageGoal, PreservingMethod | null> = {
  fresh: 'fresh',
  dry: 'dry',
  freeze: 'freeze',
  'freeze-dry': 'freeze-dry',
  pesto: 'freeze',
  infuse: 'infuse',
  'can-or-jelly': null
};

/** The plant-data method a brief goal is judged against, or null when no
 *  plant data can answer it (canning and jelly need a tested recipe). */
export function goalMethod(goal: BriefStorageGoal): PreservingMethod | null {
  return GOAL_METHOD[goal];
}

export function isPreservingMethod(v: unknown): v is PreservingMethod {
  return typeof v === 'string' && (PRESERVING_METHODS as readonly string[]).includes(v);
}
