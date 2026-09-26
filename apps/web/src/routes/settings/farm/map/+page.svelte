<script lang="ts">
  import { browser } from '$app/environment';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import FarmMapEditor from '$lib/components/farm/FarmMapEditor.svelte';

  let { data } = $props();
</script>

<svelte:head><title>Farm map · CropCard</title></svelte:head>

<SettingsShell title="Farm map" kicker="Areas & blocks" backHref="/settings/farm" hideFooter>
  {#if data.refused}
    <section class="refused" data-testid="farm-map-owner-only">
      <h2>Only the owner can change the farm map</h2>
      <p>
        You can still see every area and block on the Farm Map Card. Ask the owner if something
        needs to move or change.
      </p>
      <a class="primary" href="/plan/farm-map">Open the Farm Map Card</a>
    </section>
  {:else}
    <p class="lede">
      Put your fields, gardens, greenhouses, barns and woods on the map, with the blocks inside them
      and any shade sources. What you draw here feeds planning, pollination distances and the shade
      model. Tap an area to open its card. Changes save as you go.
    </p>

    {#if browser}
      <FarmMapEditor
        blocks={data.blocks}
        fields={data.fields}
        shadeSources={data.shadeSources}
        mapFeatures={data.mapFeatures}
        ownerId={data.ownerId}
        snapshot={data.snapshot}
        canEdit={data.canEdit}
        isFirstRun={data.isFirstRun}
        initialCenter={data.initialCenter}
      />
    {:else}
      <section class="loading"><p>Loading map…</p></section>
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
