<script lang="ts">
  import { Search, ScanBarcode, Image as ImageIcon, Globe, Pencil } from 'lucide-svelte';
  import A_InventoryEditForm from './A_InventoryEditForm.svelte';
  import SearchPanel from '$lib/components/stock/add/SearchPanel.svelte';
  import BarcodePanel from '$lib/components/stock/add/BarcodePanel.svelte';
  import LabelOcrPanel from '$lib/components/stock/add/LabelOcrPanel.svelte';
  import UrlPanel from '$lib/components/stock/add/UrlPanel.svelte';
  import type { InventoryType } from '$lib/inventory/types';
  import type { StockEntryDraft } from '$lib/stock/normalizeStockEntry';

  /**
   * Phase 27 follow-on (#296) — the multi-modal add waterfall, finally
   * wired into the live `/inventory/[type]/add` route.
   *
   * Two phases:
   *   1. `pick`    — method chips + the chosen capture panel. Each panel
   *                  emits an `onSubmit(draft)` when it resolves a product.
   *   2. `approve` — the canonical `A_InventoryEditForm` pre-filled from
   *                  the draft, with a provenance banner. The operator
   *                  reviews every field, then saves. Nothing persists
   *                  until then ("AI assists, never gates", Invariant 7).
   *
   * Claude-required methods (Scan label, From URL, and the web tier of
   * Search) only appear when an Anthropic key is configured (`aiEnabled`).
   * No-key methods (local Search, Barcode via OpenFoodFacts, Manual)
   * always work — no dead-ends.
   *
   * Sprayer + crop are not lot-bearing scan targets, so they skip the
   * picker and render the plain manual form directly.
   */

  interface Props {
    type: InventoryType;
    aiEnabled: boolean;
  }

  const { type, aiEnabled }: Props = $props();

  type AddMethod = 'search' | 'barcode' | 'label' | 'url' | 'manual';

  interface MethodMeta {
    id: AddMethod;
    label: string;
    blurb: string;
    icon: typeof Search;
    /** Hidden when no Anthropic key is configured. */
    aiRequired: boolean;
  }

  const METHODS: MethodMeta[] = [
    {
      id: 'search',
      label: 'Search',
      blurb: 'Type the name — instant matches from your plugin library.',
      icon: Search,
      aiRequired: false
    },
    {
      id: 'barcode',
      label: 'Scan barcode',
      blurb: 'Point the camera at the UPC/EAN. OpenFoodFacts first, then Claude.',
      icon: ScanBarcode,
      aiRequired: false
    },
    {
      id: 'label',
      label: 'Scan label',
      blurb: 'Photograph the label or any product shot — Claude Vision extracts the fields.',
      icon: ImageIcon,
      aiRequired: true
    },
    {
      id: 'url',
      label: 'From URL',
      blurb: 'Paste a product page link — Claude reads it into a draft.',
      icon: Globe,
      aiRequired: true
    },
    {
      id: 'manual',
      label: 'Type it in',
      blurb: 'Fill the fields by hand. Works offline, no key needed.',
      icon: Pencil,
      aiRequired: false
    }
  ];

  // Sprayer + crop aren't scan/search targets — render the bare form.
  const lotBearing = $derived(type === 'pesticide' || type === 'fertility' || type === 'seed');

  const visibleMethods = $derived(METHODS.filter((m) => aiEnabled || !m.aiRequired));

  type Phase = 'pick' | 'approve';
  let phase = $state<Phase>('pick');
  let method = $state<AddMethod>('search');
  let draft = $state<StockEntryDraft | null>(null);
  let busy = $state(false);

  function selectMethod(m: AddMethod): void {
    if (m === 'manual') {
      // Manual skips straight to an empty form.
      draft = { source: 'manual' };
      phase = 'approve';
      return;
    }
    method = m;
  }

  function onPanelDraft(d: StockEntryDraft): void {
    draft = d;
    phase = 'approve';
  }

  function backToMethods(): void {
    draft = null;
    phase = 'pick';
  }
</script>

{#if !lotBearing}
  <A_InventoryEditForm {type} />
{:else if phase === 'approve'}
  <button type="button" class="back-link" onclick={backToMethods}
    >← Choose a different method</button
  >
  <A_InventoryEditForm {type} prefill={draft ?? undefined} />
{:else}
  <header class="flow-header">
    <span class="kicker">Add · {type}</span>
    <h1 class="serif">New {type}</h1>
    <p class="lede">
      Pick how you want to add it — scan, search, or type it in. You'll review every field before
      saving.
    </p>
  </header>

  <div class="method-row" role="tablist" aria-label="Add method">
    {#each visibleMethods as m (m.id)}
      {@const Icon = m.icon}
      <button
        type="button"
        role="tab"
        aria-selected={method === m.id}
        class="method-chip"
        class:active={method === m.id}
        onclick={() => selectMethod(m.id)}
      >
        <span class="chip-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.75} /></span>
        <span class="chip-label">{m.label}</span>
      </button>
    {/each}
  </div>

  {#if !aiEnabled}
    <p class="ai-note">
      Scan-label and web lookup need a Claude API key —
      <a href="/settings/ai" target="_blank" rel="noopener">add one in Settings</a> to unlock them.
    </p>
  {/if}

  <div class="panel">
    {#if method === 'search'}
      <SearchPanel {type} {aiEnabled} {busy} onSubmit={onPanelDraft} />
    {:else if method === 'barcode'}
      <BarcodePanel {type} {busy} onSubmit={onPanelDraft} />
    {:else if method === 'label'}
      <LabelOcrPanel
        {busy}
        {aiEnabled}
        onSubmit={onPanelDraft}
        onSwitchToManual={() => selectMethod('manual')}
      />
    {:else if method === 'url'}
      <UrlPanel {type} {busy} onSubmit={onPanelDraft} />
    {/if}
  </div>
{/if}

<style>
  .flow-header {
    margin-bottom: 16px;
  }
  .kicker {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--color-ink-muted, #6a6f63);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  h1 {
    margin: 2px 0 4px;
    font-size: 1.5rem;
    color: var(--color-forest-deep, #1f3522);
  }
  .lede {
    margin: 0;
    font-size: 0.9rem;
    color: var(--color-ink-soft, #4a4f43);
    max-width: 60ch;
  }
  .method-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
  }
  .method-chip {
    flex: 1 1 auto;
    min-width: 104px;
    min-height: 64px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 10px 12px;
    border: 1px solid var(--color-divider, #e5e7e0);
    background: var(--color-paper, #fff);
    border-radius: 8px;
    color: var(--color-ink-soft, #4a4f43);
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .method-chip:hover {
    border-color: var(--color-forest, #1f5e3a);
    color: var(--color-forest-deep, #1f3522);
  }
  .method-chip.active {
    border-color: var(--color-forest, #1f5e3a);
    color: var(--color-forest-deep, #1f3522);
    box-shadow: inset 0 0 0 1px var(--color-forest, #1f5e3a);
  }
  .chip-icon {
    display: grid;
    place-items: center;
  }
  .ai-note {
    margin: 0 0 12px;
    font-size: 0.8rem;
    color: var(--color-ink-muted, #6a6f63);
    padding: 8px 12px;
    background: var(--color-cream, #fff8e1);
    border-radius: 6px;
  }
  .ai-note a {
    color: var(--color-forest, #1f5e3a);
  }
  .panel {
    border: 1px solid var(--color-divider, #e5e7e0);
    border-radius: 8px;
    padding: 16px;
    background: var(--color-paper, #fff);
  }
  .back-link {
    background: transparent;
    border: 0;
    color: var(--color-forest, #1f5e3a);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    padding: 0;
    margin-bottom: 12px;
  }
  .back-link:hover {
    text-decoration: underline;
  }
</style>
