/**
 * Phase 25b (#98) — derive the season-plan workflow step list for the
 * `<WorkflowStrip>` primitive at `lib/components/plan/WorkflowStrip.svelte`.
 *
 * Pure function so the unit tests can exercise every step×state combo
 * without DB or registry setup. The /plan loader composes its three
 * inputs (season-setup presence, crops-in-year, inputs-plan task
 * completion) and passes the derived list to the page template.
 *
 * Step states:
 *   done         — step completed (carries a `when` text)
 *   in-progress  — step partially completed (allocation exists, schedule pending; etc.)
 *   stale        — step done but a precondition changed since (e.g., frost dates updated)
 *   pending      — not yet started
 *
 * Stale-detection is intentionally minimal for v1: only the
 * season-setup step considers "stale" when its `modifiedAt` predates
 * the most recent frost-date update (caller can pass null to skip).
 * Phase 26 follow-up will widen this to detect schedule-vs-frost-date
 * mismatches and similar invalidations.
 */

import type { WorkflowStep } from '$lib/components/plan/WorkflowStrip.svelte';
import { t } from '$lib/i18n';
import { formatCalendarDate } from '$lib/prefs';

export interface SeasonWorkflowInput {
  /** Result of `loadSeasonSetup(currentYear)` — null when absent. */
  seasonSetup: { modifiedAt?: number } | null;
  /** Result of `loadSeasonSetup(currentYear - 1)` — used to suggest
   *  carry-forward if this year is absent but last year exists. */
  lastYearSetup: unknown | null;
  /** Crops for the current season (from `listCrops({ year: currentYear })`).
   *  Allocation completion gates the next steps. */
  crops: Array<{ plantingDate: number | null }>;
  /** Total inputs-plan tasks committed this season (a positive count =
   *  the inputs step has been advanced). 0 = pending. */
  inputsTaskCount: number;
  /** Whether any plan_revisions row exists for the year (proxy for the
   *  commit step). Once Phase 25d `plan_revisions` ships, this becomes
   *  a real plan-commit signal. Until then, callers pass `null` and the
   *  derivation treats commit as "auto-done when all four priors done." */
  hasPlanRevision: boolean | null;
  /** Optional: frost-date table modified-at timestamp. If newer than
   *  `seasonSetup.modifiedAt`, the season-setup step is `stale`. */
  frostDatesModifiedAt?: number;
}

function fmtDate(ms: number, locale?: string | null): string {
  if (locale && locale !== 'en') return formatCalendarDate(ms, 'month-day', {}, locale);
  // UTC date methods so the format is timezone-stable for both server
  // rendering and test assertions (Date.UTC(...) → "Apr 2" everywhere).
  const d = new Date(ms);
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ];
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function deriveSeasonWorkflow(
  input: SeasonWorkflowInput,
  locale?: string | null
): WorkflowStep[] {
  const steps: WorkflowStep[] = [];

  // 1. Season setup
  if (input.seasonSetup) {
    const stale =
      input.frostDatesModifiedAt != null &&
      input.seasonSetup.modifiedAt != null &&
      input.frostDatesModifiedAt > input.seasonSetup.modifiedAt;
    steps.push({
      id: 'season-setup',
      label: t(locale, 'plan.wf.seasonSetup'),
      state: stale ? 'stale' : 'done',
      when: input.seasonSetup.modifiedAt
        ? fmtDate(input.seasonSetup.modifiedAt, locale)
        : undefined,
      note: stale ? t(locale, 'plan.wf.seasonStale') : t(locale, 'plan.wf.seasonDone')
    });
  } else {
    steps.push({
      id: 'season-setup',
      label: t(locale, 'plan.wf.seasonSetup'),
      state: 'pending',
      note: input.lastYearSetup
        ? t(locale, 'plan.wf.seasonCarry')
        : t(locale, 'plan.wf.seasonPending')
    });
  }

  // 2. Allocation — done when any crop exists; in-progress would need
  //    a partial-allocation signal we don't track yet.
  const allocationDone = input.crops.length > 0;
  steps.push({
    id: 'allocation',
    label: t(locale, 'plan.wf.allocation'),
    state: allocationDone ? 'done' : 'pending',
    when: allocationDone
      ? t(locale, 'plan.wf.plantings', { count: input.crops.length })
      : undefined,
    note: allocationDone
      ? t(locale, 'plan.wf.allocationDone')
      : t(locale, 'plan.wf.allocationPending')
  });

  // 3. Schedule — done when at least one crop has a plantingDate.
  const scheduled = input.crops.filter((c) => c.plantingDate != null).length;
  const allScheduled = scheduled === input.crops.length && input.crops.length > 0;
  steps.push({
    id: 'schedule',
    label: t(locale, 'plan.wf.schedule'),
    state: allScheduled ? 'done' : scheduled > 0 ? 'in-progress' : 'pending',
    when:
      scheduled > 0
        ? allScheduled
          ? t(locale, 'plan.wf.dated', { n: scheduled, total: input.crops.length })
          : `${scheduled}/${input.crops.length}`
        : undefined,
    note: allScheduled
      ? t(locale, 'plan.wf.scheduleDone')
      : scheduled > 0
        ? t(locale, 'plan.wf.schedulePartial')
        : t(locale, 'plan.wf.schedulePending')
  });

  // 4. Inputs plan — done when at least one inputs-plan task exists.
  steps.push({
    id: 'inputs',
    label: t(locale, 'plan.wf.inputs'),
    state: input.inputsTaskCount > 0 ? 'done' : 'pending',
    when:
      input.inputsTaskCount > 0
        ? t(locale, 'plan.wf.tasks', { count: input.inputsTaskCount })
        : undefined,
    note:
      input.inputsTaskCount > 0
        ? t(locale, 'plan.wf.inputsDone')
        : t(locale, 'plan.wf.inputsPending')
  });

  // 5. Commit — done when plan_revisions row exists OR (fallback) when
  //    all four priors are done.
  const priorsAllDone = steps.every((s) => s.state === 'done');
  const commitDone =
    input.hasPlanRevision === true || (input.hasPlanRevision == null && priorsAllDone);
  steps.push({
    id: 'commit',
    label: t(locale, 'plan.wf.commit'),
    state: commitDone ? 'done' : 'pending',
    note: commitDone ? t(locale, 'plan.wf.commitDone') : t(locale, 'plan.wf.commitPending')
  });

  return steps;
}

/**
 * #120 — where a click on a WorkflowStrip step lands. The wizard's
 * Schedule / Inputs / Commit steps consume an in-memory allocation, so
 * they cannot be mounted cold; once a plan is committed, those steps
 * route to the surfaces that hold the committed data instead.
 */
export type WorkflowStepTarget =
  | { kind: 'wizard'; wizardStep: 'season-setup' | 'allocation' }
  | { kind: 'calendar' }
  | { kind: 'tasks' }
  | { kind: 'provenance' };

export interface WorkflowStepRoute {
  target: WorkflowStepTarget | null;
  hint: string;
}

export function workflowStepRoute(
  stepId: string,
  steps: WorkflowStep[],
  locale?: string | null
): WorkflowStepRoute {
  const stateOf = (id: string) => steps.find((s) => s.id === id)?.state ?? 'pending';
  const allocated = stateOf('allocation') !== 'pending';
  switch (stepId) {
    case 'season-setup':
      return {
        target: { kind: 'wizard', wizardStep: 'season-setup' },
        hint: t(locale, 'plan.wf.hint.season')
      };
    case 'allocation':
      return {
        target: { kind: 'wizard', wizardStep: 'allocation' },
        hint: t(locale, 'plan.wf.hint.allocation')
      };
    case 'schedule':
      return allocated
        ? {
            target: { kind: 'calendar' },
            hint: t(locale, 'plan.wf.hint.calendar')
          }
        : { target: null, hint: t(locale, 'plan.wf.hint.scheduleFirst') };
    case 'inputs':
      if (!allocated) {
        return { target: null, hint: t(locale, 'plan.wf.hint.inputsFirst') };
      }
      return stateOf('inputs') === 'done'
        ? { target: { kind: 'tasks' }, hint: t(locale, 'plan.wf.hint.tasks') }
        : {
            target: { kind: 'wizard', wizardStep: 'allocation' },
            hint: t(locale, 'plan.wf.hint.inputsWizard')
          };
    case 'commit':
      return stateOf('commit') === 'done'
        ? { target: { kind: 'provenance' }, hint: t(locale, 'plan.wf.hint.revisions') }
        : { target: null, hint: t(locale, 'plan.wf.hint.commit') };
    default:
      return { target: null, hint: '' };
  }
}

export function withStepRoutes(steps: WorkflowStep[], locale?: string | null): WorkflowStep[] {
  return steps.map((s) => {
    const r = workflowStepRoute(s.id, steps, locale);
    return { ...s, disabled: r.target === null, actionHint: r.hint };
  });
}
