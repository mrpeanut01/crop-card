<script lang="ts">
  import { getWizardContext } from '../wizardState.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { cropDisplayNameByEnglish } from '$lib/i18n/cropName';
  import { areaText } from '$lib/plan/seedAmountText';
  import UnitInput from '$lib/components/ui/UnitInput.svelte';
  import EditBlockModal from '$lib/components/plan/EditBlockModal.svelte';
  import { fmt } from '$lib/prefsState.svelte';
  import { blockHasSize, type BlockEntry } from '../types';
  import { defaultWizardArea, wizardBlockBody } from '$lib/setup/spot';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import {
    DEFAULT_BED_WIDTH_FT,
    DEFAULT_MAX_BED_LENGTH_FT,
    type SuggestedBed
  } from '$lib/plan/bedLayout';

  const w = getWizardContext();
  const tr = $derived(createT(page.data?.locale));
  const SUN_KEY = {
    full: 'wizard.blocks.sunFull',
    partial: 'wizard.blocks.sunPartial',
    shade: 'wizard.blocks.sunShade'
  } as const;
  const blocks = $derived(w.props.blocks);
  let editing = $state<BlockEntry | null>(null);

  async function afterEdit() {
    editing = null;
    await w.props.onRefreshParent?.();
  }

  const SQFT_PER_ACRE = 43_560;
  const selectedSqft = $derived(
    blocks
      .filter((b) => w.selectedBlockIds.has(b.id))
      .reduce(
        (sum, b) =>
          sum + (b.widthFt && b.lengthFt ? b.widthFt * b.lengthFt : (b.acres ?? 0) * SQFT_PER_ACRE),
        0
      )
  );
  const neededSqft = $derived(w.seedSpaceNeededSqft);
  const unsizedSelected = $derived(
    blocks.filter((b) => w.selectedBlockIds.has(b.id) && !blockHasSize(b))
  );
  const priorCrops = $derived(
    new Map((w.props.priorSeason?.blocks ?? []).map((b) => [b.blockId, b.crops]))
  );

  let newName = $state('');
  let newAcres = $state<number | null>(null);
  let newWidthFt = $state<number | null>(null);
  let newLengthFt = $state<number | null>(null);
  let adding = $state(false);
  let addError = $state<string | null>(null);
  const areas = $derived(w.props.areas ?? []);
  let pickedAreaId = $state<string | null>(null);
  const newArea = $derived(areas.find((a) => a.id === pickedAreaId) ?? defaultWizardArea(areas));

  function newBlockBody(): Record<string, unknown> {
    return wizardBlockBody(
      { name: newName, widthFt: newWidthFt, lengthFt: newLengthFt, acres: newAcres },
      newArea
    );
  }

  // #475: beds sized for the seed being planted. Width and longest bed are
  // the owner's own numbers; the defaults only fill the fields.
  // #555: a crop sown by area goes as square feet, never a plant count.
  const countedSeeds = $derived(
    [...w.selectedSeeds.entries()]
      .filter(([id, qty]) => qty > 0 && !w.fillToBedSeeds.has(id))
      .map(([id, qty]) => {
        const area = w.areaFor(id, qty);
        if (area) return { stockItemId: id, areaSqFt: Math.max(1, Math.round(area.sqft)) };
        return { stockItemId: id, plants: Math.round(w.plantsFor(id, qty) ?? 0) };
      })
      .filter((s) => ((s.areaSqFt ?? 0) || (s.plants ?? 0)) > 0)
  );
  let bedWidthFt = $state<number | null>(DEFAULT_BED_WIDTH_FT);
  let maxBedLengthFt = $state<number | null>(DEFAULT_MAX_BED_LENGTH_FT);
  let suggesting = $state(false);
  let suggestError = $state<string | null>(null);
  let suggestion = $state<{
    beds: SuggestedBed[];
    provenance: 'ai' | 'fallback';
    note: string | null;
    message: string | null;
    unplaced?: Array<{ key: string; name: string; plants: number }>;
  } | null>(null);
  let addingBeds = $state(false);
  let bedsAdded = $state<number | null>(null);
  const designerArea = $derived(
    newArea && (newArea.kind === 'garden' || newArea.kind === 'greenhouse') ? newArea : null
  );

  async function suggestBeds() {
    if (!bedWidthFt || !maxBedLengthFt) {
      suggestError = tr('wizard.blocks.errWidth');
      return;
    }
    suggesting = true;
    suggestError = null;
    bedsAdded = null;
    try {
      const res = await fetch('/api/plan/beds/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seeds: countedSeeds, bedWidthFt, maxBedLengthFt })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        suggestError = body.error ?? `HTTP ${res.status}`;
        return;
      }
      suggestion = body;
    } catch (err) {
      suggestError = err instanceof Error ? err.message : String(err);
    } finally {
      suggesting = false;
    }
  }

  async function addSuggestedBeds() {
    if (!suggestion) return;
    addingBeds = true;
    suggestError = null;
    const ids: string[] = [];
    try {
      for (const [i, bed] of suggestion.beds.entries()) {
        const res = await fetch('/api/blocks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            wizardBlockBody(
              {
                name: `Bed ${blocks.length + i + 1}`,
                widthFt: bed.widthFt,
                lengthFt: bed.lengthFt
              },
              newArea
            )
          )
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          suggestError = body.error ?? `HTTP ${res.status}`;
          break;
        }
        ids.push((body as { block: { id: string } }).block.id);
      }
    } catch (err) {
      suggestError = err instanceof Error ? err.message : String(err);
    } finally {
      await w.props.onRefreshParent?.();
      if (ids.length > 0) {
        w.selectedBlockIds = new Set([...w.selectedBlockIds, ...ids]);
        bedsAdded = ids.length;
        suggestion = null;
      }
      addingBeds = false;
    }
  }

  async function addBlock(e: SubmitEvent) {
    e.preventDefault();
    if (!newName.trim()) {
      addError = tr('wizard.blocks.errName');
      return;
    }
    adding = true;
    addError = null;
    try {
      const res = await fetch('/api/blocks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(newBlockBody())
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        addError = body.error ?? `HTTP ${res.status}`;
        return;
      }
      const body = (await res.json()) as { block: { id: string } };
      newName = '';
      newAcres = null;
      newWidthFt = null;
      newLengthFt = null;
      await w.props.onRefreshParent?.();
      w.selectedBlockIds = new Set([...w.selectedBlockIds, body.block.id]);
    } catch (err) {
      addError = err instanceof Error ? err.message : String(err);
    } finally {
      adding = false;
    }
  }
</script>

{#if blocks.length === 0}
  <div class="aw-blocks-empty" data-empty-state="blocks">
    <h3>{tr('wizard.blocks.emptyTitle')}</h3>
    <p class="aw-intro">
      {tr('wizard.blocks.emptyIntro')}
    </p>
  </div>
{:else}
  <div class="aw-blocks-header">
    <p class="aw-intro">{tr('wizard.blocks.pick')}</p>
    <div class="aw-blocks-actions">
      <span class="muted"
        >{tr('wizard.blocks.selected', { n: w.selectedBlockIds.size, total: blocks.length })}</span
      >
      <button type="button" class="aw-link" onclick={() => w.selectAllBlocks()}
        >{tr('wizard.blocks.selectAll')}</button
      >
      {#if w.selectedBlockIds.size > 0}
        <button type="button" class="aw-link" onclick={() => (w.selectedBlockIds = new Set())}>
          {tr('wizard.blocks.clear')}
        </button>
      {/if}
    </div>
  </div>
  <ul class="aw-blocklist">
    {#each blocks as b (b.id)}
      {@const checked = w.selectedBlockIds.has(b.id)}
      {@const acresText =
        b.widthFt && b.lengthFt
          ? `${fmt.qty(b.widthFt, 'distance')} × ${fmt.qty(b.lengthFt, 'distance')}`
          : b.acres !== undefined
            ? fmt.area(b.acres, { digits: 2 })
            : null}
      {@const sunText = b.sunExposure ? tr(SUN_KEY[b.sunExposure]) : null}
      {@const plantingsText =
        b.plantings.length > 0
          ? tr('wizard.blocks.activePlantings', { count: b.plantings.length })
          : null}
      <li class:checked>
        <label>
          <input type="checkbox" {checked} onchange={() => w.toggleBlock(b.id)} />
          <span class="aw-block-info">
            <span class="aw-block-name" id={`aw-block-name-${b.id}`}>{b.blockLabel ?? b.name}</span>
            <span class="aw-chips">
              {#if acresText}<span class="aw-chip">{acresText}</span>{:else}<span
                  class="aw-chip aw-chip-warn"
                  data-testid="block-no-size">{tr('wizard.blocks.noSize')}</span
                >{/if}
              {#if sunText}<span class="aw-chip">☀ {sunText}</span>{/if}
              {#if plantingsText}<span class="aw-chip aw-chip-warn">🌱 {plantingsText}</span>{/if}
              {#if priorCrops.get(b.id)}
                <span class="aw-chip aw-chip-prior"
                  >{w.props.priorSeason?.year}: {priorCrops.get(b.id)?.join(', ')}</span
                >
              {/if}
            </span>
          </span>
        </label>
        <button
          type="button"
          class="aw-edit"
          onclick={() => (editing = b)}
          disabled={!w.props.onRefreshParent}
          aria-describedby={`aw-block-name-${b.id}`}
          data-action="edit-block"
        >
          {tr('wizard.blocks.edit')}
        </button>
      </li>
    {/each}
  </ul>
  {#if unsizedSelected.length > 0}
    <p class="aw-space aw-space-short" role="status" data-testid="unsized-blocks">
      {tr('wizard.blocks.unsized', {
        count: unsizedSelected.length,
        name: unsizedSelected[0].blockLabel ?? unsizedSelected[0].name
      })}
    </p>
  {/if}
  {#if neededSqft > 0 && selectedSqft > 0}
    <p class="aw-space" class:aw-space-short={neededSqft > selectedSqft} data-testid="space-check">
      {tr('wizard.blocks.space', {
        needed: fmt.area(neededSqft / SQFT_PER_ACRE, { digits: 2 }),
        have: fmt.area(selectedSqft / SQFT_PER_ACRE, { digits: 2 })
      })}
      {#if neededSqft > selectedSqft}
        {tr('wizard.blocks.spaceMore')}
      {/if}
    </p>
  {/if}
{/if}

{#if countedSeeds.length > 0 && w.props.onRefreshParent}
  <section class="aw-beds" data-testid="bed-suggest" aria-labelledby="aw-beds-title">
    <h3 id="aw-beds-title">{tr('wizard.blocks.bedsTitle')}</h3>
    <p class="aw-intro">
      {tr('wizard.blocks.bedsIntro')}
    </p>
    <div class="aw-beds-fields">
      <label class="aw-add-field aw-add-acres">
        <span>{tr('wizard.blocks.bedWidth')}</span>
        <UnitInput quantity="distance" min={1} bind:value={bedWidthFt} disabled={suggesting} />
      </label>
      <label class="aw-add-field aw-add-acres">
        <span>{tr('wizard.blocks.longestBed')}</span>
        <UnitInput quantity="distance" min={1} bind:value={maxBedLengthFt} disabled={suggesting} />
      </label>
      <button
        type="button"
        class="btn-secondary"
        onclick={suggestBeds}
        disabled={suggesting || addingBeds}
        data-action="suggest-beds"
      >
        {suggesting ? tr('wizard.blocks.working') : tr('wizard.blocks.suggest')}
      </button>
    </div>
    <p class="muted aw-beds-default">
      {tr('wizard.blocks.bedDefault', {
        w: DEFAULT_BED_WIDTH_FT,
        l: DEFAULT_MAX_BED_LENGTH_FT
      })}
    </p>
    {#if suggestion}
      {#if suggestion.message}
        <p
          class={suggestion.unplaced?.length ? 'aw-add-error' : 'muted'}
          role="status"
          data-testid="bed-suggest-message"
        >
          {suggestion.message}
        </p>
      {/if}
      <ul class="aw-bed-list">
        {#each suggestion.beds as bed, i (i)}
          <li>
            <div class="aw-bed-head">
              <strong
                >{tr('planui.beds.bedLine', {
                  n: blocks.length + i + 1,
                  width: fmt.qty(bed.widthFt, 'distance'),
                  length: fmt.qty(bed.lengthFt, 'distance')
                })}</strong
              >
              <Provenance source={suggestion.provenance} compact />
            </div>
            <span class="muted">
              {bed.crops
                .map((c) =>
                  c.areaSqFt != null
                    ? tr('wizard.blocks.cropArea', {
                        name: cropDisplayNameByEnglish(c.name, page.data?.locale),
                        area: areaText(c.areaSqFt, w.prefs.units)
                      })
                    : tr('wizard.blocks.cropRows', {
                        name: cropDisplayNameByEnglish(c.name, page.data?.locale),
                        plants: c.plants,
                        count: c.rows
                      })
                )
                .join('; ')}
            </span>
          </li>
        {/each}
      </ul>
      {#if suggestion.note}<p class="muted">{suggestion.note}</p>{/if}
      <div class="aw-beds-actions">
        <button
          type="button"
          class="btn-primary"
          onclick={addSuggestedBeds}
          disabled={addingBeds}
          data-action="add-suggested-beds"
        >
          {addingBeds
            ? tr('wizard.blocks.adding')
            : `${tr('wizard.blocks.addBeds', { count: suggestion.beds.length })}${newArea ? tr('wizard.blocks.toArea', { area: newArea.name }) : ''}`}
        </button>
        <button type="button" class="btn-secondary" onclick={() => (suggestion = null)}>
          {tr('wizard.blocks.notNow')}
        </button>
      </div>
    {/if}
    {#if bedsAdded}
      <p class="aw-notice" role="status">
        {tr('wizard.blocks.added', { count: bedsAdded })}
        {#if designerArea}
          <a href={`/plan/areas/${designerArea.id}/design`} class="aw-designer-link"
            >{tr('wizard.blocks.designerLink')}</a
          >
        {/if}
      </p>
    {/if}
    {#if suggestError}<p class="aw-add-error" role="alert">{suggestError}</p>{/if}
  </section>
{/if}

<EditBlockModal
  open={editing !== null}
  block={editing}
  legacyEditorHref="/plan/farm"
  showDimensions
  onClose={() => (editing = null)}
  onSaved={afterEdit}
/>

<form class="aw-add-block" onsubmit={addBlock} data-testid="wizard-add-block">
  <label class="aw-add-field">
    <span
      >{blocks.length === 0 ? tr('wizard.blocks.blockName') : tr('wizard.blocks.addAnother')}</span
    >
    <input
      type="text"
      bind:value={newName}
      placeholder={tr('wizard.blocks.namePlaceholder')}
      disabled={adding}
    />
  </label>
  {#if areas.length > 1}
    <label class="aw-add-field">
      <span>{tr('wizard.blocks.in')}</span>
      <select
        value={newArea?.id ?? ''}
        onchange={(e) => (pickedAreaId = (e.target as HTMLSelectElement).value)}
        disabled={adding}
        data-testid="wizard-add-block-area"
      >
        {#each areas as a (a.id)}
          <option value={a.id}>{a.name}</option>
        {/each}
      </select>
    </label>
  {:else if newArea}
    <p class="aw-add-in muted">{tr('wizard.blocks.goesIn', { name: newArea.name })}</p>
  {/if}
  <label class="aw-add-field aw-add-acres">
    <span>{tr('wizard.blocks.widthOpt')}</span>
    <UnitInput quantity="distance" min={0} bind:value={newWidthFt} disabled={adding} />
  </label>
  <label class="aw-add-field aw-add-acres">
    <span>{tr('wizard.blocks.lengthOpt')}</span>
    <UnitInput quantity="distance" min={0} bind:value={newLengthFt} disabled={adding} />
  </label>
  <label class="aw-add-field aw-add-acres">
    <span>{tr('wizard.blocks.orArea')}</span>
    <UnitInput quantity="area" min={0} bind:value={newAcres} disabled={adding} />
  </label>
  <button type="submit" class="btn-secondary" disabled={adding || !w.props.onRefreshParent}>
    {adding ? tr('wizard.blocks.adding') : tr('wizard.blocks.addBlock')}
  </button>
  {#if addError}
    <p class="aw-add-error" role="alert">{addError}</p>
  {/if}
</form>

<style>
  .aw-intro {
    margin: 0 0 0.75rem;
    color: #4a5d4a;
  }
  .muted {
    color: #6a7d6a;
    font-size: 0.9rem;
  }
  .aw-add-in {
    margin: 0;
    align-self: center;
  }
  .aw-blocks-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }
  .aw-blocks-header .aw-intro {
    margin: 0;
  }
  .aw-blocks-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.9rem;
  }
  .aw-blocklist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.5rem;
  }
  .aw-blocklist li {
    display: flex;
    align-items: stretch;
    border: 1px solid #cbd5cb;
    border-radius: 8px;
    background: white;
    transition:
      border-color 0.1s,
      background 0.1s;
  }
  .aw-blocklist li:hover {
    border-color: var(--color-forest);
  }
  .aw-blocklist li.checked {
    border-color: var(--color-forest);
    background: #f3f9f4;
  }
  .aw-blocklist label {
    display: flex;
    align-items: flex-start;
    gap: 0.65rem;
    padding: 0.65rem 0.8rem;
    cursor: pointer;
    flex: 1;
    min-width: 0;
  }
  .aw-blocklist input[type='checkbox'] {
    margin-top: 0.15rem;
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    accent-color: var(--color-forest);
  }
  .aw-block-info {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
    flex: 1;
  }
  .aw-block-name {
    font-weight: 700;
    color: #1f3a26;
    font-size: 0.95rem;
    line-height: 1.2;
  }
  .aw-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .aw-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.1rem 0.5rem;
    background: #eef4ef;
    color: #4a5d4a;
    border-radius: 999px;
    font-size: 0.78rem;
    line-height: 1.4;
    white-space: nowrap;
    text-transform: capitalize;
  }
  .aw-chip-prior {
    background: #f4efe2;
    color: #6b5a33;
    text-transform: none;
    white-space: normal;
  }
  .aw-blocks-empty h3 {
    margin: 0 0 0.35rem;
    color: #1f3a26;
  }
  .aw-add-block {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.75rem;
    margin-top: 1rem;
    padding-top: 0.85rem;
    border-top: 1px dashed #cbd5cb;
  }
  .aw-add-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1 1 14rem;
    font-size: 0.85rem;
    color: #4a5d4a;
  }
  .aw-add-acres {
    flex: 0 1 9rem;
  }
  .aw-add-field input,
  .aw-add-field select,
  .aw-add-field :global(.unit-input > input) {
    min-height: 48px;
    padding: 0 0.7rem;
    border: 1px solid #cbd5cb;
    border-radius: 6px;
    font: inherit;
  }
  .aw-add-block button {
    min-height: 48px;
  }
  .aw-add-error {
    flex-basis: 100%;
    margin: 0;
    color: #a0391f;
    font-size: 0.85rem;
  }
  .aw-chip-warn {
    background: #fff1cc;
    color: #6a4f00;
  }
  .aw-edit {
    flex-shrink: 0;
    min-width: 48px;
    min-height: 48px;
    margin: 0.35rem;
    padding: 0 0.8rem;
    border: 1px solid #cbd5cb;
    border-radius: 6px;
    background: white;
    color: var(--color-forest);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .aw-edit:hover:not(:disabled) {
    border-color: var(--color-forest);
  }
  .aw-space {
    margin: 0.75rem 0 0;
    font-size: 0.9rem;
    color: #4a5d4a;
  }
  .aw-space-short {
    color: #6a4f00;
    background: #fff4d6;
    padding: 0.5rem 0.7rem;
    border-radius: 6px;
  }
  .aw-beds {
    margin-top: 1rem;
    padding: 0.85rem;
    border: 1px solid #cbd5cb;
    border-radius: 8px;
    background: #fbfdfb;
  }
  .aw-beds h3 {
    margin: 0 0 0.35rem;
    color: #1f3a26;
    font-size: 1rem;
  }
  .aw-beds-fields {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.75rem;
  }
  .aw-beds-fields button,
  .aw-beds-actions button {
    min-height: 48px;
  }
  .aw-beds-default {
    margin: 0.4rem 0 0;
    font-size: 0.85rem;
  }
  .aw-bed-list {
    list-style: none;
    margin: 0.75rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  .aw-bed-list li {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid #dfe7df;
    border-radius: 6px;
    background: white;
    overflow-wrap: anywhere;
  }
  .aw-bed-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .aw-beds-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 0.75rem;
  }
  .aw-notice {
    margin: 0.75rem 0 0;
    color: #1f3a26;
  }
  .aw-designer-link {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    color: var(--color-forest);
    font-weight: 600;
  }
  .aw-link {
    background: none;
    border: none;
    color: var(--color-forest);
    text-decoration: underline;
    cursor: pointer;
    font-size: inherit;
    padding: 0;
  }
</style>
