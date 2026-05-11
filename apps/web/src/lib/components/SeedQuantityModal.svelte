<script lang="ts">
  import type { CropPlugin } from '$lib/plugins/schemas';
  import { seedsToPlants } from '$lib/seed/quantity';

  type StockEntry = {
    stockItemId: string;
    displayName: string;
    onHand: number;
    defaultUnit: string;
    cropPluginId: string;
    cropFamily?: string | null;
  };

  const FAMILY_ICON: Record<string, string> = {
    allium: '🧅', apiaceae: '🥕', bramble: '🫐', brassica: '🥦',
    'broadleaf-companion': '🌸', 'cereal-grain': '🌾', corn: '🌽',
    'cover-grass': '🌿', 'cover-legume': '🌿', cucurbit: '🎃',
    forage: '🌾', 'herb-culinary': '🌿', 'leafy-green': '🥬',
    legume: '🫘', orchard: '🍎', root: '🥕', 'small-fruit': '🍓',
    solanaceae: '🍅', 'stone-fruit': '🍑', 'vine-fruit': '🍇'
  };

  let {
    stock,
    plugin,
    onConfirm,
    onClose
  }: {
    stock: StockEntry;
    plugin: CropPlugin | undefined;
    onConfirm: (input: { quantity: number; unit: string; quantityPlants: number }) => void;
    onClose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally — intentional: seed initial value
  // from the prop, then user edits independently. Modal is not reused across
  // different stock items (parent re-mounts via {#if activeSeedModal}).
  let quantity = $state(stock.onHand);

  const stepOptions = $derived(stepFor(stock.defaultUnit));

  function stepFor(unit: string): { coarse: number; fine: number } {
    if (unit === 'lb') return { coarse: 1, fine: 0.25 };
    if (unit === 'oz') return { coarse: 1, fine: 0.5 };
    if (unit === 'g') return { coarse: 50, fine: 10 };
    if (unit === 'seeds') return { coarse: 100, fine: 10 };
    if (unit === 'count') return { coarse: 10, fine: 1 };
    if (unit === 'packets') return { coarse: 1, fine: 1 };
    return { coarse: 1, fine: 0.25 };
  }

  function bump(delta: number) {
    const next = Math.max(0, Math.min(stock.onHand, +(quantity + delta).toFixed(2)));
    quantity = next;
  }

  const plantEquivalent = $derived.by(() => {
    if (!plugin) return null;
    const result = seedsToPlants({
      unit: stock.defaultUnit,
      quantity,
      plugin
    });
    return result?.plants ?? null;
  });

  function commit() {
    if (quantity <= 0) return;
    onConfirm({
      quantity,
      unit: stock.defaultUnit,
      quantityPlants: plantEquivalent ?? Math.max(1, Math.round(quantity))
    });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter' && quantity > 0) {
      e.preventDefault();
      commit();
    }
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div
  class="qm-backdrop"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
>
  <div class="qm-modal" role="dialog" aria-modal="true" aria-labelledby="qm-title">
    <div class="qm-header">
      <h2 id="qm-title">
        <span class="qm-family" aria-hidden="true">{stock.cropFamily ? (FAMILY_ICON[stock.cropFamily] ?? '🌱') : '🌱'}</span>
        {stock.displayName}
      </h2>
      <button class="qm-close" type="button" aria-label="Close" onclick={onClose}>✕</button>
    </div>

    <div class="qm-body">
      <p class="qm-onhand">On hand: <strong>{stock.onHand} {stock.defaultUnit}</strong></p>

      <label class="qm-label" for="qm-input">How much to plant?</label>
      <div class="qm-input-row">
        <button type="button" class="qm-step" onclick={() => bump(-stepOptions.coarse)} aria-label="Decrease by {stepOptions.coarse}">
          −−
        </button>
        <button type="button" class="qm-step" onclick={() => bump(-stepOptions.fine)} aria-label="Decrease by {stepOptions.fine}">
          −
        </button>
        <input
          id="qm-input"
          class="qm-input"
          type="number"
          inputmode="decimal"
          step={stepOptions.fine}
          min="0"
          max={stock.onHand}
          bind:value={quantity}
        />
        <span class="qm-unit">{stock.defaultUnit}</span>
        <button type="button" class="qm-step" onclick={() => bump(stepOptions.fine)} aria-label="Increase by {stepOptions.fine}">
          +
        </button>
        <button type="button" class="qm-step" onclick={() => bump(stepOptions.coarse)} aria-label="Increase by {stepOptions.coarse}">
          ++
        </button>
      </div>

      {#if plantEquivalent !== null}
        <p class="qm-plants">≈ <strong>{plantEquivalent.toLocaleString()}</strong> plants</p>
      {/if}
    </div>

    <div class="qm-footer">
      <button type="button" class="qm-cancel" onclick={onClose}>Cancel</button>
      <button type="button" class="qm-confirm" onclick={commit} disabled={quantity <= 0}>
        Add to plan
      </button>
    </div>
  </div>
</div>

<style>
  .qm-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1300;
    padding: 1rem;
  }

  .qm-modal {
    background: white;
    border-radius: 10px;
    width: 100%;
    max-width: 480px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
    border-top: 6px solid #1f5e3a;
  }

  .qm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem 0.75rem;
    border-bottom: 1px solid #e4e9e4;
  }

  .qm-header h2 {
    margin: 0;
    font-size: 1.15rem;
    color: #1f5e3a;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .qm-family { font-size: 1.4rem; line-height: 1; }

  .qm-close {
    background: none;
    border: none;
    font-size: 1.2rem;
    color: #666;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    line-height: 1;
    min-width: 48px;
    min-height: 48px;
  }

  .qm-body {
    padding: 1rem 1.25rem;
  }

  .qm-onhand {
    margin: 0 0 1rem;
    color: #4a5d4a;
    font-size: 0.95rem;
  }

  .qm-label {
    display: block;
    margin: 0 0 0.5rem;
    font-weight: 600;
    color: #1f5e3a;
    font-size: 0.95rem;
  }

  .qm-input-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .qm-step {
    min-width: 48px;
    min-height: 48px;
    border: 1px solid #cbd5cb;
    background: #f8fbf9;
    color: #1f5e3a;
    font-size: 1.1rem;
    font-weight: 700;
    border-radius: 6px;
    cursor: pointer;
  }

  .qm-step:active {
    background: #e4eee6;
  }

  .qm-input {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    padding: 0.5rem 0.75rem;
    font-size: 1.1rem;
    text-align: right;
    border: 1px solid #cbd5cb;
    border-radius: 6px;
  }

  .qm-unit {
    color: #4a5d4a;
    font-weight: 600;
    min-width: 2.5rem;
  }

  .qm-plants {
    margin: 0;
    color: #1f5e3a;
    font-size: 0.95rem;
  }

  .qm-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 0.75rem 1.25rem 1rem;
    border-top: 1px solid #e4e9e4;
  }

  .qm-cancel,
  .qm-confirm {
    min-height: 48px;
    padding: 0 1.25rem;
    border-radius: 6px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid #cbd5cb;
  }

  .qm-cancel {
    background: white;
    color: #4a5d4a;
  }

  .qm-confirm {
    background: #1f5e3a;
    color: white;
    border-color: #1f5e3a;
  }

  .qm-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
