<script lang="ts">
  /**
   * Inline "+ Add planting" modal for the Plan v2 shell. Posts to
   * `POST /api/blocks/[blockId]/plantings`.
   *
   * The crop box searches seed on hand first. Picking seed on hand takes the
   * planted amount out of that lot; picking a crop without seed splits the
   * amount into what goes in the ground and what was bought, so the two are
   * never confused. The date helper starts from frost dates and, with a
   * Claude key, is refined for the farm's location.
   */
  import { tick } from 'svelte';
  import { X } from 'lucide-svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import {
    PLANTING_UNITS,
    amountInStockUnit,
    optionLabel,
    searchCrops,
    seedAvailable,
    unitLabel,
    unitsCompatibleWith,
    type PickerCrop,
    type PickerOption,
    type PickerSeed
  } from '$lib/plan/cropPicker';
  import {
    dateFit,
    deterministicPlantingWindow,
    formatDay,
    type FrostDatesIso,
    type PlantingWindow
  } from '$lib/plan/plantingWindow';
  import type { StockUnit } from '$lib/stock/units';
  import SetupSheet from '$lib/components/setup/SetupSheet.svelte';
  import SetupProtection from '$lib/components/setup/SetupProtection.svelte';
  import {
    fetchBlockCovers,
    type BedFrostView,
    type BlockCoversResponse
  } from '$lib/climate/protectionView';
  import { availableQuantityText } from '$lib/stock/quantityStatus';
  import SeedOrSeedling from './SeedOrSeedling.svelte';
  import {
    establishmentPayload,
    type Establishment,
    type SeedStartPluginSlice
  } from '$lib/schedule/seedStart';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { cropDisplayName } from '$lib/i18n/cropName';

  type CropCatalogEntry = PickerCrop & {
    soilTempMinF?: number | null;
    dtmMaxDays?: number | null;
    seedStart?: SeedStartPluginSlice['plantingGuide'];
  };

  interface Props {
    open: boolean;
    blockId: string | null;
    blockName: string;
    cropCatalog: CropCatalogEntry[];
    seedStock?: PickerSeed[];
    frostDates?: FrostDatesIso | null;
    seasonYear?: number;
    aiEnabled?: boolean;
    /** Phase 32E: owners may add a cover when a date is too early. */
    canEditCovers?: boolean;
    onClose: () => void;
    onCreated: (plantingId: string) => void;
  }

  const {
    open,
    blockId,
    blockName,
    cropCatalog,
    seedStock = [],
    frostDates = null,
    seasonYear = new Date().getFullYear(),
    aiEnabled = false,
    canEditCovers = true,
    onClose,
    onCreated
  }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  type WindowState = {
    window: PlantingWindow;
    source: 'data' | 'ai' | 'fallback';
    loading: boolean;
  };

  let query = $state('');
  let listOpen = $state(false);
  let activeIndex = $state(0);
  let picked = $state<PickerOption | null>(null);
  let varietyDisplayName = $state('');
  let varietyEdited = $state(false);
  let plantingDate = $state('');
  let plantQty = $state<number | null>(null);
  let plantUnit = $state<StockUnit>('seeds');
  let boughtQty = $state<number | null>(null);
  let boughtUnit = $state<StockUnit>('seeds');
  let windowState = $state<WindowState | null>(null);
  let submitting = $state(false);
  let error = $state<string | null>(null);
  let cropInput = $state<HTMLInputElement | null>(null);
  let establishment = $state<Establishment | null>(null);
  let startIndoors = $state(true);
  let sowIndoorsOn = $state('');
  let bedFrost = $state<BedFrostView | null>(null);
  let coverSheetOpen = $state(false);
  let bedFrostSeq = 0;

  const aiCache = new Map<string, { window: PlantingWindow; source: 'ai' | 'fallback' }>();

  const results = $derived(
    searchCrops(query, seedStock, cropCatalog, undefined, page.data?.locale)
  );
  const pickLabel = (opt: PickerOption) =>
    cropDisplayName(
      opt.kind === 'seed' ? opt.seed.cropPluginId : opt.crop.pluginId,
      optionLabel(opt),
      page.data?.locale
    );
  const flat = $derived<PickerOption[]>([...results.seeds, ...results.crops]);
  const pickedSeed = $derived(picked?.kind === 'seed' ? picked.seed : null);
  const pickedCrop = $derived(picked?.crop ?? null);
  const seedStartPlugin = $derived.by<SeedStartPluginSlice | null>(() => {
    if (!pickedCrop) return null;
    const entry = cropCatalog.find((c) => c.pluginId === pickedCrop.pluginId);
    return { cropFamily: entry?.cropFamily ?? undefined, plantingGuide: entry?.seedStart };
  });
  const seedUnits = $derived(pickedSeed ? unitsCompatibleWith(pickedSeed.defaultUnit) : []);
  const plantUnitOptions = $derived(
    pickedSeed && seedUnits.length > 0
      ? PLANTING_UNITS.filter((u) => seedUnits.includes(u.value))
      : PLANTING_UNITS
  );

  const seedUse = $derived.by(() => {
    if (!pickedSeed || !plantQty || plantQty <= 0) return null;
    const inStock = amountInStockUnit(plantQty, plantUnit, pickedSeed.defaultUnit);
    if (inStock === null) return 'mismatch' as const;
    return inStock > seedAvailable(pickedSeed) + 1e-9 ? ('short' as const) : ('ok' as const);
  });

  const boughtUse = $derived.by(() => {
    if (pickedSeed || !plantQty || plantQty <= 0 || !boughtQty || boughtQty <= 0) return null;
    const inBought = amountInStockUnit(plantQty, plantUnit, boughtUnit);
    if (inBought === null) return 'mismatch' as const;
    return inBought > boughtQty + 1e-9 ? ('short' as const) : ('ok' as const);
  });

  const fit = $derived(
    windowState && plantingDate ? dateFit(plantingDate, windowState.window) : null
  );

  function seedAmountText(seed: PickerSeed): string {
    return availableQuantityText(
      { existing: seed.onHand, ordered: seed.onOrder ?? 0, planned: seed.planned ?? 0 },
      seed.defaultUnit
    );
  }

  function resetForm(): void {
    query = '';
    listOpen = false;
    activeIndex = 0;
    picked = null;
    varietyDisplayName = '';
    varietyEdited = false;
    plantingDate = '';
    plantQty = null;
    plantUnit = 'seeds';
    boughtQty = null;
    boughtUnit = 'seeds';
    windowState = null;
    establishment = null;
    startIndoors = true;
    sowIndoorsOn = '';
    error = null;
  }

  $effect(() => {
    if (!open) return;
    resetForm();
    listOpen = true;
    tick().then(() => cropInput?.focus());
  });

  $effect(() => {
    bedFrost = null;
    if (!open || !blockId) return;
    const seq = ++bedFrostSeq;
    const id = blockId;
    fetchBlockCovers(id, seasonYear)
      .then((r) => {
        if (seq !== bedFrostSeq) return;
        applyBedFrost(r);
      })
      .catch(() => {
        /* no bed frost: the farm dates stand */
      });
  });

  function applyBedFrost(r: BlockCoversResponse): void {
    const next = r.frost;
    const changed =
      !bedFrost ||
      bedFrost.lastSpring !== next.lastSpring ||
      bedFrost.firstFall !== next.firstFall ||
      bedFrost.frostFree !== next.frostFree;
    bedFrost = next;
    if (changed) {
      aiCache.clear();
      if (picked) void loadWindow(picked.crop.pluginId);
    }
  }

  const bedCovered = $derived(
    !!bedFrost &&
      (bedFrost.frostFree ||
        bedFrost.lastSpring !== bedFrost.farmLastSpring ||
        bedFrost.firstFall !== bedFrost.farmFirstFall)
  );
  const effectiveFrost = $derived<(FrostDatesIso & { frostFree?: boolean }) | null>(
    bedFrost
      ? {
          lastSpring: bedFrost.lastSpring,
          firstFall: bedFrost.firstFall,
          frostFree: bedFrost.frostFree
        }
      : frostDates
  );

  function choose(opt: PickerOption): void {
    picked = opt;
    query = pickLabel(opt);
    listOpen = false;
    error = null;
    if (!varietyEdited) varietyDisplayName = optionLabel(opt);
    if (opt.kind === 'seed') {
      const units = unitsCompatibleWith(opt.seed.defaultUnit);
      plantUnit = units.includes(opt.seed.defaultUnit)
        ? opt.seed.defaultUnit
        : (units[0] ?? 'seeds');
    } else {
      plantUnit = 'seeds';
      boughtUnit = 'seeds';
    }
    loadWindow(opt.crop.pluginId);
  }

  function clearPick(): void {
    picked = null;
    windowState = null;
    if (!varietyEdited) varietyDisplayName = '';
  }

  async function loadWindow(pluginId: string): Promise<void> {
    const entry = cropCatalog.find((c) => c.pluginId === pluginId);
    const frost = effectiveFrost;
    if (!entry || !frost) {
      windowState = null;
      return;
    }
    const cached = aiCache.get(pluginId);
    if (cached) {
      windowState = { ...cached, loading: false };
      return;
    }
    const baseline = deterministicPlantingWindow(
      {
        cropFamily: entry.cropFamily,
        soilTempMinF: entry.soilTempMinF,
        dtmMaxDays: entry.dtmMaxDays
      },
      frost
    );
    windowState = { window: baseline, source: 'data', loading: aiEnabled };
    if (!aiEnabled) return;
    try {
      const res = await fetch('/api/plan/planting-window', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cropPluginId: pluginId,
          year: seasonYear,
          ...(blockId ? { blockId } : {})
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        window: PlantingWindow;
        provenance: 'ai' | 'fallback';
      };
      const next = {
        window: body.window,
        source: body.provenance === 'ai' ? ('ai' as const) : ('fallback' as const)
      };
      aiCache.set(pluginId, next);
      if (picked?.crop.pluginId === pluginId) windowState = { ...next, loading: false };
    } catch {
      if (picked?.crop.pluginId === pluginId) {
        windowState = { window: baseline, source: 'fallback', loading: false };
      }
    }
  }

  function onQueryInput(): void {
    listOpen = true;
    activeIndex = 0;
    if (picked && query !== pickLabel(picked)) clearPick();
  }

  function onComboKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!listOpen) listOpen = true;
      else if (flat.length) activeIndex = (activeIndex + 1) % flat.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length) activeIndex = (activeIndex - 1 + flat.length) % flat.length;
    } else if (e.key === 'Enter') {
      if (listOpen && flat[activeIndex]) {
        e.preventDefault();
        choose(flat[activeIndex]);
      }
    } else if (e.key === 'Escape' && listOpen) {
      e.stopPropagation();
      listOpen = false;
    }
  }

  function optionId(i: number): string {
    return `np-crop-opt-${i}`;
  }

  async function handleSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!picked) {
      error = tr('planui.np.pickCrop');
      listOpen = true;
      cropInput?.focus();
      return;
    }
    if (!blockId) {
      error = tr('planui.np.noBlock');
      return;
    }
    submitting = true;
    error = null;
    const payload: Record<string, unknown> = {
      cropPluginId: picked.crop.pluginId,
      varietyDisplayName: varietyDisplayName.trim() || undefined
    };
    if (plantingDate) {
      const ms = Date.parse(plantingDate);
      if (Number.isFinite(ms)) payload.plantingDate = ms;
    }
    if (plantQty != null && plantQty > 0) {
      payload.quantityPlanted = plantQty;
      payload.quantityUnit = plantUnit;
    }
    Object.assign(payload, establishmentPayload(establishment, startIndoors, sowIndoorsOn));
    if (pickedSeed) {
      payload.stockItemId = pickedSeed.stockItemId;
    } else if (boughtQty != null && boughtQty > 0) {
      payload.purchase = { quantity: boughtQty, unit: boughtUnit };
    }
    try {
      const res = await fetch(`/api/blocks/${blockId}/plantings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        error = body.error ?? `HTTP ${res.status}`;
        return;
      }
      const body = (await res.json()) as { planting: { id: string } };
      resetForm();
      onCreated(body.planting.id);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      submitting = false;
    }
  }

  function onKey(e: KeyboardEvent): void {
    if ((e.target as Element | null)?.closest?.('dialog[open]')) return;
    if (e.key === 'Escape' && !submitting) onClose();
  }
</script>

<svelte:window on:keydown={(e) => open && onKey(e)} />

{#if open}
  <div
    class="backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget && !submitting) onClose();
    }}
  >
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="new-planting-title">
      <header class="modal-header">
        <h2 id="new-planting-title" class="serif">{tr('planui.np.title')}</h2>
        <button type="button" class="close" onclick={onClose} aria-label={tr('planui.np.close')}>
          <X size={16} strokeWidth={1.75} />
        </button>
      </header>
      <form onsubmit={handleSubmit} class="modal-form">
        <p class="muted">{tr('planui.np.addingTo')} <strong>{blockName}</strong></p>

        <div class="field combo">
          <label class="label" for="np-crop">
            {tr('planui.np.crop')} <span class="req" aria-hidden="true">*</span>
          </label>
          <input
            id="np-crop"
            bind:this={cropInput}
            type="text"
            role="combobox"
            autocomplete="off"
            aria-autocomplete="list"
            aria-expanded={listOpen}
            aria-controls="np-crop-list"
            aria-activedescendant={listOpen && flat[activeIndex]
              ? optionId(activeIndex)
              : undefined}
            placeholder={seedStock.some((s) => s.cropPluginId)
              ? tr('planui.np.placeholderSeed')
              : tr('planui.np.placeholderCrop')}
            bind:value={query}
            oninput={onQueryInput}
            onfocus={() => (listOpen = true)}
            onblur={() => (listOpen = false)}
            onkeydown={onComboKey}
          />
          {#if listOpen}
            <ul
              id="np-crop-list"
              class="options"
              role="listbox"
              aria-label={tr('planui.np.cropsAria')}
            >
              {#if results.seeds.length}
                <li class="group" role="presentation">{tr('planui.np.yourSeed')}</li>
                {#each results.seeds as opt, i (opt.seed.stockItemId)}
                  <li
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === activeIndex}
                    class="option"
                    class:active={i === activeIndex}
                    onmousedown={(e) => {
                      e.preventDefault();
                      choose(opt);
                    }}
                    onmouseenter={() => (activeIndex = i)}
                  >
                    <span class="opt-name">{pickLabel(opt)}</span>
                    <span class="opt-meta">{seedAmountText(opt.seed)}</span>
                  </li>
                {/each}
              {/if}
              {#if results.crops.length}
                <li class="group" role="presentation">
                  {results.seeds.length ? tr('planui.np.otherCrops') : tr('planui.np.crops')}
                </li>
                {#each results.crops as opt, j (opt.crop.pluginId)}
                  {@const i = results.seeds.length + j}
                  <li
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === activeIndex}
                    class="option"
                    class:active={i === activeIndex}
                    onmousedown={(e) => {
                      e.preventDefault();
                      choose(opt);
                    }}
                    onmouseenter={() => (activeIndex = i)}
                  >
                    <span class="opt-name">{pickLabel(opt)}</span>
                    {#if opt.crop.cropFamily}<span class="opt-meta">{opt.crop.cropFamily}</span
                      >{/if}
                  </li>
                {/each}
              {/if}
              {#if results.moreCrops > 0}
                <li class="more" role="presentation">
                  {results.crops.length === 0
                    ? tr('planui.np.typeToSearch', { n: results.moreCrops })
                    : tr('planui.np.moreKeepTyping', { n: results.moreCrops })}
                </li>
              {:else if flat.length === 0}
                <li class="more" role="presentation">{tr('planui.np.noMatch', { query })}</li>
              {/if}
            </ul>
          {/if}
          {#if pickedSeed}
            <span class="hint seed-tag"
              >{tr('planui.np.usingSeed', { amount: seedAmountText(pickedSeed) })}</span
            >
          {:else if pickedCrop}
            <span class="hint">{tr('planui.np.noSeedLinked')}</span>
          {/if}
        </div>

        <label class="field">
          <span class="label">{tr('planui.np.variety')}</span>
          <input
            type="text"
            bind:value={varietyDisplayName}
            oninput={() => (varietyEdited = true)}
            placeholder={tr('planui.np.varietyPlaceholder')}
            maxlength="160"
          />
        </label>

        <div class="field">
          <label class="label" for="np-date">{tr('planui.np.date')}</label>
          <input id="np-date" type="date" data-season-year={seasonYear} bind:value={plantingDate} />
          {#if windowState}
            <div class="window" aria-live="polite">
              <div class="chips" role="group" aria-label={tr('planui.np.suggestedAria')}>
                {#each [['Earliest', windowState.window.earliest], ['Prime', windowState.window.prime], ['Latest', windowState.window.latest]] as [label, day] (label)}
                  {@const labelText =
                    label === 'Earliest'
                      ? tr('planui.np.earliest')
                      : label === 'Prime'
                        ? tr('planui.np.prime')
                        : tr('planui.np.latest')}
                  <button
                    type="button"
                    class="chip"
                    class:prime={label === 'Prime'}
                    class:on={plantingDate === day}
                    onclick={() => (plantingDate = day)}
                  >
                    <span class="chip-k">{labelText}</span>
                    <span class="chip-v">{formatDay(day)}</span>
                  </button>
                {/each}
              </div>
              <div class="window-foot">
                {#if windowState.loading}
                  <span class="hint">{tr('planui.np.checkingClaude')}</span>
                {:else}
                  <Provenance
                    source={windowState.source}
                    detail={windowState.source === 'ai'
                      ? tr('planui.np.detailLocation')
                      : tr('planui.np.detailFrost')}
                  />
                {/if}
                {#if windowState.window.note}
                  <span class="hint note">{windowState.window.note}</span>
                {/if}
              </div>
              {#if bedCovered && bedFrost?.summary}
                <span class="hint" data-testid="np-bed-frost">{bedFrost.summary}</span>
              {/if}
              {#if fit === 'early'}
                <p class="warn">
                  {tr('planui.np.tooEarlyWarn')}
                </p>
                {#if blockId}
                  {#if canEditCovers}
                    <button
                      type="button"
                      class="btn-secondary add-cover"
                      onclick={() => (coverSheetOpen = true)}
                    >
                      {tr('planui.np.addCover')}
                    </button>
                  {:else}
                    <p class="hint">{tr('planui.np.askOwnerCover')}</p>
                  {/if}
                {/if}
              {:else if fit === 'late'}
                <p class="warn">{tr('planui.np.tooLateWarn')}</p>
              {/if}
            </div>
          {:else}
            <span class="hint">{tr('planui.np.leaveEmpty')}</span>
          {/if}
        </div>

        {#if pickedCrop}
          <SeedOrSeedling
            plugin={seedStartPlugin}
            dated={!!plantingDate}
            inGroundOn={plantingDate}
            idPrefix="np"
            bind:establishment
            bind:startIndoors
            bind:sowIndoorsOn
          />
        {/if}

        <fieldset class="amounts">
          <legend class="label">{tr('planui.np.howMuch')}</legend>
          <div class="amount-row">
            <label class="field grow">
              <span class="sub"
                >{tr('planui.np.planting')}
                <span class="sub-note">{tr('planui.np.plantingNote')}</span></span
              >
              <input
                type="number"
                step="any"
                min="0"
                inputmode="decimal"
                bind:value={plantQty}
                placeholder={tr('planui.np.optional')}
              />
            </label>
            <label class="field unit">
              <span class="sub">{tr('planui.np.unit')}</span>
              <select bind:value={plantUnit} aria-label={tr('planui.np.plantingUnitAria')}>
                {#each plantUnitOptions as u (u.value)}
                  <option value={u.value}>{u.label}</option>
                {/each}
              </select>
            </label>
          </div>

          {#if pickedSeed}
            <span class="hint">
              {#if seedUse === 'short'}
                <span class="warn-inline"
                  >{tr('planui.np.moreThan', { amount: seedAmountText(pickedSeed) })}</span
                >
              {:else if seedUse === 'mismatch'}
                {tr('planui.np.stockedIn', { unit: unitLabel(pickedSeed.defaultUnit) })}
              {:else if pickedSeed.onHand > 0}
                {tr('planui.np.fromOnHand')}
              {:else}
                {tr('planui.np.setAside')}
              {/if}
            </span>
          {:else if pickedCrop}
            <div class="amount-row">
              <label class="field grow">
                <span class="sub"
                  >{tr('planui.np.bought')}
                  <span class="sub-note">{tr('planui.np.boughtNote')}</span></span
                >
                <input
                  type="number"
                  step="any"
                  min="0"
                  inputmode="decimal"
                  bind:value={boughtQty}
                  placeholder={tr('planui.np.optional')}
                />
              </label>
              <label class="field unit">
                <span class="sub">{tr('planui.np.unit')}</span>
                <select bind:value={boughtUnit} aria-label={tr('planui.np.boughtUnitAria')}>
                  {#each PLANTING_UNITS as u (u.value)}
                    <option value={u.value}>{u.label}</option>
                  {/each}
                </select>
              </label>
            </div>
            <span class="hint">
              {#if boughtUse === 'mismatch'}
                {tr('planui.np.mismatch')}
              {:else if boughtUse === 'short'}
                <span class="warn-inline">{tr('planui.np.boughtShort')}</span>
              {:else if boughtQty && boughtQty > 0}
                {tr('planui.np.addsToInventory')}
              {:else}
                {tr('planui.np.fillBought')}
              {/if}
            </span>
          {/if}
        </fieldset>

        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <footer class="modal-footer">
          <button type="button" class="btn-secondary" onclick={onClose} disabled={submitting}>
            {tr('planui.np.cancel')}
          </button>
          <button type="submit" class="btn-primary" disabled={submitting}>
            {submitting ? tr('planui.np.creating') : tr('planui.np.title')}
          </button>
        </footer>
      </form>
    </div>
  </div>
{/if}

{#if blockId}
  <SetupSheet
    open={coverSheetOpen}
    title={tr('planui.np.coverTitle')}
    kicker={blockName}
    onClose={() => (coverSheetOpen = false)}
  >
    <SetupProtection
      blockId={blockId!}
      {blockName}
      canEdit={canEditCovers}
      {seasonYear}
      onDone={(r) => {
        coverSheetOpen = false;
        applyBedFrost(r);
      }}
    />
  </SetupSheet>
{/if}

<style>
  .add-cover {
    min-height: 48px;
    align-self: flex-start;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(31, 53, 34, 0.45);
    z-index: 1000;
    display: grid;
    place-items: center;
    padding: 16px;
  }
  .modal {
    background: var(--color-paper);
    border-radius: 12px;
    width: min(480px, 100%);
    max-height: calc(100vh - 32px);
    overflow: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 22px 12px;
    border-bottom: 1px solid var(--color-divider);
  }
  .modal-header h2 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--color-forest-deep, #1f3522);
  }
  .close {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 6px;
    border-radius: 999px;
    color: var(--color-ink-muted);
  }
  .close:hover {
    background: var(--color-divider-soft, var(--color-divider));
    color: var(--color-forest-deep, #1f3522);
  }
  .modal-form {
    padding: 18px 22px 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .muted {
    color: var(--color-ink-muted);
    margin: 0 0 4px;
    font-size: 0.9rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-forest-deep, #1f3522);
  }
  .req {
    color: var(--color-rust, #a23a3a);
  }
  input,
  select {
    padding: 10px 12px;
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    font: inherit;
    background: var(--color-paper);
  }
  input:focus,
  select:focus {
    outline: 2px solid var(--color-forest);
    outline-offset: 1px;
  }
  .hint {
    font-size: 0.75rem;
    color: var(--color-ink-muted);
  }
  .combo {
    position: relative;
  }
  .options {
    position: absolute;
    top: calc(100% - 2px);
    left: 0;
    right: 0;
    z-index: 5;
    margin: 0;
    padding: 4px 0;
    list-style: none;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.14);
    max-height: 300px;
    overflow: auto;
  }
  .group {
    padding: 8px 12px 4px;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }
  .option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 48px;
    padding: 0 12px;
    cursor: pointer;
  }
  .option.active {
    background: var(--color-divider-soft, var(--color-divider));
  }
  .opt-name {
    font-weight: 600;
    color: var(--color-forest-deep, #1f3522);
  }
  .opt-meta {
    font-size: 0.8rem;
    color: var(--color-ink-muted);
    white-space: nowrap;
  }
  .more {
    padding: 8px 12px;
    font-size: 0.8rem;
    color: var(--color-ink-muted);
  }
  .seed-tag {
    color: var(--color-forest, #2f5233);
    font-weight: 600;
  }
  .window {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .chips {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 4px 6px;
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    background: transparent;
    font: inherit;
    cursor: pointer;
    color: var(--color-forest-deep, #1f3522);
  }
  .chip.prime {
    border-color: var(--color-forest);
  }
  .chip.on {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: var(--color-cream, #fff8e1);
  }
  .chip-k {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    opacity: 0.8;
  }
  .chip-v {
    font-weight: 600;
  }
  .window-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
  }
  .note {
    flex: 1 1 200px;
  }
  .warn,
  .warn-inline {
    color: var(--color-rust, #a23a3a);
  }
  .warn {
    margin: 0;
    font-size: 0.8rem;
  }
  .amounts {
    border: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .amounts legend {
    padding: 0;
    margin-bottom: 6px;
  }
  .amount-row {
    display: flex;
    gap: 10px;
  }
  .grow {
    flex: 2;
    min-width: 0;
  }
  .unit {
    flex: 1;
    min-width: 0;
  }
  .sub {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-forest-deep, #1f3522);
  }
  .sub-note {
    font-weight: 400;
    color: var(--color-ink-muted);
  }
  .error {
    color: var(--color-rust, #a23a3a);
    background: #fdecea;
    border: 1px solid #f1c0bb;
    padding: 8px 10px;
    border-radius: 6px;
    margin: 0;
    font-size: 0.85rem;
  }
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 6px;
  }
  .btn-primary,
  .btn-secondary {
    padding: 8px 16px;
    border-radius: 6px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .btn-primary {
    background: var(--color-forest);
    color: var(--color-cream, #fff8e1);
  }
  .btn-primary:hover {
    background: var(--color-forest-deep, #1f3522);
  }
  .btn-secondary {
    background: transparent;
    color: var(--color-forest-deep, #1f3522);
    border-color: var(--color-divider);
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
