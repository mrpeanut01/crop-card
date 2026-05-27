<script lang="ts">
  import { INVENTORY_TYPES, INVENTORY_TYPE_LABELS, type InventoryType } from '$lib/inventory/types';

  /**
   * Phase 27A primitive (#257). The 5-chip type-swap row that sits at
   * the top of every unified inventory list, detail, and edit screen.
   * Click switches `?type=` and re-renders the parent's data binding
   * without page reload — the chrome shape is identical, only the rows
   * and per-type columns change. This is what Invariant 8 codifies:
   * "per-type fields differ; per-type chrome does not".
   *
   * The control surface is `<button>` (not anchor) — the parent decides
   * whether to navigate or to update local state via `onTypeChange`.
   */
  interface Props {
    activeType: InventoryType;
    onTypeChange: (type: InventoryType) => void;
    /** Optional per-type counts surfaced as a small badge after the
     *  label, e.g. "Pesticides 3". Pass undefined to hide. */
    countByType?: Partial<Record<InventoryType, number>>;
  }

  const { activeType, onTypeChange, countByType }: Props = $props();
</script>

<div class="inv-type-chip-row" role="tablist" aria-label="Inventory type">
  {#each INVENTORY_TYPES as type (type)}
    <button
      type="button"
      role="tab"
      class="chip"
      class:active={type === activeType}
      aria-selected={type === activeType}
      onclick={() => onTypeChange(type)}
    >
      {INVENTORY_TYPE_LABELS[type]}
      {#if countByType?.[type] !== undefined}
        <span class="count">{countByType[type]}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .inv-type-chip-row {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .chip {
    background: var(--color-paper, #fff);
    border: 1px solid var(--color-divider, #e5e7e0);
    border-radius: 99px;
    padding: 6px 14px;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-ink, #1c1c1c);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    transition:
      background 0.1s ease,
      border-color 0.1s ease;
  }
  .chip:hover {
    background: var(--color-forest-tint, #e8f1ea);
    border-color: var(--color-forest, #1f5e3a);
  }
  .chip.active {
    background: var(--color-forest, #1f5e3a);
    border-color: var(--color-forest, #1f5e3a);
    color: var(--color-cream, #fff8e1);
  }
  .count {
    font-size: 0.7rem;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 99px;
    background: rgba(0, 0, 0, 0.08);
  }
  .chip.active .count {
    background: rgba(255, 255, 255, 0.22);
  }
</style>
