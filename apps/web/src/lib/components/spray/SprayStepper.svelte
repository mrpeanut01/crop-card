<script lang="ts">
  /**
   * Phase 25b (#85) — herbicide /spray stepper.
   *
   * 1:1 port of the stepper in ASprayScreen at
   * [`direction-almanac-rest.jsx`](../../../../docs/design/almanac/direction-almanac-rest.jsx)
   * (lines 236–258). 5 steps with checkmark / number / hollow circle
   * states + connectors. Maps 1:1 to the herbicide flow:
   *
   *   1. Block & crop   — selectedBlocks.length > 0
   *   2. Sprayer & tank — a sprayer is selected
   *   3. Mix            — at least one product selected
   *   4. Safety check   — kernel verdict computed (passing or blocked)
   *   5. Confirm & record — ready to submit
   */
  import { Check } from 'lucide-svelte';

  export type StepState = 'done' | 'active' | 'pending';

  interface Props {
    steps: Array<{ label: string; state: StepState }>;
  }
  const { steps }: Props = $props();
</script>

<nav class="stepper" aria-label="Spray flow progress">
  {#each steps as s, i (s.label)}
    <div class="step" class:done={s.state === 'done'} class:active={s.state === 'active'}>
      <div class="circle" class:done={s.state === 'done'} class:active={s.state === 'active'}>
        {#if s.state === 'done'}
          <Check size={11} strokeWidth={2.5} />
        {:else}
          {i + 1}
        {/if}
      </div>
      <span class="label">{s.label}</span>
    </div>
    {#if i < steps.length - 1}
      <div class="connector" aria-hidden="true"></div>
    {/if}
  {/each}
</nav>

<style>
  .stepper {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 22px;
    flex-wrap: wrap;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .circle {
    width: 24px;
    height: 24px;
    border-radius: 99px;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    color: var(--color-ink-muted);
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .circle.done {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: var(--color-cream);
  }
  .circle.active {
    background: var(--color-wheat, #b8893c);
    border-color: var(--color-wheat, #b8893c);
    color: var(--color-cream);
  }
  .label {
    font-size: 13px;
    color: var(--color-ink-muted);
    font-weight: 500;
  }
  .step.done .label,
  .step.active .label {
    color: var(--color-ink);
  }
  .step.active .label {
    font-weight: 600;
  }
  .connector {
    flex: 1;
    height: 1px;
    background: var(--color-divider);
    min-width: 12px;
  }
  @media (max-width: 700px) {
    .stepper {
      gap: 8px;
    }
    .label {
      display: none;
    }
    .step.active .label {
      display: inline;
    }
  }
</style>
