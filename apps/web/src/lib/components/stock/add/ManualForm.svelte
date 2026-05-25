<script lang="ts">
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { normalizeStockEntry, type StockEntryDraft } from '$lib/stock/normalizeStockEntry';
  import { ALL_STOCK_UNITS, type StockUnit } from '$lib/stock/units';
  import type { StockCategory } from '$lib/db/stock';

  /**
   * Phase 25d (#89) — Method 1 of the 5-method add waterfall.
   *
   * Pure-manual entry. No AI, no scans, no network reach beyond the
   * POST /api/stock submit. Per the v2 provenance addendum every
   * surfaced field carries `<Provenance source="manual" />` because the
   * operator typed all of it (this is the canonical no-AI path).
   */

  interface Props {
    /** Notified when the operator submits a successfully-normalized
     *  draft. Parent owns the POST + downstream navigation. */
    onSubmit: (draft: StockEntryDraft) => void | Promise<void>;
    /** Parent may opt in to its own busy state (e.g., disabling other
     *  tabs during submit). */
    busy?: boolean;
  }

  const { onSubmit, busy = false }: Props = $props();

  const CATEGORIES: StockCategory[] = [
    'herbicide',
    'insecticide',
    'fungicide',
    'fertilizer',
    'seed',
    'adjuvant',
    'fuel',
    'part'
  ];

  let category = $state<StockCategory | ''>('');
  let displayName = $state('');
  let shortName = $state('');
  let defaultUnit = $state<StockUnit | ''>('');
  let reorderThreshold = $state<number | ''>('');
  let notes = $state('');
  let barcode = $state('');
  let submitError = $state<string | null>(null);
  let issues = $state<Array<{ field: string; message: string }>>([]);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    submitError = null;
    issues = [];
    const draft: StockEntryDraft = {
      source: 'manual',
      category: category || undefined,
      displayName,
      shortName: shortName || undefined,
      defaultUnit: defaultUnit || undefined,
      reorderThreshold: typeof reorderThreshold === 'number' ? reorderThreshold : undefined,
      notes: notes || undefined,
      barcode: barcode || undefined
    };
    const r = normalizeStockEntry(draft);
    if (!r.ok) {
      issues = r.issues.map((i) => ({ field: i.field, message: i.message }));
      return;
    }
    try {
      await onSubmit(draft);
    } catch (err) {
      submitError = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<form class="manual-form" onsubmit={handleSubmit}>
  <p class="lede">
    Type the basics. Stock will appear in your inventory immediately. You can refine ingredient
    blocks + lot numbers from the item page after adding.
  </p>

  <div class="row">
    <label for="manual-category">
      Category
      <Provenance source="manual" compact />
    </label>
    <select id="manual-category" bind:value={category} required disabled={busy}>
      <option value="" disabled>Pick a category…</option>
      {#each CATEGORIES as c (c)}
        <option value={c}>{c}</option>
      {/each}
    </select>
  </div>

  <div class="row">
    <label for="manual-name">
      Display name
      <Provenance source="manual" compact />
    </label>
    <input
      id="manual-name"
      type="text"
      bind:value={displayName}
      maxlength="120"
      required
      disabled={busy}
      placeholder="e.g., Calcium Nitrate 15.5-0-0"
    />
  </div>

  <div class="row">
    <label for="manual-shortname">
      Short label (optional)
      <Provenance source="manual" compact />
    </label>
    <input
      id="manual-shortname"
      type="text"
      bind:value={shortName}
      maxlength="40"
      disabled={busy}
      placeholder="≤40 chars — shown on tight UI"
    />
  </div>

  <div class="row two-up">
    <div>
      <label for="manual-unit">
        Default unit
        <Provenance source="manual" compact />
      </label>
      <select id="manual-unit" bind:value={defaultUnit} required disabled={busy}>
        <option value="" disabled>Pick a unit…</option>
        {#each ALL_STOCK_UNITS as u (u)}
          <option value={u}>{u}</option>
        {/each}
      </select>
    </div>
    <div>
      <label for="manual-reorder">
        Reorder at (optional)
        <Provenance source="manual" compact />
      </label>
      <input
        id="manual-reorder"
        type="number"
        min="0"
        step="0.01"
        bind:value={reorderThreshold}
        disabled={busy}
        placeholder="0"
      />
    </div>
  </div>

  <div class="row">
    <label for="manual-barcode">
      Barcode (optional)
      <Provenance source="manual" compact />
    </label>
    <input
      id="manual-barcode"
      type="text"
      bind:value={barcode}
      maxlength="100"
      disabled={busy}
      placeholder="UPC / EAN — improves future scan matches"
    />
  </div>

  <div class="row">
    <label for="manual-notes">
      Notes (optional)
      <Provenance source="manual" compact />
    </label>
    <textarea
      id="manual-notes"
      bind:value={notes}
      maxlength="500"
      rows="3"
      disabled={busy}
      placeholder="REI hours, label PHI, supplier, etc."
    ></textarea>
  </div>

  {#if issues.length > 0}
    <ul class="issues" aria-live="polite">
      {#each issues as iss (iss.field)}
        <li>
          <strong>{iss.field}:</strong>
          {iss.message}
        </li>
      {/each}
    </ul>
  {/if}
  {#if submitError}
    <p class="submit-err" aria-live="polite">{submitError}</p>
  {/if}

  <div class="actions">
    <button type="submit" class="primary" disabled={busy}>
      {busy ? 'Adding…' : 'Add to inventory'}
    </button>
  </div>
</form>

<style>
  .manual-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .lede {
    font-size: 13px;
    color: var(--color-ink-soft);
    line-height: 1.45;
    margin: 0 0 4px;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row.two-up {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  label {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--color-ink);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  input,
  select,
  textarea {
    font-family: inherit;
    font-size: 14px;
    padding: 9px 12px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    color: var(--color-ink);
    min-height: 40px;
  }
  textarea {
    resize: vertical;
    min-height: 64px;
  }
  input:focus,
  select:focus,
  textarea:focus {
    outline: 2px solid var(--color-forest-deep);
    outline-offset: 1px;
    border-color: var(--color-forest-deep);
  }
  .issues {
    list-style: none;
    margin: 0;
    padding: 8px 12px;
    background: rgba(186, 75, 56, 0.06);
    border-left: 3px solid var(--color-rust, #ba4b38);
    border-radius: 4px;
    font-size: 12.5px;
    color: var(--color-rust, #ba4b38);
  }
  .issues li {
    line-height: 1.4;
  }
  .submit-err {
    margin: 0;
    color: var(--color-rust, #ba4b38);
    font-size: 13px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 6px;
  }
  .primary {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: 0;
    padding: 11px 22px;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    min-height: 42px;
  }
  .primary:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  @media (max-width: 600px) {
    .row.two-up {
      grid-template-columns: 1fr;
    }
  }
</style>
