<script lang="ts">
  import { Check, ChevronRight, TriangleAlert, Sprout, ArrowRight } from 'lucide-svelte';

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
  }

  interface Props {
    seasonYear: number;
    steps: WorkflowStep[];
    onOpenWizard?: () => void;
    /** When provided, clicking a step fires with that step's id. */
    onSelectStep?: (id: string) => void;
  }

  const { seasonYear, steps, onOpenWizard, onSelectStep }: Props = $props();

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
        return s.when ? `✓ ${s.when}` : 'Done';
      case 'in-progress':
        return s.when ? `${s.when} · in progress` : 'In progress';
      case 'stale':
        return 'Stale · refresh';
      case 'pending':
        return s.when ?? 'Pending';
    }
  }
</script>

<div class="strip" role="group" aria-label={`Season ${seasonYear} workflow`}>
  <div class="label">
    <div class="kicker">Season {seasonYear} plan</div>
    <div class="title">
      <Sprout size={13} strokeWidth={1.75} aria-hidden="true" />
      <span>Workflow</span>
    </div>
  </div>

  <ol class="trail" aria-label="Workflow steps">
    {#each steps as s, i (s.id)}
      {@const meta = STATE_META[s.state]}
      {@const Icon = meta.icon}
      <li class="step">
        <button
          type="button"
          class="step-btn"
          title={[s.note, s.when].filter(Boolean).join(' · ')}
          onclick={() => onSelectStep?.(s.id)}
          disabled={!onSelectStep}
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
          </span>
        </button>
        {#if i < steps.length - 1}
          <span class="trail-bar" class:done={s.state === 'done'} aria-hidden="true"></span>
        {/if}
      </li>
    {/each}
  </ol>

  {#if onOpenWizard}
    <button
      class="cta"
      type="button"
      onclick={onOpenWizard}
      title="Re-run any step or chat with the planning assistant"
    >
      <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
      Open wizard
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
  .cta:hover {
    filter: brightness(1.1);
  }
  .cta:focus-visible {
    outline: 2px solid var(--color-forest);
    outline-offset: 2px;
  }
</style>
