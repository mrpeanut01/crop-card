<script lang="ts">
  /**
   * #555: Drilled or Broadcast for a crop sown by area that has both rates.
   * The saved method picks which sourced rate the planting's seed amount
   * uses; null means the crop's default.
   */
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { sowMethodLabel } from '$lib/plan/seedAmountText';
  import type { SavedSowMethod } from '$lib/plan/spacingModel';

  interface Props {
    methods: readonly SavedSowMethod[];
    value?: SavedSowMethod | null;
    disabled?: boolean;
  }

  let { methods, value = $bindable(null), disabled = false }: Props = $props();
  const tr = $derived(createT(page.data?.locale));
</script>

<fieldset class="sow" data-testid="sow-method">
  <legend class="label">{tr('plan.sow.label')}</legend>
  <div class="choices" role="group" aria-label={tr('plan.sow.label')}>
    {#each methods as m (m)}
      <button
        type="button"
        class="chip"
        {disabled}
        aria-pressed={value === m}
        onclick={() => (value = m)}>{sowMethodLabel(m, page.data?.locale)}</button
      >
    {/each}
  </div>
</fieldset>

<style>
  .sow {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    min-width: 0;
  }
  .label {
    font-weight: 600;
    font-size: var(--font-size-caption, 0.875rem);
    color: var(--color-ink, inherit);
    padding: 0;
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2, 8px);
  }
  .chip {
    min-height: 48px;
    min-width: 96px;
    padding: 0 var(--space-4, 16px);
    border-radius: var(--radius-input, 8px);
    border: 1px solid var(--color-rule, #ccc);
    background: var(--color-paper, #fff);
    color: var(--color-ink, #222);
    font-size: var(--font-size-body, 1rem);
    font-weight: 600;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] {
    background: var(--color-forest, #2f5d3a);
    border-color: var(--color-forest, #2f5d3a);
    color: var(--color-paper, #fff);
  }
</style>
