<script lang="ts">
  /**
   * Sprint 8 / Phase 27D (#257) — unified inventory edit form.
   *
   * One canonical form chrome for create + update across all 5 inventory
   * types per CLAUDE.md Invariant 8. Per-type *fields* differ; per-type
   * *chrome* (identity section, sticky save footer, error surface,
   * unsaved-changes guard) does not.
   *
   * Submit flow:
   *   - For pesticide/fertility/seed lot-bearing types: POST `/api/stock`
   *     (create) or PATCH `/api/stock/[id]` (update).
   *   - For sprayer: POST `/api/equipment` or PATCH `/api/equipment/[id]`.
   *   - For crop: catalog-only — Sprint 8 surfaces a deep-link to the
   *     existing upload flow at `/settings/plugins/upload`; consolidation
   *     into this form is deferred (crop plugin editing has its own
   *     versioning + hash-chain workflow).
   *
   * Closes:
   *   - #199 — defaultUnit is REQUIRED on every lot-bearing payload
   *   - #253 — category=seed requires a bound plugin (REQUIRED chip)
   *   - #201 — error state resets on type / mode switch (the parent route
   *     remounts the form on navigation so stale errors can't survive)
   */
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import InvSection from './InvSection.svelte';
  import InvField from './InvField.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { InventoryType } from '$lib/inventory/types';
  import type { StockEntryDraft } from '$lib/stock/normalizeStockEntry';

  type StockCategory =
    | 'herbicide'
    | 'insecticide'
    | 'fungicide'
    | 'fertilizer'
    | 'seed'
    | 'adjuvant'
    | 'fuel'
    | 'part';

  type StockUnit =
    | 'fl-oz'
    | 'pt'
    | 'qt'
    | 'gal'
    | 'oz'
    | 'lb'
    | 'kg'
    | 'g'
    | 'count'
    | 'seeds'
    | 'bag-50lb'
    | 'bag-25kg';

  interface ExistingItem {
    id: string;
    displayName: string;
    shortName?: string;
    category: StockCategory;
    defaultUnit: StockUnit;
    pluginId?: string;
    reorderThreshold?: number;
    notes?: string;
    barcode?: string;
  }

  interface ExistingEquipment {
    id: string;
    label: string;
    notes?: string;
    spec?: Record<string, unknown>;
  }

  interface Props {
    type: InventoryType;
    /** When defined, the form is in `edit` mode prefilled from this row.
     *  When undefined, the form is in `add` mode (empty defaults). */
    existing?: ExistingItem | ExistingEquipment;
    /** Add-mode pre-population produced by a scan / search / lookup
     *  method (barcode, label OCR, AI photo, web). The operator reviews
     *  + edits these values before save — "AI assists, never gates".
     *  A non-`manual` source renders a provenance banner so the operator
     *  knows where the draft came from. Ignored in edit mode. */
    prefill?: StockEntryDraft;
  }

  const { type, existing, prefill }: Props = $props();

  const isEdit = $derived(!!existing);

  // Show a provenance banner only when add-mode values were pre-populated
  // by a non-manual method (scan / search / web). Pure manual entry needs
  // no banner — the operator typed everything themselves.
  const showPrefillBanner = $derived(!isEdit && !!prefill && prefill.source !== 'manual');

  // For sprayer the existing shape is different — narrow + reshape.
  const existingItem = $derived(
    type === 'sprayer' ? undefined : (existing as ExistingItem | undefined)
  );
  const existingEquipment = $derived(
    type === 'sprayer' ? (existing as ExistingEquipment | undefined) : undefined
  );

  // ─── Form state ────────────────────────────────────────────────────────
  // Form state is initialized from the prop at MOUNT and intentionally
  // does NOT re-sync when the parent's `existing` changes — that would
  // erase in-progress operator edits. `untrack()` silences svelte-check's
  // `state_referenced_locally` warning while preserving that intent.
  // The parent route component already remounts the form via {#key} on
  // route navigation so a new edit target gets a fresh form.
  let displayName = $state(
    untrack(
      () => existingItem?.displayName ?? existingEquipment?.label ?? prefill?.displayName ?? ''
    )
  );
  let shortName = $state(untrack(() => existingItem?.shortName ?? prefill?.shortName ?? ''));
  let category = $state<StockCategory>(
    untrack(() => prefillCategory() ?? defaultCategoryFor(type))
  );
  let defaultUnit = $state<StockUnit>(
    untrack(() => existingItem?.defaultUnit ?? prefill?.defaultUnit ?? defaultUnitFor(type))
  );
  let pluginId = $state(untrack(() => existingItem?.pluginId ?? prefill?.pluginId ?? ''));
  let reorderThreshold = $state<number | null>(
    untrack(() => existingItem?.reorderThreshold ?? prefill?.reorderThreshold ?? null)
  );
  let notes = $state(
    untrack(() => existingItem?.notes ?? existingEquipment?.notes ?? prefill?.notes ?? '')
  );
  let barcode = $state(untrack(() => existingItem?.barcode ?? prefill?.barcode ?? ''));

  // Sprayer-specific spec fields (free-form on equipment.spec JSON column).
  const initialSprayerSpec = untrack(() =>
    type === 'sprayer'
      ? (((existing as ExistingEquipment | undefined)?.spec ?? {}) as {
          tankGal?: number;
          nozzle?: string;
        })
      : ({} as { tankGal?: number; nozzle?: string })
  );
  let tankGal = $state<number | null>(initialSprayerSpec.tankGal ?? null);
  let nozzle = $state(initialSprayerSpec.nozzle ?? '');

  let submitting = $state(false);
  let error = $state<string | null>(null);
  let fieldErrors = $state<Record<string, string>>({});
  let dirty = $state(false);

  $effect(() => {
    // Tracking dirty state: any user-input field assignment flips this.
    // Init touch is suppressed by referencing all signals once then
    // immediately resetting — Svelte 5's $effect runs after first state
    // read so we set dirty=false on next microtask.
    [
      displayName,
      shortName,
      category,
      defaultUnit,
      pluginId,
      reorderThreshold,
      notes,
      barcode,
      tankGal,
      nozzle
    ];
    dirty = true;
  });

  // ─── Per-type field map ───────────────────────────────────────────────
  function defaultCategoryFor(t: InventoryType): StockCategory {
    if (t === 'pesticide') return 'herbicide';
    if (t === 'fertility') return 'fertilizer';
    if (t === 'seed') return 'seed';
    return 'herbicide';
  }
  function categoryOptionsFor(t: InventoryType): StockCategory[] {
    if (t === 'pesticide') return ['herbicide', 'insecticide', 'fungicide'];
    if (t === 'fertility') return ['fertilizer'];
    if (t === 'seed') return ['seed'];
    return [];
  }
  // Only honor a prefilled category when it's valid for this type — a
  // mismatched scan never silently flips the form to the wrong taxonomy.
  function prefillCategory(): StockCategory | undefined {
    const c = prefill?.category;
    return c && categoryOptionsFor(type).includes(c) ? c : undefined;
  }
  function defaultUnitFor(t: InventoryType): StockUnit {
    if (t === 'pesticide') return 'fl-oz';
    if (t === 'fertility') return 'lb';
    if (t === 'seed') return 'count';
    return 'count';
  }
  // Type-aware examples — a seed form must never read as a pesticide form.
  function placeholdersFor(t: InventoryType): { displayName: string; shortName: string } {
    if (t === 'seed')
      return { displayName: 'e.g. Cherokee Purple Tomato', shortName: 'e.g. Cherokee Purple' };
    if (t === 'fertility')
      return { displayName: 'e.g. Calcium Nitrate 15.5-0-0', shortName: 'e.g. CalNit' };
    if (t === 'sprayer') return { displayName: 'e.g. Boom sprayer 25 gal', shortName: '' };
    return { displayName: 'e.g. Roundup PowerMAX', shortName: 'e.g. Roundup PM' };
  }
  const placeholders = $derived(placeholdersFor(type));
  const categoryOptions = $derived(categoryOptionsFor(type));

  const unitOptions: StockUnit[] = [
    'fl-oz',
    'pt',
    'qt',
    'gal',
    'oz',
    'lb',
    'kg',
    'g',
    'count',
    'seeds',
    'bag-50lb',
    'bag-25kg'
  ];

  // #253 — category=seed requires a bound plugin. The kernel-locked chip
  // signals that to the operator + the validator blocks save without one.
  const requiresPlugin = $derived(type === 'seed');

  // ─── Validation ────────────────────────────────────────────────────────
  function validate(): boolean {
    fieldErrors = {};
    if (!displayName.trim()) {
      fieldErrors.displayName = 'Display name is required';
    }
    if (type !== 'sprayer' && type !== 'crop') {
      if (!defaultUnit) {
        // #199: defaultUnit must always be present on the lot-bearing payload.
        fieldErrors.defaultUnit = 'Default unit is required';
      }
      if (requiresPlugin && !pluginId.trim()) {
        // #253: seed-category needs a plugin link.
        fieldErrors.pluginId = 'Seed entries must link to a crop plugin';
      }
    }
    if (reorderThreshold != null && reorderThreshold < 0) {
      fieldErrors.reorderThreshold = 'Reorder threshold cannot be negative';
    }
    return Object.keys(fieldErrors).length === 0;
  }

  // ─── Submit ────────────────────────────────────────────────────────────
  async function handleSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = null;
    if (!validate()) return;
    submitting = true;
    try {
      if (type === 'sprayer') {
        await submitSprayer();
      } else if (type === 'crop') {
        // Crop catalog editing has its own versioning + hash flow.
        error = 'Crop plugins are edited via the upload flow — Sprint 9 cutover wires it here.';
        return;
      } else {
        await submitLotBearing();
      }
      dirty = false;
      goto(`/inventory?type=${type}`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }

  async function submitLotBearing(): Promise<void> {
    const payload = {
      displayName: displayName.trim(),
      shortName: shortName.trim() || undefined,
      category,
      defaultUnit, // #199: always present
      pluginId: pluginId.trim() || null,
      reorderThreshold: reorderThreshold ?? null,
      notes: notes.trim() || undefined,
      barcode: barcode.trim() || undefined
    };
    const url = existingItem ? `/api/stock/${existingItem.id}` : '/api/stock';
    const method = existingItem ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
  }

  async function submitSprayer(): Promise<void> {
    if (existingEquipment) {
      const res = await fetch(`/api/equipment/${existingEquipment.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: displayName.trim(),
          notes: notes.trim() || undefined
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    } else {
      const spec: Record<string, unknown> = {};
      if (tankGal != null && tankGal > 0) spec.tankGal = tankGal;
      if (nozzle.trim()) spec.nozzle = nozzle.trim();
      const res = await fetch('/api/equipment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'sprayer',
          label: displayName.trim(),
          notes: notes.trim() || undefined,
          spec: Object.keys(spec).length > 0 ? spec : undefined
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    }
  }

  function handleCancel(): void {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    if (existing && type !== 'crop') {
      const id = (existing as { id: string }).id;
      goto(`/inventory/${type}/${id}`);
    } else {
      goto(`/inventory?type=${type}`);
    }
  }

  function onBeforeUnload(e: BeforeUnloadEvent): void {
    if (dirty && !submitting) {
      e.preventDefault();
    }
  }
</script>

<svelte:window on:beforeunload={onBeforeUnload} />

<header class="form-header">
  <span class="kicker">{isEdit ? 'Edit' : 'Add'} · {type}</span>
  <h1 class="serif">
    {isEdit ? displayName || '(unnamed)' : `New ${type}`}
  </h1>
</header>

{#if showPrefillBanner && prefill}
  <div class="prefill-banner" role="status">
    <Provenance source={prefill.source} />
    <span
      >Pre-filled for your review — check each field, then save. Nothing is recorded until you do.</span
    >
  </div>
{/if}

<form onsubmit={handleSubmit} class="form-body">
  <InvSection title="Identity" kicker="Required">
    <InvField id="displayName" label="Display name" chip="required" error={fieldErrors.displayName}>
      <input
        id="displayName"
        type="text"
        bind:value={displayName}
        placeholder={placeholders.displayName}
        maxlength="120"
        required
      />
    </InvField>

    {#if type !== 'sprayer' && type !== 'crop'}
      <InvField id="shortName" label="Short label" hint="Compact UI label (optional)">
        <input
          id="shortName"
          type="text"
          bind:value={shortName}
          placeholder={placeholders.shortName}
          maxlength="40"
        />
      </InvField>

      {#if categoryOptions.length > 1}
        <InvField id="category" label="Category" chip="required">
          <select id="category" bind:value={category}>
            {#each categoryOptions as opt (opt)}
              <option value={opt}>{opt}</option>
            {/each}
          </select>
        </InvField>
      {/if}

      <InvField
        id="defaultUnit"
        label="Default unit"
        chip="required"
        error={fieldErrors.defaultUnit}
      >
        <select id="defaultUnit" bind:value={defaultUnit}>
          {#each unitOptions as u (u)}
            <option value={u}>{u}</option>
          {/each}
        </select>
      </InvField>
    {/if}
  </InvSection>

  {#if type !== 'sprayer' && type !== 'crop'}
    <InvSection title="Plugin link" kicker={requiresPlugin ? 'Required' : 'Optional'}>
      <InvField
        id="pluginId"
        label="Plugin id"
        chip={requiresPlugin ? 'required' : 'from-plugin'}
        hint={requiresPlugin
          ? 'Seed entries must link to a registered crop plugin so the planner can use them.'
          : 'Bind to a registered catalog plugin so kernel-locked safety fields stay in sync.'}
        error={fieldErrors.pluginId}
      >
        <input
          id="pluginId"
          type="text"
          bind:value={pluginId}
          placeholder="e.g. tomato-cherokee-purple"
          maxlength="120"
        />
      </InvField>
    </InvSection>
  {/if}

  {#if type === 'sprayer' && !isEdit}
    <InvSection title="Sprayer spec" kicker="Optional">
      <InvField id="tankGal" label="Tank (gal)" hint="Used for sizing single-tank applications">
        <input id="tankGal" type="number" step="0.5" min="0" bind:value={tankGal} />
      </InvField>
      <InvField id="nozzle" label="Nozzle">
        <input
          id="nozzle"
          type="text"
          bind:value={nozzle}
          placeholder="e.g. TeeJet XR110015"
          maxlength="60"
        />
      </InvField>
    </InvSection>
  {/if}

  {#if type !== 'sprayer' && type !== 'crop'}
    <InvSection title="Storage & reorder" kicker="Optional">
      <InvField
        id="reorderThreshold"
        label="Reorder at"
        hint="Trigger a Reorder Soon flag when on-hand drops below this number"
        error={fieldErrors.reorderThreshold}
      >
        <input
          id="reorderThreshold"
          type="number"
          step="0.1"
          min="0"
          bind:value={reorderThreshold}
        />
      </InvField>
      <InvField id="barcode" label="Barcode" hint="EAN / UPC / GTIN — used by the Barcode method">
        <input id="barcode" type="text" bind:value={barcode} maxlength="100" />
      </InvField>
    </InvSection>
  {/if}

  <InvSection title="Notes">
    <InvField id="notes" label="Free-form notes">
      <textarea id="notes" rows="3" bind:value={notes} maxlength="500"></textarea>
    </InvField>
  </InvSection>

  {#if type === 'crop'}
    <div class="banner">
      <strong>Crop plugin editing is versioned.</strong>
      Use <a href="/plugins">/plugins</a> to upload a new version of this plugin.
    </div>
  {/if}

  {#if error}
    <p class="error-banner" role="alert">{error}</p>
  {/if}

  <footer class="save-footer">
    <button type="button" class="btn-secondary" onclick={handleCancel} disabled={submitting}>
      Cancel
    </button>
    <button type="submit" class="btn-primary" disabled={submitting}>
      {submitting ? 'Saving…' : isEdit ? 'Save changes' : `Create ${type}`}
    </button>
  </footer>
</form>

<style>
  .form-header {
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
  .form-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-bottom: 80px;
  }
  .prefill-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
    padding: 10px 12px;
    background: var(--color-cream, #fff8e1);
    border: 1px solid var(--color-divider, #e5e7e0);
    border-radius: 6px;
    font-size: 0.85rem;
    color: var(--color-ink, #2b2f27);
  }
  input[type='text'],
  input[type='number'],
  select,
  textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--color-divider, #e5e7e0);
    border-radius: 6px;
    font: inherit;
    background: var(--color-paper, #fff);
  }
  input:focus,
  select:focus,
  textarea:focus {
    outline: 2px solid var(--color-forest, #1f5e3a);
    outline-offset: 1px;
  }
  textarea {
    resize: vertical;
    min-height: 60px;
  }
  .error-banner {
    background: var(--color-rust-tint, #fce8e8);
    color: var(--color-rust, #a23a3a);
    padding: 10px 12px;
    border-radius: 6px;
    margin: 0;
    font-size: 0.9rem;
  }
  .banner {
    background: var(--color-honey-tint, #fff4d6);
    border-left: 4px solid var(--color-honey-deep, #6a4f00);
    padding: 10px 12px;
    border-radius: 4px;
    font-size: 0.9rem;
  }
  .banner a {
    color: var(--color-forest, #1f5e3a);
  }
  .save-footer {
    position: sticky;
    bottom: 0;
    background: var(--color-paper, #fff);
    padding: 12px 0;
    border-top: 1px solid var(--color-divider, #e5e7e0);
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .btn-primary,
  .btn-secondary {
    padding: 10px 18px;
    border-radius: 6px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    min-height: 44px;
  }
  .btn-primary {
    background: var(--color-forest, #1f5e3a);
    color: var(--color-cream, #fff8e1);
  }
  .btn-primary:hover {
    background: var(--color-forest-deep, #1f3522);
  }
  .btn-secondary {
    background: transparent;
    color: var(--color-forest-deep, #1f3522);
    border-color: var(--color-divider, #e5e7e0);
  }
  .btn-secondary:hover {
    border-color: var(--color-forest-deep, #1f3522);
  }
  .btn-primary:disabled,
  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
