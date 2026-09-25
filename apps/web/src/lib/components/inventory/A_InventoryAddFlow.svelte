<script lang="ts">
  import { Search, ScanBarcode, Image as ImageIcon, Globe, Pencil } from 'lucide-svelte';
  import A_InventoryEditForm from './A_InventoryEditForm.svelte';
  import SearchPanel from '$lib/components/stock/add/SearchPanel.svelte';
  import BarcodePanel from '$lib/components/stock/add/BarcodePanel.svelte';
  import LabelOcrPanel from '$lib/components/stock/add/LabelOcrPanel.svelte';
  import LabelBatchQueue from '$lib/components/stock/add/LabelBatchQueue.svelte';
  import { LabelBatch, type BatchRow } from '$lib/stock/labelBatch.svelte';
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
   * Claude-required methods (Scan label, From URL) always render their
   * chips regardless of `aiEnabled` (#312 / CT-S3-002, Invariant 7 —
   * "AI assists, never gates"). With no key the chip is reachable and
   * its PANEL renders the built-in pre-flight recovery empty-state
   * ("Configure AI key" + "Switch to Manual"). Hiding the chips
   * outright was the bug: it made the recovery empty-state
   * (LabelOcrPanel:165-190) unreachable and left the operator with an
   * unexplained 3-of-5 chip row. No-key methods (local Search, Barcode
   * via OpenFoodFacts, Manual) work end-to-end — no dead-ends.
   *
   * Sprayer + crop are not lot-bearing scan targets, so they skip the
   * picker and render the plain manual form directly.
   *
   * #152 — the picker is the mockup's card grid (icon chip + label +
   * mono hint), still an ARIA tablist with roving tabindex + arrow keys.
   * #201 — each panel owns its own error state and is remounted on a
   * method switch, so an error from one method never leaks into another.
   * #249 — picking several label photos starts a sequential batch
   * queue; each draft is reviewed and saved through the same canonical
   * form (one POST /api/stock, one audit row per item).
   */

  interface Props {
    type: InventoryType;
    aiEnabled: boolean;
    /** Only the owner can POST /api/stock. Helpers can still look products
     *  up, but don't get the multi-photo batch (30 Claude calls they could
     *  never save). The server enforces the gate either way. */
    canSave?: boolean;
  }

  const { type, aiEnabled, canSave = true }: Props = $props();

  type AddMethod = 'search' | 'barcode' | 'label' | 'url' | 'manual';

  interface MethodMeta {
    id: AddMethod;
    label: string;
    blurb: string;
    hint: string;
    icon: typeof Search;
    /** Needs an Anthropic key to *resolve* a draft. The chip always
     *  renders (#312); the panel shows a no-key recovery empty-state. */
    aiRequired: boolean;
  }

  const METHODS: MethodMeta[] = [
    {
      id: 'search',
      hint: 'Plugin library → web',
      label: 'Search',
      blurb: 'Type the name — instant matches from your plugin library.',
      icon: Search,
      aiRequired: false
    },
    {
      id: 'barcode',
      hint: 'UPC · EAN · DataMatrix',
      label: 'Scan barcode',
      blurb: 'Point the camera at the UPC/EAN. OpenFoodFacts first, then Claude.',
      icon: ScanBarcode,
      aiRequired: false
    },
    {
      id: 'label',
      hint: 'Claude Vision · batch OK',
      label: 'Scan label',
      blurb: 'Photograph the label or any product shot — Claude Vision extracts the fields.',
      icon: ImageIcon,
      aiRequired: true
    },
    {
      id: 'url',
      hint: 'Product page → draft',
      label: 'From URL',
      blurb: 'Paste a product page link — Claude reads it into a draft.',
      icon: Globe,
      aiRequired: true
    },
    {
      id: 'manual',
      hint: 'Full form · no key needed',
      label: 'Type it in',
      blurb: 'Fill the fields by hand. Works offline, no key needed.',
      icon: Pencil,
      aiRequired: false
    }
  ];

  // Sprayer + crop aren't scan/search targets — render the bare form.
  const lotBearing = $derived(type === 'pesticide' || type === 'fertility' || type === 'seed');

  // #312 / CT-S3-002 — all five chips always render. AI-required chips
  // are reachable with no key so their panels can surface the built-in
  // no-key recovery empty-state (Invariant 7 — "AI assists, never
  // gates"). Filtering them out hid the recovery UI and left an
  // unexplained 3-of-5 chip row.
  const visibleMethods = METHODS;

  type Phase = 'pick' | 'approve';
  let phase = $state<Phase>('pick');
  let method = $state<AddMethod>('search');
  let draft = $state<StockEntryDraft | null>(null);
  let busy = $state(false);

  const batch = new LabelBatch();
  let reviewingRowId = $state<string | null>(null);
  let batchNotice = $state<string | null>(null);
  const batchActive = $derived(batch.rows.length > 0);

  const tabRefs: Record<string, HTMLButtonElement | undefined> = {};

  function onTabKeydown(e: KeyboardEvent, index: number): void {
    const last = visibleMethods.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    tabRefs[visibleMethods[next].id]?.focus();
  }

  function selectMethod(m: AddMethod): void {
    batchNotice = null;
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
    reviewingRowId = null;
    phase = 'pick';
  }

  function startBatch(files: File[]): void {
    batchNotice = null;
    batch.add(files);
    void batch.run();
  }

  function reviewBatchRow(row: BatchRow): void {
    if (!row.draft) return;
    batchNotice = null;
    reviewingRowId = row.id;
    draft = row.draft;
    phase = 'approve';
  }

  function onBatchRowSaved(): void {
    const id = reviewingRowId;
    if (id) batch.markSaved(id);
    const name = draft?.displayName;
    const left = batch.counts.done;
    batchNotice = `Saved${name ? ` ${name}` : ''}.${left ? ` ${left} draft${left === 1 ? '' : 's'} left to review.` : ''}`;
    method = 'label';
    backToMethods();
  }
</script>

{#if !lotBearing}
  <A_InventoryEditForm {type} />
{:else if phase === 'approve'}
  <button type="button" class="back-link" onclick={backToMethods}>
    {reviewingRowId ? '← Back to batch queue' : '← Choose a different method'}
  </button>
  {#if reviewingRowId}
    {#key reviewingRowId}
      <A_InventoryEditForm
        {type}
        prefill={draft ?? undefined}
        onSaved={onBatchRowSaved}
        onCancel={backToMethods}
      />
    {/key}
  {:else}
    <A_InventoryEditForm {type} prefill={draft ?? undefined} />
  {/if}
{:else}
  <header class="flow-header">
    <span class="kicker">Add · {type}</span>
    <h1 class="serif">New {type}</h1>
    <p class="lede">
      Pick how you want to add it — scan, search, or type it in. You'll review every field before
      saving.
    </p>
  </header>

  <div class="method-grid" role="tablist" aria-label="Add method">
    {#each visibleMethods as m, i (m.id)}
      {@const Icon = m.icon}
      {@const on = method === m.id}
      <button
        bind:this={tabRefs[m.id]}
        type="button"
        role="tab"
        id="add-method-{m.id}"
        aria-selected={on}
        aria-controls="add-method-panel"
        tabindex={on ? 0 : -1}
        class="method-card"
        class:active={on}
        onclick={() => selectMethod(m.id)}
        onkeydown={(e) => onTabKeydown(e, i)}
      >
        <span class="card-top">
          <span class="card-icon" aria-hidden="true"><Icon size={16} strokeWidth={1.9} /></span>
          <span class="card-label">{m.label}</span>
        </span>
        <span class="card-hint">{m.hint}</span>
      </button>
    {/each}
  </div>

  {#if !canSave}
    <p class="ai-note" role="note" data-testid="helper-note">
      You're signed in as a helper — you can look products up here, but only the farm owner can save
      new inventory.
    </p>
  {/if}

  {#if !aiEnabled}
    <p class="ai-note">
      Scan label and From URL need a Claude API key to read the draft —
      <a href="/settings/ai" target="_blank" rel="noopener">add one in Settings</a>, or use Search,
      Scan barcode, or Type it in without a key.
    </p>
  {/if}

  <div
    class="panel"
    role="tabpanel"
    id="add-method-panel"
    aria-labelledby="add-method-{method}"
    tabindex="-1"
  >
    {#key method}
      {#if method === 'search'}
        <SearchPanel {type} {aiEnabled} {busy} onSubmit={onPanelDraft} />
      {:else if method === 'barcode'}
        <BarcodePanel {type} {busy} onSubmit={onPanelDraft} />
      {:else if method === 'label'}
        {#if batchActive}
          <LabelBatchQueue
            {batch}
            notice={batchNotice}
            onReview={reviewBatchRow}
            onSwitchToManual={() => selectMethod('manual')}
          />
        {:else}
          <LabelOcrPanel
            {busy}
            {aiEnabled}
            onSubmit={onPanelDraft}
            onBatch={canSave ? startBatch : undefined}
            onSwitchToManual={() => selectMethod('manual')}
          />
        {/if}
      {:else if method === 'url'}
        <UrlPanel
          {type}
          {busy}
          {aiEnabled}
          onSubmit={onPanelDraft}
          onSwitchToManual={() => selectMethod('manual')}
        />
      {/if}
    {/key}
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
  .method-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 14px;
  }
  .method-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    min-height: 72px;
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid var(--color-divider, #e5e7e0);
    background: transparent;
    border-radius: 10px;
    color: var(--color-ink-soft, #4a4f43);
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }
  .method-card:hover {
    border-color: var(--color-forest, #1f5e3a);
  }
  .method-card:focus-visible {
    outline: 2px solid var(--color-forest, #1f5e3a);
    outline-offset: 2px;
  }
  .method-card.active {
    background: var(--color-paper, #fff);
    border: 1.5px solid var(--color-forest, #1f5e3a);
    box-shadow: 0 1px 0 rgba(44, 82, 55, 0.08);
  }
  .card-top {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-width: 0;
  }
  .card-icon {
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 7px;
    display: grid;
    place-items: center;
    background: var(--color-divider-soft, #eef0ea);
    color: var(--color-ink-soft, #4a4f43);
  }
  .method-card.active .card-icon {
    background: var(--color-forest, #1f5e3a);
    color: var(--color-cream, #fff8e1);
  }
  .card-label {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.005em;
  }
  .method-card.active .card-label {
    color: var(--color-forest-deep, #1f3522);
  }
  .card-hint {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 11.5px;
    color: var(--color-ink-muted, #6a6f63);
  }
  @media (max-width: 900px) {
    .method-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (max-width: 560px) {
    .method-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .method-card {
      padding: 12px;
    }
    .method-card:last-child {
      grid-column: 1 / -1;
    }
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
    min-height: 48px;
    margin-bottom: 4px;
  }
  .back-link:hover {
    text-decoration: underline;
  }
</style>
