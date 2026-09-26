<script lang="ts">
  import { getWizardContext } from '../wizardState.svelte';
  import UnitInput from '$lib/components/ui/UnitInput.svelte';
  import { fmt } from '$lib/prefsState.svelte';

  const w = getWizardContext();
  const blocks = $derived(w.props.blocks);
  const priorCrops = $derived(
    new Map((w.props.priorSeason?.blocks ?? []).map((b) => [b.blockId, b.crops]))
  );

  let newName = $state('');
  let newAcres = $state<number | null>(null);
  let adding = $state(false);
  let addError = $state<string | null>(null);

  async function addBlock(e: SubmitEvent) {
    e.preventDefault();
    if (!newName.trim()) {
      addError = 'Give the block a name.';
      return;
    }
    adding = true;
    addError = null;
    try {
      const res = await fetch('/api/blocks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          acres: newAcres != null && newAcres > 0 ? newAcres : undefined
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        addError = body.error ?? `HTTP ${res.status}`;
        return;
      }
      const body = (await res.json()) as { block: { id: string } };
      newName = '';
      newAcres = null;
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
    <h3>Add your first block</h3>
    <p class="aw-intro">
      A block is any patch you plant as one unit: a bed, a row set, a field corner. Name it and the
      wizard will plan into it. You can draw it on the farm map later.
    </p>
  </div>
{:else}
  <div class="aw-blocks-header">
    <p class="aw-intro">Pick the blocks the wizard may use.</p>
    <div class="aw-blocks-actions">
      <span class="muted">{w.selectedBlockIds.size} of {blocks.length} selected</span>
      <button type="button" class="aw-link" onclick={() => w.selectAllBlocks()}>Select all</button>
      {#if w.selectedBlockIds.size > 0}
        <button type="button" class="aw-link" onclick={() => (w.selectedBlockIds = new Set())}>
          Clear
        </button>
      {/if}
    </div>
  </div>
  <ul class="aw-blocklist">
    {#each blocks as b (b.id)}
      {@const checked = w.selectedBlockIds.has(b.id)}
      {@const acresText = b.acres !== undefined ? fmt.qty(b.acres, 'area', { digits: 2 }) : null}
      {@const sunText = b.sunExposure ? `${b.sunExposure} sun` : null}
      {@const plantingsText =
        b.plantings.length > 0
          ? `${b.plantings.length} active planting${b.plantings.length === 1 ? '' : 's'}`
          : null}
      <li class:checked>
        <label>
          <input type="checkbox" {checked} onchange={() => w.toggleBlock(b.id)} />
          <span class="aw-block-info">
            <span class="aw-block-name">{b.blockLabel ?? b.name}</span>
            <span class="aw-chips">
              {#if acresText}<span class="aw-chip">{acresText}</span>{/if}
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
      </li>
    {/each}
  </ul>
{/if}

<form class="aw-add-block" onsubmit={addBlock} data-testid="wizard-add-block">
  <label class="aw-add-field">
    <span>{blocks.length === 0 ? 'Block name' : 'Add another block'}</span>
    <input type="text" bind:value={newName} placeholder="e.g. North beds" disabled={adding} />
  </label>
  <label class="aw-add-field aw-add-acres">
    <span>Area (optional)</span>
    <UnitInput quantity="area" min={0} bind:value={newAcres} disabled={adding} />
  </label>
  <button type="submit" class="btn-secondary" disabled={adding || !w.props.onRefreshParent}>
    {adding ? 'Adding…' : '+ Add block'}
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
    width: 100%;
  }
  .aw-blocklist input[type='checkbox'] {
    margin-top: 0.15rem;
    width: 18px;
    height: 18px;
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
