<script lang="ts">
  import { untrack } from 'svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { COOP_SPACE_KINDS, type CoopSpaceKind } from '$lib/farm/areaKinds';
  import { COOP_SPACE_LABELS, type DetailsDraft } from '$lib/farm/areaDetailsForm';
  import { defaultCoopSpecies, formatCount, suggestCapacity } from '$lib/farm/coopCapacity';
  import { getCoopContext } from '$lib/farm/coopContext';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { detailOption } from './farmLabels';

  let {
    draft = $bindable(),
    idPrefix = 'area',
    areaId = null,
    areaSqFt = null
  }: {
    draft: DetailsDraft;
    idPrefix?: string;
    areaId?: string | null;
    /** Floor area from the drawn outline or sketch size; null when neither. */
    areaSqFt?: number | null;
  } = $props();

  const tr = $derived(createT(page.data?.locale));
  const ctxGet = getCoopContext();
  const ctx = $derived(ctxGet?.() ?? null);
  const options = $derived(ctx?.options ?? []);

  untrack(() => {
    if (draft.speciesId || !ctx) return;
    const known = new Set(ctx.options.map((o) => o.id));
    const housed = defaultCoopSpecies({
      housedSpeciesIds: areaId ? ctx.housedByArea[areaId] : null,
      known
    });
    const id = housed ?? (ctx.farmDefault && known.has(ctx.farmDefault) ? ctx.farmDefault : null);
    if (id) draft = { ...draft, speciesId: id };
  });

  const speciesId = $derived(typeof draft.speciesId === 'string' ? draft.speciesId : '');
  const space = $derived(
    (COOP_SPACE_KINDS as readonly string[]).includes(draft.space as string)
      ? (draft.space as CoopSpaceKind)
      : null
  );
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const option = $derived(options.find((o) => o.id === speciesId) ?? null);
  const suggestion = $derived(
    suggestCapacity(
      {
        option,
        space,
        areaSqFt,
        shelterSqFt: num(draft.shelterSqFt),
        runSqFt: num(draft.runSqFt)
      },
      page.data?.locale
    )
  );
  const manual = $derived(draft.capacityProvenance === 'manual');
  const capacity = $derived(num(draft.capacity));

  $effect(() => {
    const s = suggestion;
    untrack(() => {
      if (draft.capacityProvenance === 'manual') return;
      if (s.ok) {
        if (draft.capacity !== s.count || draft.capacityProvenance !== 'data') {
          draft = { ...draft, capacity: s.count, capacityProvenance: 'data' };
        }
      } else if (draft.capacityProvenance === 'data') {
        draft = { ...draft, capacity: null, capacityProvenance: undefined };
      }
    });
  });

  function set(key: string, value: string | number | null | undefined) {
    draft = { ...draft, [key]: value };
  }

  function typeCapacity(raw: string) {
    const n = raw === '' ? null : Number(raw);
    draft = { ...draft, capacity: n, capacityProvenance: n === null ? undefined : 'manual' };
  }

  function useSuggestion() {
    if (!suggestion.ok) return;
    draft = { ...draft, capacity: suggestion.count, capacityProvenance: 'data' };
  }

  const sqftInput = (key: string) => (e: Event & { currentTarget: HTMLInputElement }) =>
    set(key, e.currentTarget.value === '' ? null : Number(e.currentTarget.value));
</script>

<div class="coop" data-testid="coop-pen-fields">
  {#if options.length}
    <div class="field">
      <label for="{idPrefix}-speciesId">{tr('farm.df.speciesId')}</label>
      <select
        id="{idPrefix}-speciesId"
        value={speciesId}
        onchange={(e) => set('speciesId', e.currentTarget.value || undefined)}
      >
        <option value="">{tr('farm.notSet')}</option>
        {#each options as o (o.id)}
          <option value={o.id}>{o.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="{idPrefix}-space">{tr('farm.df.space')}</label>
      <select
        id="{idPrefix}-space"
        value={space ?? ''}
        onchange={(e) => set('space', e.currentTarget.value || undefined)}
      >
        <option value="">{tr('farm.notSet')}</option>
        {#each COOP_SPACE_KINDS as k (k)}
          <option value={k}>{detailOption(tr, 'space', k, COOP_SPACE_LABELS[k])}</option>
        {/each}
      </select>
    </div>
    {#if space === 'both'}
      <div class="field">
        <label for="{idPrefix}-shelterSqFt">{tr('farm.df.shelterSqFt')}</label>
        <span class="unit-row">
          <input
            id="{idPrefix}-shelterSqFt"
            type="number"
            min="1"
            step="1"
            inputmode="decimal"
            value={draft.shelterSqFt ?? ''}
            oninput={sqftInput('shelterSqFt')}
          />
          <span class="unit">{tr('farm.unit.sqft')}</span>
        </span>
      </div>
      <div class="field">
        <label for="{idPrefix}-runSqFt">{tr('farm.df.runSqFt')}</label>
        <span class="unit-row">
          <input
            id="{idPrefix}-runSqFt"
            type="number"
            min="1"
            step="1"
            inputmode="decimal"
            value={draft.runSqFt ?? ''}
            oninput={sqftInput('runSqFt')}
          />
          <span class="unit">{tr('farm.unit.sqft')}</span>
        </span>
      </div>
    {/if}
  {/if}

  <div class="field">
    <label for="{idPrefix}-capacity">{tr('farm.df.capacity')}</label>
    <span class="unit-row">
      <input
        id="{idPrefix}-capacity"
        type="number"
        min="1"
        max="100000"
        step="1"
        inputmode="numeric"
        value={capacity ?? ''}
        oninput={(e) => typeCapacity(e.currentTarget.value)}
      />
      <span class="unit">{option ? option.plural : tr('farm.unit.animals')}</span>
      {#if capacity !== null && draft.capacityProvenance === 'data'}
        <Provenance
          source="data"
          label={tr('farm.prov.suggested')}
          detail={suggestion.ok ? suggestion.sourceName : undefined}
          compact
        />
      {:else if capacity !== null && manual}
        <Provenance source="manual" label={tr('farm.prov.typed')} compact />
      {/if}
    </span>
  </div>

  {#if options.length}
    <div class="suggest" data-testid="coop-suggestion" aria-live="polite">
      {#if suggestion.ok}
        <p>
          {tr('farm.coop.suggestedUpTo')}
          <strong>{formatCount(suggestion.count, page.data?.locale)}</strong>
          {option?.plural} ({suggestion.basis}).
          {#if suggestion.sourceName}<span class="src"
              >{tr('farm.coop.source', { name: suggestion.sourceName })}</span
            >{/if}
        </p>
        {#if manual && capacity !== suggestion.count}
          <button type="button" class="use" onclick={useSuggestion}
            >{tr('farm.coop.useInstead', {
              count: formatCount(suggestion.count, page.data?.locale)
            })}</button
          >
        {/if}
      {:else}
        <p class="muted">{suggestion.reason}</p>
      {/if}
      <p class="muted">
        {tr('farm.coop.guide')}
      </p>
    </div>
  {/if}
</div>

<style>
  .coop {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--space-2, 8px) var(--space-3, 12px);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--color-ink-soft);
    min-width: 0;
  }
  .field select,
  .field input {
    min-height: 48px;
    padding: 0 10px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    font-size: 15px;
    width: 100%;
    min-width: 0;
  }
  .unit-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .unit-row input {
    flex: 1 1 90px;
  }
  .unit {
    color: var(--color-ink-muted);
  }
  .suggest {
    grid-column: 1 / -1;
    font-size: 14px;
    color: var(--color-ink);
  }
  .suggest p {
    margin: 0 0 6px;
  }
  .src,
  .muted {
    color: var(--color-ink-muted);
    font-size: 13px;
  }
  .use {
    min-height: 48px;
    padding: 0 14px;
    border: 1px solid var(--color-forest);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    color: var(--color-forest-deep);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    margin-bottom: 6px;
  }
</style>
