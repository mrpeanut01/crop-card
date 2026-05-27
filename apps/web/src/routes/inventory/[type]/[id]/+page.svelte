<script lang="ts">
  import PesticideDetail from '$lib/components/inventory/detail/PesticideDetail.svelte';
  import FertilityDetail from '$lib/components/inventory/detail/FertilityDetail.svelte';
  import SeedDetail from '$lib/components/inventory/detail/SeedDetail.svelte';
  import CropPluginDetail from '$lib/components/inventory/detail/CropPluginDetail.svelte';
  import SprayerDetail from '$lib/components/inventory/detail/SprayerDetail.svelte';

  const { data } = $props();
</script>

<svelte:head>
  <title>
    {data.type === 'crop' || data.type === 'sprayer'
      ? data.type === 'crop'
        ? data.plugin.displayName
        : data.equipment.label
      : data.item.displayName} — CropCard
  </title>
</svelte:head>

<nav class="breadcrumb" aria-label="Breadcrumb">
  <a href="/inventory?type={data.type}">← All {data.type}</a>
</nav>

{#if data.type === 'pesticide'}
  <PesticideDetail
    item={data.item}
    lots={data.lots}
    movements={data.movements}
    plugin={data.plugin}
  />
{:else if data.type === 'fertility'}
  <FertilityDetail
    item={data.item}
    lots={data.lots}
    movements={data.movements}
    plugin={data.plugin}
  />
{:else if data.type === 'seed'}
  <SeedDetail item={data.item} lots={data.lots} movements={data.movements} plugin={data.plugin} />
{:else if data.type === 'crop'}
  <CropPluginDetail
    plugin={data.plugin}
    resolvedArchetype={data.resolvedArchetype}
    hash={data.hash}
  />
{:else if data.type === 'sprayer'}
  <SprayerDetail equipment={data.equipment} />
{/if}

<style>
  .breadcrumb {
    margin-bottom: 12px;
  }
  .breadcrumb a {
    font-size: 0.85rem;
    color: var(--color-forest, #1f5e3a);
    text-decoration: none;
  }
  .breadcrumb a:hover {
    text-decoration: underline;
  }
</style>
