<script lang="ts">
  /**
   * Phase 32E (E1-1). "Seed or seedling?" for the planting selected in the
   * garden designer. The owner answers; a helper sees the answer.
   */
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { preselectedEstablishment, resolveSeedStartTiming } from '$lib/schedule/seedStart';
  import { getDesigner } from './designerState.svelte';

  const d = getDesigner();
  const p = $derived(d.selectedPlanting);
  const crop = $derived(p ? d.crop(p.cropPluginId) : undefined);
  const suggested = $derived(preselectedEstablishment(crop));
  const timing = $derived(crop ? resolveSeedStartTiming(crop) : null);
  let busy = $state(false);
  let notes = $state<string[]>([]);

  async function choose(establishment: 'direct-seed' | 'transplant', startIndoors: boolean) {
    if (!p || busy) return;
    busy = true;
    notes = await d.setEstablishment(p.cropId, establishment, startIndoors);
    busy = false;
  }

  function current(): string {
    if (p?.establishment === 'direct-seed') return 'Seeded in the ground';
    if (p?.establishment === 'transplant') return 'Seedlings';
    return 'Not answered yet';
  }
</script>

{#if p}
  <section class="est" aria-labelledby="est-title" data-testid="designer-seed-or-seedling">
    <h3 id="est-title">Seed or seedling?</h3>
    <p class="now">
      {p.varietyDisplayName}: {current()}
      {#if p.establishment}<Provenance source="manual" compact />{/if}
    </p>
    {#if !p.establishment && suggested}
      <p class="hint">
        Usually {suggested === 'transplant' ? 'set out as seedlings' : 'seeded in the ground'}.
        <Provenance source="plugin" compact />
      </p>
    {/if}
    {#if d.canEdit}
      <div class="row" role="group" aria-label="Seed or seedling">
        <button
          type="button"
          class="chip"
          disabled={busy}
          aria-pressed={p.establishment === 'direct-seed'}
          onclick={() => choose('direct-seed', false)}>Seed</button
        >
        <button
          type="button"
          class="chip"
          disabled={busy}
          onclick={() => choose('transplant', true)}>Seedling, I start it indoors</button
        >
        <button
          type="button"
          class="chip"
          disabled={busy}
          onclick={() => choose('transplant', false)}>Seedling, bought</button
        >
      </div>
      {#if timing && !timing.startIndoorsWeeks}
        <p class="hint">
          Indoor start timing is not known for this crop. Set the sow date yourself on the plan.
        </p>
      {/if}
      {#each notes as n (n)}<p class="hint">{n}</p>{/each}
    {:else}
      <p class="hint">Ask the owner to change this.</p>
    {/if}
  </section>
{/if}

<style>
  .est {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--font-size-body);
  }
  .now,
  .hint {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .hint {
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    min-height: 48px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    font-weight: 600;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: var(--color-paper);
  }
</style>
