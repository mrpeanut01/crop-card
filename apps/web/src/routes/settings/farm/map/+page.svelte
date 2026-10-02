<script lang="ts">
  import { browser } from '$app/environment';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import FarmMapEditor from '$lib/components/farm/FarmMapEditor.svelte';
  import { createT } from '$lib/i18n';

  let { data } = $props();

  const tr = $derived(createT(data.locale));
</script>

<svelte:head><title>{tr('settings.farmMap.pageTitle')}</title></svelte:head>

<SettingsShell
  title={tr('settings.farmMap.title')}
  kicker={tr('settings.farmMap.kicker')}
  backHref="/settings/farm"
  hideFooter
>
  {#if data.refused}
    <section class="refused" data-testid="farm-map-owner-only">
      <h2>{tr('settings.farmMap.ownerOnlyTitle')}</h2>
      <p>{tr('settings.farmMap.ownerOnlyBody')}</p>
      <a class="primary" href="/plan/farm-map">{tr('settings.farmMap.openCard')}</a>
    </section>
  {:else}
    <p class="lede">
      {tr('settings.farmMap.lede')}
    </p>

    {#if browser}
      <FarmMapEditor
        blocks={data.blocks}
        fields={data.fields}
        shadeSources={data.shadeSources}
        mapFeatures={data.mapFeatures}
        ownerId={data.ownerId}
        snapshot={data.snapshot}
        housing={data.housing}
        grazing={data.grazing}
        petsLayout={data.petsLayout}
        coopSpecies={data.coopSpecies}
        farmAnimals={data.farmAnimals}
        canEdit={data.canEdit}
        isFirstRun={data.isFirstRun}
        initialCenter={data.initialCenter}
      />
    {:else}
      <section class="loading"><p>{tr('settings.farmMap.loading')}</p></section>
    {/if}
  {/if}
</SettingsShell>

<style>
  .lede {
    margin: 0 0 16px;
    color: var(--color-ink-soft);
    font-size: 13.5px;
    max-width: 70ch;
  }
  .refused {
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    padding: 24px;
    background: var(--color-paper);
    max-width: 60ch;
  }
  .refused h2 {
    margin: 0 0 8px;
    font-size: 18px;
    color: var(--color-forest-deep);
  }
  .refused p {
    margin: 0 0 16px;
  }
  .primary {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    padding: 0 16px;
    border-radius: var(--radius-input);
    background: var(--color-forest);
    color: var(--color-cream);
    font-weight: 600;
    text-decoration: none;
  }
  .loading {
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    padding: 40px;
    text-align: center;
    color: var(--color-ink-muted);
  }
</style>
