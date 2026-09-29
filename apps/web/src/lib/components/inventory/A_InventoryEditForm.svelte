<script lang="ts">
  /**
   * Sprint 8 / Phase 27D (#257) — unified inventory edit form.
   *
   * One canonical form chrome for create + update across the inventory
   * types per CLAUDE.md Invariant 8. Per-type *fields* differ; per-type
   * *chrome* (identity section, sticky save footer, error surface,
   * unsaved-changes guard) does not. Sprayers are equipment and are
   * edited on /equipment (#474).
   *
   * Submit flow for pesticide / fertility / seed: POST `/api/stock` then,
   * when a quantity was entered, POST `/api/stock/[id]/lots` for the first
   * lot (received today); on edit, PATCH `/api/stock/[id]` then, when the
   * on-hand quantity changed, POST `/api/stock/[id]/set-quantity` so the
   * change is an adjustment in the stock history (#473). Crop categories
   * are catalog only and are versioned through /plugins.
   *
   * Closes:
   *   - #199 — defaultUnit is REQUIRED on every lot-bearing payload
   *   - #253 — category=seed requires a linked crop category
   *   - #472 — the link is a type-ahead picker; seeds auto-match a category
   *   - #473 — quantity on add and edit; seeds count in Seeds by default
   */
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import InvSection from './InvSection.svelte';
  import InvField from './InvField.svelte';
  import LibraryPicker from './LibraryPicker.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { InventoryType } from '$lib/inventory/types';
  import type { StockEntryDraft } from '$lib/stock/normalizeStockEntry';
  import {
    confidentLibraryMatch,
    rankLibraryMatches,
    type LibraryOption
  } from '$lib/plugins/libraryMatch';
  import {
    ALL_STOCK_UNITS,
    SEED_UNITS,
    formatStockQuantity,
    stockUnitLabel,
    type StockUnit
  } from '$lib/stock/units';
  import { QUANTITY_STATUS_LABELS, type QuantityStatus } from '$lib/stock/quantityStatus';
  import {
    ANIMAL_HEALTH_UNITS,
    FEED_UNITS,
    MEDICATED_FEED_MESSAGE,
    animalHealthMeta,
    feedMeta,
    formatNada,
    normalizeNada,
    withMetaSection
  } from '$lib/stock/animalStock';
  import type { StockCategory } from '$lib/db/stock';

  type LinkSource = 'plugin' | 'data' | 'ai' | 'manual' | 'fallback';

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
    /** Feed bag size and scoop, a medicine's NADA number (Phase 32D). */
    metadataJson?: string;
    /** Current on-hand balance across lots, in `defaultUnit`. */
    onHand?: number;
    /** Expected quantity on ordered and planned lots (#475). */
    onOrder?: number;
    planned?: number;
    lotCount?: number;
  }

  interface Props {
    type: InventoryType;
    /** When defined, the form is in `edit` mode prefilled from this row.
     *  When undefined, the form is in `add` mode (empty defaults). */
    existing?: ExistingItem;
    /** Add-mode pre-population produced by a scan / search / lookup
     *  method (barcode, label OCR, AI photo, web). The operator reviews
     *  + edits these values before save — "AI assists, never gates".
     *  A non-`manual` source renders a provenance banner so the operator
     *  knows where the draft came from. Ignored in edit mode. */
    prefill?: StockEntryDraft;
    /** Library entries this item can link to: crop categories for seed,
     *  product labels for pesticide and fertility. */
    library?: ReadonlyArray<LibraryOption>;
    /** Replaces the post-save navigation — the batch label queue (#249)
     *  saves one reviewed draft, then returns to the queue. */
    onSaved?: (saved: { id: string | null }) => void;
    onCancel?: () => void;
  }

  const { type, existing, prefill, library = [], onSaved, onCancel }: Props = $props();

  const isEdit = $derived(!!existing);
  const isSeed = $derived(type === 'seed');
  const lotBearing = $derived(type !== 'crop');
  const isFeed = $derived(type === 'feed');
  const isMed = $derived(type === 'animal-health');

  const showPrefillBanner = $derived(!isEdit && !!prefill && prefill.source !== 'manual');

  // Form state is initialized from the props at MOUNT and intentionally
  // does NOT re-sync when the parent's `existing` changes — that would
  // erase in-progress operator edits. The parent route remounts the form
  // via {#key} on navigation so a new edit target gets a fresh form.
  let displayName = $state(untrack(() => existing?.displayName ?? prefill?.displayName ?? ''));
  let shortName = $state(untrack(() => existing?.shortName ?? prefill?.shortName ?? ''));
  let category = $state<StockCategory>(
    untrack(() => existing?.category ?? prefillCategory() ?? defaultCategoryFor(type))
  );
  let defaultUnit = $state<StockUnit>(untrack(() => initialUnit()));
  // A medicine's library link drives its withdrawal, so a draft from any
  // entry method never sets it; the owner picks or confirms it (D0-15).
  let pluginId = $state(
    untrack(() => existing?.pluginId ?? (type === 'animal-health' ? '' : prefill?.pluginId) ?? '')
  );
  // An edit does not know whether the saved link was matched or picked, so
  // it reads as the saved library entry (`plugin`), never as `manual`.
  let pluginSource = $state<LinkSource>(
    untrack(() =>
      existing
        ? existing.pluginId
          ? 'plugin'
          : 'manual'
        : prefill?.pluginId && type !== 'animal-health'
          ? 'data'
          : 'manual'
    )
  );

  // Phase 32D: feed bag size and scoop (D0-13), the medicated refusal
  // (D0-14) and a medicine's NADA number (D0-15).
  const initialFeed = untrack(() => feedMeta(existing?.metadataJson));
  let lbPerBag = $state<number | null>(initialFeed.lbPerBag ?? null);
  let scoopLb = $state<number | null>(initialFeed.scoopLb ?? null);
  let medicated = $state(false);
  const initialNada = untrack(() => {
    const saved = animalHealthMeta(existing?.metadataJson).nada;
    if (saved) return { text: formatNada(saved), source: saved.provenance };
    if (prefill?.nada) {
      return { text: formatNada(prefill.nada), source: prefill.source === 'ai' ? 'ai' : 'manual' };
    }
    return { text: '', source: 'manual' as const };
  });
  let nadaText = $state(initialNada.text);
  const nadaSource = $derived<'ai' | 'manual'>(
    nadaText === initialNada.text && initialNada.source === 'ai' ? 'ai' : 'manual'
  );
  const suggestedLink = $derived(
    !isEdit && isMed && !pluginId ? (prefill?.suggestedHealthPlugin ?? null) : null
  );
  function confirmSuggestedLink(): void {
    if (!suggestedLink) return;
    pluginId = suggestedLink.pluginId;
    pluginSource = 'manual';
  }
  let reorderThreshold = $state<number | null>(
    untrack(() => existing?.reorderThreshold ?? prefill?.reorderThreshold ?? null)
  );
  let notes = $state(untrack(() => existing?.notes ?? prefill?.notes ?? ''));
  let barcode = $state(untrack(() => existing?.barcode ?? prefill?.barcode ?? ''));
  const initialOnHand = untrack(() => existing?.onHand ?? null);
  let quantity = $state<number | null>(
    untrack(() => existing?.onHand ?? prefill?.quantity ?? null)
  );
  let lotNumber = $state('');
  // #475: add mode records the first quantity as on hand, ordered or planned.
  let initialStatus = $state<QuantityStatus>('existing');

  let submitting = $state(false);
  let error = $state<string | null>(null);
  let fieldErrors = $state<Record<string, string>>({});
  let dirty = $state(false);
  /** Set once POST /api/stock succeeded, so a retry after a failed first
   *  lot only posts the lot instead of creating the item twice. */
  let createdId = $state<string | null>(null);

  $effect(() => {
    void [
      displayName,
      shortName,
      category,
      defaultUnit,
      pluginId,
      reorderThreshold,
      notes,
      barcode,
      quantity,
      lotNumber,
      lbPerBag,
      scoopLb,
      nadaText
    ];
    dirty = true;
  });

  // #472: a new seed auto-matches its crop category from the name until
  // the operator picks one themselves, but only when the name clearly means
  // one entry; otherwise the ranked hits are offered as suggestions. The
  // match is tagged `data`.
  let lastMatchedName = untrack(() => (pluginId ? displayName : null));
  const suggestions = $derived(
    isSeed && displayName.trim() ? rankLibraryMatches(displayName, library) : []
  );
  $effect(() => {
    if (!isSeed || isEdit || library.length === 0) return;
    const name = displayName;
    if (name === lastMatchedName) return;
    if (untrack(() => pluginSource) === 'manual' && untrack(() => pluginId)) return;
    lastMatchedName = name;
    const top = confidentLibraryMatch(name, library);
    pluginId = top ? top.id : '';
    pluginSource = top ? 'data' : 'manual';
  });

  // ─── Per-type field map ───────────────────────────────────────────────
  function defaultCategoryFor(t: InventoryType): StockCategory {
    if (t === 'pesticide') return 'herbicide';
    if (t === 'fertility') return 'fertilizer';
    if (t === 'seed') return 'seed';
    if (t === 'feed') return 'feed';
    if (t === 'animal-health') return 'animal-health';
    return 'herbicide';
  }
  function categoryOptionsFor(t: InventoryType): StockCategory[] {
    if (t === 'pesticide') return ['herbicide', 'insecticide', 'fungicide'];
    if (t === 'fertility') return ['fertilizer'];
    if (t === 'seed') return ['seed'];
    if (t === 'feed') return ['feed', 'bedding'];
    if (t === 'animal-health') return ['animal-health'];
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
    if (t === 'feed') return 'bag';
    if (t === 'animal-health') return 'ml';
    return 'seeds';
  }
  // #473: a new seed counts in Seeds; a scan that says "count" means seeds.
  function initialUnit(): StockUnit {
    if (existing) return existing.defaultUnit;
    const u = prefill?.defaultUnit;
    if (type === 'seed') {
      if (u === 'count' || u === 'seeds' || !u) return 'seeds';
      return SEED_UNITS.includes(u) ? u : 'seeds';
    }
    if (type === 'feed' || type === 'animal-health') {
      const allowed = type === 'feed' ? FEED_UNITS : ANIMAL_HEALTH_UNITS;
      return u && allowed.includes(u) ? u : defaultUnitFor(type);
    }
    return u && u !== 'seeds' ? u : defaultUnitFor(type);
  }
  function placeholdersFor(t: InventoryType): { displayName: string; shortName: string } {
    if (t === 'seed')
      return { displayName: 'e.g. Cherokee Purple Tomato', shortName: 'e.g. Cherokee Purple' };
    if (t === 'fertility')
      return { displayName: 'e.g. Calcium Nitrate 15.5-0-0', shortName: 'e.g. CalNit' };
    if (t === 'feed') return { displayName: 'e.g. Layer pellets 16%', shortName: 'e.g. Layer' };
    if (t === 'animal-health')
      return { displayName: 'e.g. the name on the bottle', shortName: 'e.g. Dewormer' };
    return { displayName: 'e.g. Roundup PowerMAX', shortName: 'e.g. Roundup PM' };
  }
  const placeholders = $derived(placeholdersFor(type));
  const categoryOptions = $derived(categoryOptionsFor(type));
  const CATEGORY_LABELS: Partial<Record<StockCategory, string>> = {
    feed: 'Feed',
    bedding: 'Bedding',
    'animal-health': 'Animal health'
  };
  function nounFor(t: InventoryType): string {
    if (t === 'feed') return 'feed or bedding';
    if (t === 'animal-health') return 'medicine';
    return t;
  }

  const unitOptions = $derived.by((): StockUnit[] => {
    const base: StockUnit[] = isSeed
      ? [...SEED_UNITS]
      : isFeed
        ? [...FEED_UNITS]
        : isMed
          ? [...ANIMAL_HEALTH_UNITS]
          : ALL_STOCK_UNITS.filter((u) => u !== 'seeds' && u !== 'bag');
    const current = existing?.defaultUnit;
    if (current && !base.includes(current)) {
      if (isSeed && current === 'count') base.splice(0, 1, 'count');
      else base.unshift(current);
    }
    return base;
  });
  // Stored quantities are in the item's unit; changing the unit once stock
  // is on hand would silently reinterpret every lot.
  const unitLocked = $derived(isEdit && (existing?.lotCount ?? 0) > 0);
  const unitLabel = $derived(stockUnitLabel(defaultUnit, category).toLowerCase());

  // #475 review: an arrived order is received on the item page, never typed
  // into On hand here, or the planner counts the seed twice.
  const expectedNote = $derived.by((): string | null => {
    if (!existing) return null;
    const parts: string[] = [];
    const fmt = (n: number) =>
      formatStockQuantity(n, existing.defaultUnit, undefined, { category, digits: 2 });
    if ((existing.onOrder ?? 0) > 0) parts.push(`${fmt(existing.onOrder ?? 0)} ordered`);
    if ((existing.planned ?? 0) > 0) parts.push(`${fmt(existing.planned ?? 0)} planned`);
    return parts.length ? parts.join(' and ') : null;
  });

  // #253 — seed requires a linked crop category.
  const requiresLink = $derived(isSeed);

  // ─── Validation ────────────────────────────────────────────────────────
  function validate(): boolean {
    fieldErrors = {};
    if (!displayName.trim()) {
      fieldErrors.displayName = 'Display name is required';
    }
    if (lotBearing) {
      if (!defaultUnit) {
        fieldErrors.defaultUnit = 'Pick a unit';
      }
      if (requiresLink && !pluginId.trim()) {
        fieldErrors.pluginId = 'Pick a crop category for this seed so the planner can use it';
      }
      if (quantity != null && (!Number.isFinite(quantity) || quantity < 0)) {
        fieldErrors.quantity = 'On hand cannot be negative';
      }
    }
    if (isFeed) {
      if (medicated) fieldErrors.medicated = MEDICATED_FEED_MESSAGE;
      if (defaultUnit === 'bag' && !(lbPerBag != null && lbPerBag > 0)) {
        fieldErrors.lbPerBag = 'Say how many pounds are in one bag';
      }
      if (scoopLb != null && !(scoopLb > 0)) fieldErrors.scoopLb = 'A scoop must be more than 0 lb';
    }
    if (isMed && nadaText.trim() && !normalizeNada(nadaText)) {
      fieldErrors.nada = 'Type it the way the label prints it, e.g. NADA 141-061';
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
    let savedId: string | null = null;
    try {
      if (type === 'crop') {
        error = 'Crop categories are versioned. Upload a new version in the crop library.';
        return;
      }
      savedId = await submitLotBearing();
      dirty = false;
      if (onSaved) onSaved({ id: savedId });
      else goto(`/inventory?type=${type}`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }

  async function postJson(url: string, method: string, body: unknown): Promise<Response> {
    return fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function metadataFor(): string | undefined {
    if (isFeed) {
      return withMetaSection(existing?.metadataJson, 'feed', {
        lbPerBag: defaultUnit === 'bag' && lbPerBag ? lbPerBag : undefined,
        scoopLb: scoopLb && scoopLb > 0 ? scoopLb : undefined
      });
    }
    if (isMed) {
      const nada = normalizeNada(nadaText);
      return withMetaSection(existing?.metadataJson, 'animalHealth', {
        nada: nada ? { ...nada, provenance: nadaSource } : undefined,
        pluginLink: pluginId.trim() ? 'manual' : undefined
      });
    }
    return undefined;
  }

  // POST /api/stock rejects null (fields are optional); PATCH uses null to clear.
  async function submitLotBearing(): Promise<string | null> {
    const unset = existing ? null : undefined;
    const animalMeta = isFeed || isMed ? metadataFor() : undefined;
    const payload = {
      displayName: displayName.trim(),
      shortName: shortName.trim() || undefined,
      category,
      defaultUnit, // #199: always present
      pluginId: pluginId.trim() || unset,
      reorderThreshold: reorderThreshold ?? unset,
      notes: notes.trim() || undefined,
      barcode: barcode.trim() || undefined,
      ...(isFeed || isMed ? { metadataJson: animalMeta ?? (existing ? '{}' : undefined) } : {})
    };
    if (existing) {
      const res = await postJson(`/api/stock/${existing.id}`, 'PATCH', payload);
      if (!res.ok) throw new Error(await apiError(res));
      if (quantity != null && quantity !== initialOnHand) {
        const q = await postJson(`/api/stock/${existing.id}/set-quantity`, 'POST', {
          quantity,
          notes: 'Changed on the edit form'
        });
        if (!q.ok) {
          throw new Error(
            `Saved the details, but the quantity did not change: ${await apiError(q)}`
          );
        }
      }
      return existing.id;
    }

    let id = createdId;
    if (!id) {
      const res = await postJson('/api/stock', 'POST', payload);
      if (!res.ok) throw new Error(await apiError(res));
      const body = await res.json().catch(() => null);
      id = (body?.item?.id as string | undefined) ?? null;
      createdId = id;
    }
    if (id && quantity != null && quantity > 0) {
      const lot = await postJson(`/api/stock/${id}/lots`, 'POST', {
        receivedQuantity: quantity,
        unit: defaultUnit,
        lotNumber: lotNumber.trim() || undefined,
        quantityStatus: initialStatus === 'existing' ? undefined : initialStatus
      });
      if (!lot.ok) {
        throw new Error(
          `Saved ${displayName.trim()}, but the quantity did not save: ${await apiError(lot)}. Save again to retry the quantity.`
        );
      }
    }
    return id;
  }

  async function apiError(res: Response): Promise<string> {
    const body = await res.json().catch(() => null);
    if (res.status === 403) {
      return `Only the farm owner can save inventory changes${body?.message ? ` (${body.message})` : ''}.`;
    }
    const issue = body?.issues?.[0];
    const detail = issue?.message
      ? `: ${issue.path?.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`
      : '';
    return `${body?.error ?? body?.message ?? `HTTP ${res.status}`}${detail}`;
  }

  function handleCancel(): void {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    if (onCancel) {
      onCancel();
      return;
    }
    if (existing) goto(`/inventory/${type}/${existing.id}`);
    else goto(`/inventory?type=${type}`);
  }

  function onBeforeUnload(e: BeforeUnloadEvent): void {
    if (dirty && !submitting) {
      e.preventDefault();
    }
  }
</script>

<svelte:window on:beforeunload={onBeforeUnload} />

<header class="form-header">
  <span class="kicker">{isEdit ? 'Edit' : 'Add'} · {nounFor(type)}</span>
  <h1 class="serif">
    {isEdit ? displayName || '(unnamed)' : `New ${nounFor(type)}`}
  </h1>
</header>

{#if showPrefillBanner && prefill}
  <div class="prefill-banner" role="status">
    <Provenance source={prefill.source} />
    <span
      >Pre-filled for your review. Check each field, then save. Nothing is recorded until you do.</span
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

    {#if lotBearing}
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
        <InvField id="category" label="Kind" chip="required">
          <select id="category" bind:value={category}>
            {#each categoryOptions as opt (opt)}
              <option value={opt}>{CATEGORY_LABELS[opt] ?? opt}</option>
            {/each}
          </select>
        </InvField>
      {/if}
    {/if}
  </InvSection>

  {#if isFeed}
    <InvSection title="Bag and scoop" kicker="Feed">
      <InvField
        id="medicated"
        label="Medicated feed"
        error={fieldErrors.medicated}
        hint="Feed with a drug in it, such as a coccidiostat or antibiotic."
      >
        <label class="check">
          <input id="medicated" type="checkbox" bind:checked={medicated} />
          <span>This feed is medicated</span>
        </label>
      </InvField>
      {#if medicated}
        <p class="banner" role="alert" data-testid="medicated-refusal">
          {MEDICATED_FEED_MESSAGE} That way every feeding goes through the treatment record and its hold
          on eggs, milk and meat.
          <a href="/inventory/animal-health/add">Add it as animal health</a>
        </p>
      {/if}
      <InvField
        id="lbPerBag"
        label="Pounds in one bag"
        chip={defaultUnit === 'bag' ? 'required' : undefined}
        error={fieldErrors.lbPerBag}
        hint="Printed on the bag. Needed when you count this in bags, so a use in pounds comes off the right amount."
      >
        <input
          id="lbPerBag"
          type="number"
          inputmode="decimal"
          step="any"
          min="0"
          bind:value={lbPerBag}
        />
      </InvField>
      <InvField
        id="scoopLb"
        label="One scoop (lb)"
        error={fieldErrors.scoopLb}
        hint="Optional. Weigh your scoop once; the 1, 2 and 3 scoop buttons use it."
      >
        <div class="with-prov">
          <input
            id="scoopLb"
            type="number"
            inputmode="decimal"
            step="any"
            min="0"
            bind:value={scoopLb}
          />
          {#if scoopLb}<Provenance source="manual" compact />{/if}
        </div>
      </InvField>
    </InvSection>
  {/if}

  {#if isMed}
    <InvSection title="Approval number" kicker="Optional">
      <InvField
        id="nada"
        label="NADA or ANADA number"
        error={fieldErrors.nada}
        hint="On the label, e.g. NADA 141-061. Withdrawal times are never read from a scan; you enter them from the label or your vet when you record a treatment."
      >
        <div class="with-prov">
          <input id="nada" type="text" bind:value={nadaText} maxlength="30" />
          {#if nadaText.trim()}<Provenance source={nadaSource} compact />{/if}
        </div>
      </InvField>
    </InvSection>
  {/if}

  {#if lotBearing}
    {#if !isFeed}
      <InvSection
        title={isSeed ? 'Crop category' : isMed ? 'Library product' : 'Product label'}
        kicker={requiresLink ? 'Required' : 'Optional'}
      >
        {#if suggestedLink}
          <div class="suggest" data-testid="suggested-link">
            <p>
              The approval number matches <strong>{suggestedLink.displayName}</strong> in the library.
              Link it so treatments use its label withdrawal?
            </p>
            <button type="button" class="btn-secondary" onclick={confirmSuggestedLink}>
              Link it
            </button>
          </div>
        {/if}
        {#if isMed && library.length === 0}
          <p class="muted-note" data-testid="no-health-library">
            No animal-health products are in the library yet. You can still save this bottle; its
            withdrawal stays unknown until you enter it on a treatment.
          </p>
        {:else}
          <InvField
            id="pluginId"
            label={isSeed ? 'Category' : 'Product'}
            chip={requiresLink ? 'required' : 'from-plugin'}
            hint={isSeed
              ? 'The crop this seed grows. We match it from the name; search to change it.'
              : isMed
                ? 'Only link the exact product on the label. Its withdrawal times apply to every treatment from this bottle.'
                : 'Link the product in the library so its label and safety data stay in sync.'}
            error={fieldErrors.pluginId}
          >
            <LibraryPicker
              id="pluginId"
              options={library}
              bind:value={pluginId}
              bind:source={pluginSource}
              {suggestions}
              noun={isSeed ? 'category' : 'product'}
              placeholder={isSeed ? 'Search crops, e.g. tomato' : 'Search products'}
            />
          </InvField>
        {/if}
      </InvSection>
    {/if}

    <InvSection title="On hand" kicker={isEdit ? 'Stock' : 'Optional'}>
      <InvField
        id="defaultUnit"
        label="Unit"
        chip="required"
        error={fieldErrors.defaultUnit}
        hint={unitLocked
          ? 'The unit is fixed once stock is on hand.'
          : isSeed
            ? 'Count seeds, or use a weight for bulk seed bought by the ounce or pound.'
            : undefined}
      >
        <select id="defaultUnit" bind:value={defaultUnit} disabled={unitLocked}>
          {#each unitOptions as u (u)}
            <option value={u}>{stockUnitLabel(u, category)}</option>
          {/each}
        </select>
      </InvField>
      <InvField
        id="quantity"
        label={isEdit ? `On hand (${unitLabel})` : `How much do you have? (${unitLabel})`}
        error={fieldErrors.quantity}
        hint={isEdit
          ? expectedNote
            ? 'Only what is in the shed now. Changing this records an adjustment in the stock history.'
            : 'Changing this records an adjustment in the stock history.'
          : 'Saved as the first lot. Leave blank if you have not counted it yet; the planner sizes it to the bed.'}
      >
        <input
          id="quantity"
          type="number"
          inputmode="decimal"
          step="any"
          min="0"
          bind:value={quantity}
        />
      </InvField>
      {#if expectedNote && existing}
        <p class="expected-note" data-testid="expected-note">
          You also have {expectedNote}. When it arrives, tap Mark received on
          <a href={`/inventory/${type}/${existing.id}`}>the item page</a> instead of changing On hand
          here, so it is not counted twice.
        </p>
      {/if}
      {#if !isEdit}
        <InvField
          id="lotNumber"
          label="Lot number"
          hint="Optional. Printed on the label or packet."
        >
          <input id="lotNumber" type="text" bind:value={lotNumber} maxlength="80" />
        </InvField>
        <InvField
          id="initialStatus"
          label="Status"
          hint="Ordered and planned amounts help the planner lay out beds, but only on-hand stock counts as in the shed."
        >
          <select id="initialStatus" bind:value={initialStatus}>
            <option value="existing">{QUANTITY_STATUS_LABELS.existing}</option>
            <option value="ordered">{QUANTITY_STATUS_LABELS.ordered}</option>
            <option value="planned">{QUANTITY_STATUS_LABELS.planned}</option>
          </select>
        </InvField>
      {/if}
    </InvSection>

    <InvSection title="Storage & reorder" kicker="Optional">
      <InvField
        id="reorderThreshold"
        label="Reorder at"
        hint="Flag it as Reorder Soon when on hand drops below this number"
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
      <InvField id="barcode" label="Barcode" hint="EAN / UPC / GTIN, used by the Barcode method">
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
      <strong>Crop categories are versioned.</strong>
      Upload a new version in the <a href="/plugins">crop library</a>.
    </div>
  {/if}

  {#if error}
    <p class="error-banner" role="alert">{error}</p>
  {/if}

  <footer class="save-footer">
    <button type="button" class="btn-secondary" onclick={handleCancel} disabled={submitting}>
      Cancel
    </button>
    <button type="submit" class="btn-primary" disabled={submitting || (isFeed && medicated)}>
      {submitting ? 'Saving…' : isEdit ? 'Save changes' : `Create ${nounFor(type)}`}
    </button>
  </footer>
</form>

<style>
  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
  }
  .check input {
    width: 24px;
    height: 24px;
    min-height: 0;
  }
  .with-prov {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .with-prov input {
    flex: 1;
    min-width: 0;
  }
  .suggest {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--color-cream, #fff8e1);
    border: 1px solid var(--color-divider, #e5e7e0);
  }
  .suggest p {
    margin: 0;
    flex: 1 1 220px;
  }
  .muted-note {
    margin: 0;
    color: var(--color-ink-soft, #4a4f46);
    font-size: 0.9rem;
  }
  .expected-note {
    margin: 4px 0 12px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--color-wheat-50, #fbf5e6);
    color: var(--color-ink, #1f2a1c);
    font-size: 0.9rem;
    line-height: 1.4;
  }
  .expected-note a {
    color: inherit;
    font-weight: 600;
  }
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
    min-height: 48px;
    box-sizing: border-box;
  }
  select:disabled {
    opacity: 0.7;
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
  @media (max-width: 768px) {
    .save-footer {
      bottom: calc(72px + env(safe-area-inset-bottom, 0px));
    }
    :global(dialog) .save-footer {
      bottom: 0;
    }
  }
  .btn-primary,
  .btn-secondary {
    padding: 10px 18px;
    border-radius: 6px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    min-height: 48px;
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
