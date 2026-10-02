<script lang="ts">
  import {
    Check,
    ChevronRight,
    TriangleAlert,
    Sprout,
    ArrowRight,
    CalendarDays
  } from 'lucide-svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  /**
   * Phase 25 v2 (#81 partial) — horizontal workflow strip mapping the
   * season-plan steps for a block back to the planning wizard.
   *
   * Port of `APlanWorkflowStrip` from
   * [`direction-almanac-plan-v2.jsx`](../../../../../docs/design/almanac/direction-almanac-plan-v2.jsx).
   * Pure presentational — caller derives the step list (each with state
   * + label + optional when-text + note) and an `onOpenWizard` callback.
   *
   * Standalone for now — the /plan v2 rebuild (#81) wires it once a
   * `seasonPlan.steps` server derivation lands.
   */

  export type WorkflowStepState = 'done' | 'in-progress' | 'stale' | 'pending';

  export interface WorkflowStep {
    id: string;
    label: string;
    state: WorkflowStepState;
    /** Optional human-readable "Apr 12" / "2 days ago" / "in progress". */
    when?: string;
    /** Optional tooltip body when the user hovers a step. */
    note?: string;
    /** When true the step renders but cannot be activated. */
    disabled?: boolean;
    /** Where a click lands (or why it can't), appended to the tooltip. */
    actionHint?: string;
  }

  interface Props {
    seasonYear: number;
    steps: WorkflowStep[];
    onOpenWizard?: () => void;
    /** When provided, clicking a step fires with that step's id. */
    onSelectStep?: (id: string) => void;
    /** When set, a "Sowing calendar" link to the printable calendar. */
    calendarHref?: string;
  }

  const { seasonYear, steps, onOpenWizard, onSelectStep, calendarHref }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  type LucideIcon = typeof Check;
  const STATE_META: Record<
    WorkflowStepState,
    { bgVar: string; fgVar: string; bdVar: string; icon: LucideIcon | null }
  > = {
    done: {
      bgVar: '--color-forest',
      fgVar: '--color-cream',
      bdVar: '--color-forest',
      icon: Check
    },
    'in-progress': {
      bgVar: '--color-wheat',
      fgVar: '--color-cream',
      bdVar: '--color-wheat',
      icon: ChevronRight
    },
    stale: {
      bgVar: '--pill-rust-bg',
      fgVar: '--pill-rust-fg',
      bdVar: '--pill-rust-bd',
      icon: TriangleAlert
    },
    pending: {
      bgVar: '--color-paper',
      fgVar: '--color-ink-muted',
      bdVar: '--color-divider',
      icon: null
    }
  };

  function whenLabel(s: WorkflowStep): string {
    switch (s.state) {
      case 'done':
        return s.when ? tr('planui.wf.doneWhen', { when: s.when }) : tr('planui.wf.done');
      case 'in-progress':
        return s.when
          ? tr('planui.wf.inProgressWhen', { when: s.when })
          : tr('planui.wf.inProgress');
      case 'stale':
        return tr('planui.wf.stale');
      case 'pending':
        return s.when ?? tr('planui.wf.pending');
    }
  }
</script>

<div class="strip" role="group" aria-label={tr('planui.wf.groupAria', { year: seasonYear })}>
  <div class="label">
    <div class="kicker">{tr('planui.wf.kicker', { year: seasonYear })}</div>
    <div class="title">
      <Sprout size={13} strokeWidth={1.75} aria-hidden="true" />
      <span>{tr('planui.wf.workflow')}</span>
    </div>
  </div>

  <ol class="trail" aria-label={tr('planui.wf.stepsAria')}>
    {#each steps as s, i (s.id)}
      {@const meta = STATE_META[s.state]}
      {@const Icon = meta.icon}
      <li class="step">
        <button
          type="button"
          class="step-btn"
          title={[s.note, s.when, s.actionHint].filter(Boolean).join(' · ')}
          onclick={() => {
            if (!s.disabled) onSelectStep?.(s.id);
          }}
          disabled={!onSelectStep || s.disabled}
        >
          <span
            class="dot"
            style:background={`var(${meta.bgVar})`}
            style:color={`var(${meta.fgVar})`}
            style:border-color={`var(${meta.bdVar})`}
            aria-hidden="true"
          >
            {#if Icon}
              <Icon size={11} strokeWidth={1.75} />
            {:else}
              {i + 1}
            {/if}
          </span>
          <span class="step-text">
            <span class="step-label">{s.label}</span>
            <span class="step-when" class:stale={s.state === 'stale'}>{whenLabel(s)}</span>
            {#if onSelectStep && s.actionHint}
              <span class="sr-only">{s.actionHint}</span>
            {/if}
          </span>
        </button>
        {#if i < steps.length - 1}
          <span class="trail-bar" class:done={s.state === 'done'} aria-hidden="true"></span>
        {/if}
      </li>
    {/each}
  </ol>

  {#if calendarHref}
    <a class="cal-link" href={calendarHref}>
      <CalendarDays size={13} strokeWidth={1.75} aria-hidden="true" />
      {tr('planui.wf.calendar')}
    </a>
  {/if}

  {#if onOpenWizard}
    <button class="cta" type="button" onclick={onOpenWizard} title={tr('planui.wf.openTitle')}>
      <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
      {tr('planui.wf.open')}
    </button>
  {/if}
</div>

<style>
  .strip {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-hero, 10px);
    padding: 14px 18px 12px;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .label {
    flex-shrink: 0;
    padding-right: 10px;
    border-right: 1px solid var(--color-divider-soft);
  }
  .kicker {
    font-size: 10.5px;
    color: var(--color-ink-muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 700;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
    font-size: 12.5px;
    color: var(--color-forest-deep);
    font-weight: 600;
  }
  .trail {
    /* Containing block for the absolutely-positioned .sr-only spans, so
       they are clipped by the trail's own scroll box instead of widening
       the page at 375px. */
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .step {
    display: flex;
    align-items: center;
    flex: 1;
  }
  .step:last-child {
    flex: 0;
  }
  .step-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 5px 10px 5px 5px;
    border-radius: 999px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-family: inherit;
    text-align: left;
  }
  .step-btn:disabled {
    cursor: default;
    opacity: 0.65;
  }
  .step-btn:not(:disabled):hover {
    background: var(--color-divider-soft);
  }
  .step-btn:focus-visible {
    outline: 2px solid var(--color-forest);
    outline-offset: 2px;
  }
  .dot {
    width: 22px;
    height: 22px;
    border-radius: 999px;
    border: 1.5px solid transparent;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 700;
  }
  .step-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .step-label {
    font-size: 12px;
    color: var(--color-ink);
    font-weight: 600;
    line-height: 1.2;
  }
  .step-when {
    font-size: 10.5px;
    color: var(--color-ink-muted);
    line-height: 1.3;
    margin-top: 1px;
  }
  .step-when.stale {
    color: var(--pill-rust-fg);
  }
  .trail-bar {
    flex: 1;
    height: 2px;
    background: var(--color-divider-soft);
    margin: 0 4px;
    border-radius: 999px;
    opacity: 0.25;
  }
  .trail-bar.done {
    background: var(--color-forest);
    opacity: 0.4;
  }
  .cta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    min-height: 48px;
    padding: 8px 14px;
    background: var(--color-forest);
    color: var(--color-cream);
    border: none;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .cal-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    min-height: 48px;
    padding: 8px 12px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    color: var(--color-forest-deep);
    font-size: 12.5px;
    font-weight: 600;
    text-decoration: none;
  }
  .cal-link:focus-visible {
    outline: 2px solid var(--color-forest);
    outline-offset: 2px;
  }
  .cta:hover {
    filter: brightness(1.1);
  }
  .cta:focus-visible {
    outline: 2px solid var(--color-forest);
    outline-offset: 2px;
  }
  @media (max-width: 900px) {
    .strip {
      flex-wrap: wrap;
    }
    .label {
      border-right: none;
    }
    .trail {
      order: 3;
      flex-basis: 100%;
      min-width: 0;
      overflow-x: auto;
    }
    .step {
      flex: 0 0 auto;
    }
    .trail-bar {
      flex: 0 0 16px;
    }
    .cta {
      margin-left: auto;
    }
  }
</style>
