/**
 * First-run setup wizard step model. Pure and client-safe: the /onboarding
 * loader derives `OnboardingProgress` from live DB state and this module
 * decides which step to show and whether season planning is unlocked.
 *
 * Two phases. Farm basics (farm, location, fields, implements) must all be
 * done before the season phase (season philosophy, first plan) opens.
 */

export type OnboardingStepId = 'farm' | 'location' | 'fields' | 'implements' | 'season' | 'plan';
export type OnboardingPhase = 'basics' | 'season';
export type OnboardingProgress = Record<OnboardingStepId, boolean>;

export interface OnboardingStep {
  id: OnboardingStepId;
  phase: OnboardingPhase;
  title: string;
  summary: string;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'farm',
    phase: 'basics',
    title: 'Name your farm',
    summary: 'Creates your farm and the Home Field that holds your blocks.'
  },
  {
    id: 'location',
    phase: 'basics',
    title: 'Set your location',
    summary: 'Drives weather, spray windows, frost dates and the map.'
  },
  {
    id: 'fields',
    phase: 'basics',
    title: 'Draw your fields',
    summary: 'Fields and the blocks inside them. Everything you plant lives in a block.'
  },
  {
    id: 'implements',
    phase: 'basics',
    title: 'Pick your implements',
    summary: 'Tractors, sprayers, planters and the rest of what you actually run.'
  },
  {
    id: 'season',
    phase: 'season',
    title: 'Set this season’s approach',
    summary: 'Six quick questions that steer what the planner suggests.'
  },
  {
    id: 'plan',
    phase: 'season',
    title: 'Plan your season',
    summary: 'Pick crops, place them in blocks and schedule the work.'
  }
];

const ORDER = ONBOARDING_STEPS.map((s) => s.id);
const BASICS = ONBOARDING_STEPS.filter((s) => s.phase === 'basics').map((s) => s.id);

export function isStepId(v: unknown): v is OnboardingStepId {
  return typeof v === 'string' && (ORDER as string[]).includes(v);
}

export function basicsComplete(p: OnboardingProgress): boolean {
  return BASICS.every((id) => p[id]);
}

/** First step not yet done, in wizard order. `plan` once everything is done,
 *  so a returning user lands on the hand-off screen. */
export function firstIncomplete(p: OnboardingProgress): OnboardingStepId {
  return ORDER.find((id) => !p[id]) ?? 'plan';
}

/**
 * Which step to render for a requested `?step=`. Before the farm exists only
 * `farm` is reachable. After that the farm step is closed (renaming lives in
 * Settings), basics steps are freely reachable, and season steps stay locked
 * until every basics step is done.
 */
export function resolveStep(requested: unknown, p: OnboardingProgress): OnboardingStepId {
  if (!p.farm) return 'farm';
  if (!isStepId(requested) || requested === 'farm') return firstIncomplete(p);
  if (stepPhase(requested) === 'season' && !basicsComplete(p)) {
    return BASICS.find((id) => !p[id]) ?? 'location';
  }
  return requested;
}

export function stepPhase(id: OnboardingStepId): OnboardingPhase {
  return ONBOARDING_STEPS.find((s) => s.id === id)!.phase;
}

/** Where "Continue" goes after finishing `id`: the next undone step, looking
 *  forward first, then wrapping to anything skipped earlier. */
export function nextAfter(id: OnboardingStepId, p: OnboardingProgress): OnboardingStepId {
  const done = { ...p, [id]: true };
  const i = ORDER.indexOf(id);
  const ahead = ORDER.slice(i + 1).find((s) => !done[s]);
  const target = ahead ?? firstIncomplete(done);
  return resolveStep(target, done);
}

export function previousStep(id: OnboardingStepId): OnboardingStepId | null {
  const i = ORDER.indexOf(id);
  return i > 1 ? ORDER[i - 1] : null;
}

export function doneCount(p: OnboardingProgress): number {
  return ORDER.filter((id) => p[id]).length;
}
