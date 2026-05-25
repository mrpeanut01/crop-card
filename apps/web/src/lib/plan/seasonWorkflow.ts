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

function fmtDate(ms: number): string {
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

export function deriveSeasonWorkflow(input: SeasonWorkflowInput): WorkflowStep[] {
  const steps: WorkflowStep[] = [];

  // 1. Season setup
  if (input.seasonSetup) {
    const stale =
      input.frostDatesModifiedAt != null &&
      input.seasonSetup.modifiedAt != null &&
      input.frostDatesModifiedAt > input.seasonSetup.modifiedAt;
    steps.push({
      id: 'season-setup',
      label: 'Season setup',
      state: stale ? 'stale' : 'done',
      when: input.seasonSetup.modifiedAt ? fmtDate(input.seasonSetup.modifiedAt) : undefined,
      note: stale
        ? 'Frost dates have changed since season setup was saved. Re-check guardrails.'
        : 'Philosophy, tillage, and guardrails saved.'
    });
  } else {
    steps.push({
      id: 'season-setup',
      label: 'Season setup',
      state: 'pending',
      note: input.lastYearSetup
        ? 'Carry forward from last year or set fresh.'
        : 'Philosophy + tillage + guardrails.'
    });
  }

  // 2. Allocation — done when any crop exists; in-progress would need
  //    a partial-allocation signal we don't track yet.
  const allocationDone = input.crops.length > 0;
  steps.push({
    id: 'allocation',
    label: 'Allocation',
    state: allocationDone ? 'done' : 'pending',
    when: allocationDone
      ? `${input.crops.length} planting${input.crops.length === 1 ? '' : 's'}`
      : undefined,
    note: allocationDone
      ? 'Seeds + blocks paired. Refine via the wizard chat.'
      : 'Pair seed stock to blocks.'
  });

  // 3. Schedule — done when at least one crop has a plantingDate.
  const scheduled = input.crops.filter((c) => c.plantingDate != null).length;
  const allScheduled = scheduled === input.crops.length && input.crops.length > 0;
  steps.push({
    id: 'schedule',
    label: 'Schedule',
    state: allScheduled ? 'done' : scheduled > 0 ? 'in-progress' : 'pending',
    when:
      scheduled > 0
        ? allScheduled
          ? `${scheduled}/${input.crops.length} dated`
          : `${scheduled}/${input.crops.length}`
        : undefined,
    note: allScheduled
      ? 'All plantings dated.'
      : scheduled > 0
        ? 'Some plantings still missing planting dates.'
        : 'Pick planting dates per planting.'
  });

  // 4. Inputs plan — done when at least one inputs-plan task exists.
  steps.push({
    id: 'inputs',
    label: 'Inputs plan',
    state: input.inputsTaskCount > 0 ? 'done' : 'pending',
    when: input.inputsTaskCount > 0 ? `${input.inputsTaskCount} tasks` : undefined,
    note:
      input.inputsTaskCount > 0
        ? 'Fertility + cover-crop + irrigation tasks committed.'
        : 'Sketch the fertility + cover-crop applications.'
  });

  // 5. Commit — done when plan_revisions row exists OR (fallback) when
  //    all four priors are done.
  const priorsAllDone = steps.every((s) => s.state === 'done');
  const commitDone =
    input.hasPlanRevision === true || (input.hasPlanRevision == null && priorsAllDone);
  steps.push({
    id: 'commit',
    label: 'Commit',
    state: commitDone ? 'done' : 'pending',
    note: commitDone ? 'Plan locked for the season.' : 'Final commit creates the audit row.'
  });

  return steps;
}
