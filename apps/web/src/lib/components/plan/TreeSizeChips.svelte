<script lang="ts">
  /**
   * #548: "Tree size" for a crop with a tree size table. One chip per size
   * class the plugin has, plus Not sure (the default). The answer is always
   * `manual`; it sets spacing and the first-fruit advice only.
   */
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import type { TreeSizeClass, TreeSizeRow } from '$lib/plan/spacingModel';

  interface Props {
    classes: readonly TreeSizeRow[];
    value?: TreeSizeClass | null;
    disabled?: boolean;
  }

  let { classes, value = $bindable(null), disabled = false }: Props = $props();
  const tr = $derived(createT(page.data?.locale));
</script>

<fieldset class="tsc" data-testid="tree-size">
  <legend class="label">{tr('plan.tree.label')}</legend>
  <div class="choices" role="group" aria-label={tr('plan.tree.label')}>
    {#each classes as row (row.sizeClass)}
      <button
        type="button"
        class="chip"
        {disabled}
        aria-pressed={value === row.sizeClass}
        onclick={() => (value = row.sizeClass)}
        >{tr(`cards.care.treeSize.${row.sizeClass}` as 'cards.care.treeSize.dwarf')}</button
      >
    {/each}
    <button
      type="button"
      class="chip"
      {disabled}
      aria-pressed={value === null}
      onclick={() => (value = null)}>{tr('cards.tree.notSure')}</button
    >
    {#if value}<Provenance source="manual" compact />{/if}
  </div>
  <p class="hint">{tr('plan.tree.hint')}</p>
</fieldset>

<style>
  .tsc {
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
    align-items: center;
    gap: var(--space-2, 8px);
  }
  .chip {
    min-height: 48px;
    min-width: 48px;
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
  .hint {
    margin: 0;
    font-size: var(--font-size-caption, 0.875rem);
    color: var(--color-ink-soft, #555);
  }
</style>
