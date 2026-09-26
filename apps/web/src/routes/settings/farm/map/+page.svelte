<script lang="ts">
  import { browser } from '$app/environment';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import FarmMapEditor from '$lib/components/farm/FarmMapEditor.svelte';

  let { data } = $props();
</script>

<svelte:head><title>Farm map · CropCard</title></svelte:head>

<SettingsShell title="Farm map" kicker="Areas & blocks" backHref="/settings/farm" hideFooter>
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
      ownerId={data.ownerId}
      snapshot={data.snapshot}
      canEdit={data.canEdit}
      isFirstRun={data.isFirstRun}
      initialCenter={data.initialCenter}
    />
  {:else}
    <section class="loading"><p>Loading map…</p></section>
  {/if}
</SettingsShell>

<style>
  .lede {
    margin: 0 0 16px;
    color: var(--color-ink-soft);
    font-size: 13.5px;
    max-width: 70ch;
  }
  .loading {
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    padding: 40px;
    text-align: center;
    color: var(--color-ink-muted);
  }
</style>
