<script lang="ts">
  import { pageCropName } from '$lib/i18n/pageCropName';
  /**
   * Phase 32E (E1-1). "Seed or seedling?" for the planting selected in the
   * garden designer. The owner answers; a helper sees the answer.
   */
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { preselectedEstablishment, resolveSeedStartTiming } from '$lib/schedule/seedStart';
  import { getDesigner } from './designerState.svelte';

  const d = getDesigner();
  const tr = $derived(d.tr);
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
    if (p?.establishment === 'direct-seed') return tr('garden.est.current.direct');
    if (p?.establishment === 'transplant') return tr('garden.est.current.transplant');
    return tr('garden.est.current.none');
  }
</script>

{#if p}
  <section class="est" aria-labelledby="est-title" data-testid="designer-seed-or-seedling">
    <h3 id="est-title">{tr('garden.est.title')}</h3>
    <p class="now">
      {pageCropName(p.cropPluginId, p.varietyDisplayName)}: {current()}
      {#if p.establishment}<Provenance source="manual" compact />{/if}
    </p>
    {#if !p.establishment && suggested}
      <p class="hint">
        {suggested === 'transplant'
          ? tr('garden.est.usually.transplant')
          : tr('garden.est.usually.direct')}
        <Provenance source="plugin" compact />
      </p>
    {/if}
    {#if d.canEdit}
      <div class="row" role="group" aria-label={tr('garden.est.group')}>
        <button
          type="button"
          class="chip"
          disabled={busy}
          aria-pressed={p.establishment === 'direct-seed'}
          onclick={() => choose('direct-seed', false)}>{tr('garden.est.seed')}</button
        >
        <button
          type="button"
          class="chip"
          disabled={busy}
          onclick={() => choose('transplant', true)}>{tr('garden.est.seedlingIndoors')}</button
        >
        <button
          type="button"
          class="chip"
          disabled={busy}
          onclick={() => choose('transplant', false)}>{tr('garden.est.seedlingBought')}</button
        >
      </div>
      {#if timing && !timing.startIndoorsWeeks}
        <p class="hint">
          {tr('garden.est.noTiming')}
        </p>
      {/if}
      {#each notes as n (n)}<p class="hint">{n}</p>{/each}
    {:else}
      <p class="hint">{tr('garden.est.askOwner')}</p>
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
