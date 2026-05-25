<script lang="ts">
  /**
   * Phase 25b (#96 partial) — wizard header chrome.
   *
   * 1:1 port of `AWizardHeader` in
   * [`direction-almanac-wizard.jsx`](../../../../docs/design/almanac/direction-almanac-wizard.jsx)
   * (lines 12–93). Title row (Season YYYY plan · wizard kicker + serif
   * step heading + Exit / Save & resume actions) + horizontal stepper
   * with checkmark / number / hollow-circle states.
   *
   * Shared across all 7 wizard steps so the chrome stays consistent
   * and the per-step components don't each reinvent the stepper.
   * Per-step component-file extraction (the rest of #96) deferred —
   * mechanical refactor with high regression surface, low UX value.
   */
  import { Check, X, FileText, ChevronRight, AlertTriangle, Sprout } from 'lucide-svelte';

  export type WizardStepState = 'done' | 'active' | 'pending' | 'stale';

  export interface WizardStepDescriptor {
    id: string;
    label: string;
    /** Per-step state. `'active'` always reflects the currently-rendered step;
     *  consumers needn't compute that — pass `activeStepId` and we apply it. */
    state: WizardStepState;
    /** Short "May 17" / "11 plantings" hint that renders under the label. */
    hint?: string;
  }

  interface Props {
    seasonYear: number;
    steps: WizardStepDescriptor[];
    activeStepId: string;
    /** Optional title override; if omitted we derive from the active step. */
    title?: string;
    onStepClick?: (stepId: string) => void;
    onExit?: () => void;
    onSaveAndResume?: () => void;
  }
  const {
    seasonYear,
    steps,
    activeStepId,
    title,
    onStepClick,
    onExit,
    onSaveAndResume
  }: Props = $props();

  const activeTitle = $derived(
    title ?? steps.find((s) => s.id === activeStepId)?.label ?? 'Season plan'
  );
</script>

<header class="wh">
  <div class="wh-title-row">
    <div>
      <div class="wh-kicker">
        <Sprout size={12} strokeWidth={1.75} class="wh-kicker-icon" />
        Season {seasonYear} plan · wizard
      </div>
      <h1 class="serif wh-title">{activeTitle}</h1>
    </div>
    <div class="wh-actions">
      {#if onExit}
        <button class="ghost" type="button" onclick={onExit}>
          <X size={13} strokeWidth={1.75} /> Exit
        </button>
      {/if}
      {#if onSaveAndResume}
        <button class="ghost" type="button" onclick={onSaveAndResume}>
          <FileText size={13} strokeWidth={1.75} /> Save & resume later
        </button>
      {/if}
    </div>
  </div>

  <ol class="wh-stepper" aria-label="Wizard steps">
    {#each steps as s, i (s.id)}
      {@const isActive = s.id === activeStepId}
      {@const effectiveState: WizardStepState = isActive ? 'active' : s.state}
      <li>
        <button
          type="button"
          class="step"
          class:active={isActive}
          data-state={effectiveState}
          onclick={() => onStepClick?.(s.id)}
          disabled={!onStepClick}
          title={s.hint ?? s.label}
        >
          <span class="circle" data-state={effectiveState}>
            {#if effectiveState === 'done'}
              <Check size={12} strokeWidth={2.5} />
            {:else if effectiveState === 'stale'}
              <AlertTriangle size={11} strokeWidth={2} />
            {:else if effectiveState === 'pending'}
              {i + 1}
            {:else}
              <ChevronRight size={12} strokeWidth={2} />
            {/if}
          </span>
          <span class="text">
            <span class="label" class:active={isActive}>{s.label}</span>
            {#if s.hint}
              <span class="hint" data-state={effectiveState}>{s.hint}</span>
            {/if}
          </span>
        </button>
        {#if i < steps.length - 1}
          <span class="bar" data-prev={effectiveState} aria-hidden="true"></span>
        {/if}
      </li>
    {/each}
  </ol>
</header>

<style>
  .wh {
    background: var(--color-paper);
    border-bottom: 1px solid var(--color-divider);
  }
  .wh-title-row {
    padding: 16px 28px 12px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .wh-kicker {
    font-size: 11px;
    color: var(--color-ink-muted);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  :global(.wh-kicker .wh-kicker-icon) {
    color: var(--color-forest);
  }
  .wh-title {
    margin: 4px 0 0;
    font-size: 22px;
    color: var(--color-forest-deep);
    letter-spacing: -0.015em;
    font-family: var(--font-serif, serif);
  }
  .wh-actions {
    display: flex;
    gap: 8px;
  }
  .ghost {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: transparent;
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .ghost:hover {
    border-color: var(--color-forest-deep);
  }
  .wh-stepper {
    list-style: none;
    margin: 0;
    padding: 0 28px 14px;
    display: flex;
    align-items: center;
    gap: 0;
  }
  .wh-stepper li {
    display: flex;
    align-items: center;
    flex: 0 1 auto;
  }
  .wh-stepper li:has(.step.active),
  .wh-stepper li:has(.bar) {
    flex: 1 1 auto;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    font-family: inherit;
    cursor: pointer;
  }
  .step.active {
    background: var(--color-wheat-tint, #efe6cc);
  }
  .step:disabled {
    cursor: default;
  }
  .circle {
    width: 24px;
    height: 24px;
    border-radius: 99px;
    background: var(--color-paper);
    border: 1.5px solid var(--color-divider);
    color: var(--color-ink-muted);
    display: grid;
    place-items: center;
    font-size: 10.5px;
    font-weight: 700;
    flex-shrink: 0;
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .circle[data-state='done'] {
    background: var(--color-forest);
    color: var(--color-cream);
    border-color: var(--color-forest);
  }
  .circle[data-state='active'] {
    background: var(--color-forest);
    color: var(--color-cream);
    border-color: var(--color-forest);
  }
  .circle[data-state='stale'] {
    background: #f1d9ce;
    color: #8a341b;
    border-color: #e2b69e;
  }
  .text {
    text-align: left;
    line-height: 1.2;
  }
  .label {
    font-size: 12.5px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .label.active {
    color: var(--color-forest-deep);
    font-weight: 700;
  }
  .hint {
    display: block;
    font-size: 10.5px;
    color: var(--color-ink-muted);
    margin-top: 1px;
  }
  .hint[data-state='stale'] {
    color: #8a341b;
  }
  .bar {
    flex: 1 1 auto;
    min-width: 12px;
    height: 2px;
    background: var(--color-divider-soft, var(--color-divider));
    border-radius: 99px;
    margin: 0 4px;
  }
  .bar[data-prev='done'] {
    background: var(--color-forest);
    opacity: 0.4;
  }
  @media (max-width: 760px) {
    .wh-stepper {
      overflow-x: auto;
    }
    .text {
      display: none;
    }
    .step.active .text {
      display: block;
    }
  }
</style>
