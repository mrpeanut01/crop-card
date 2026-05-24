<script lang="ts">
  import { Pencil, Search, ScanBarcode, Camera, Image } from 'lucide-svelte';
  import {
    METHOD_META,
    type StockAddMethod
  } from '$lib/stock/addMethods';

  /**
   * Phase 25d (#89) — tab switcher for the Stock 5-method add waterfall.
   *
   * Renders one tab per enabled method (resolved server-side from the
   * STOCK_ADD_METHODS env var). The parent owns the active-method
   * state; this primitive just renders + emits onSelect.
   *
   * The disabled `photo` slot renders dimmed but un-clickable until
   * Phase 26 lands the AI-photo extract endpoint.
   */

  interface Props {
    methods: ReadonlyArray<StockAddMethod>;
    active: StockAddMethod;
    onSelect: (m: StockAddMethod) => void;
  }

  const { methods, active, onSelect }: Props = $props();

  const iconFor = (m: StockAddMethod) => {
    switch (m) {
      case 'manual':
        return Pencil;
      case 'search':
        return Search;
      case 'barcode':
        return ScanBarcode;
      case 'label':
        return Image;
      case 'photo':
        return Camera;
    }
  };
</script>

<div class="tabs" role="tablist" aria-label="Stock add method">
  {#each methods as m (m)}
    {@const meta = METHOD_META[m]}
    {@const Icon = iconFor(m)}
    {@const isActive = m === active}
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      class="tab"
      class:active={isActive}
      onclick={() => onSelect(m)}
    >
      <span class="tab-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.75} /></span>
      <span class="tab-label">{meta.label}</span>
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft);
    border-radius: var(--radius-input, 6px);
    padding: 6px;
  }
  .tab {
    flex: 1 1 auto;
    min-width: 96px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 12px;
    border: 1px solid transparent;
    background: transparent;
    border-radius: var(--radius-input, 6px);
    color: var(--color-ink-soft);
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    min-height: 60px;
  }
  .tab:hover {
    color: var(--color-ink);
    background: var(--color-paper);
  }
  .tab.active {
    background: var(--color-paper);
    border-color: var(--color-divider);
    color: var(--color-forest-deep);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }
  .tab-icon {
    display: grid;
    place-items: center;
  }
  .tab-label {
    letter-spacing: 0.01em;
  }
  @media (max-width: 600px) {
    .tab {
      min-width: 76px;
      padding: 8px 6px;
      font-size: 12px;
    }
  }
</style>
