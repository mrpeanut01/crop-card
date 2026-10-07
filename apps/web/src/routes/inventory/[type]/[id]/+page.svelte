<script lang="ts">
  import PesticideDetail from '$lib/components/inventory/detail/PesticideDetail.svelte';
  import FertilityDetail from '$lib/components/inventory/detail/FertilityDetail.svelte';
  import SeedDetail from '$lib/components/inventory/detail/SeedDetail.svelte';
  import CropPluginDetail from '$lib/components/inventory/detail/CropPluginDetail.svelte';
  import FeedDetail from '$lib/components/inventory/detail/FeedDetail.svelte';
  import AnimalHealthDetail from '$lib/components/inventory/detail/AnimalHealthDetail.svelte';
  import AmendmentBatchDetail from '$lib/components/amendments/AmendmentBatchDetail.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { invTypeLower } from '$lib/components/inventory/typeLabel';

  const { data } = $props();
  const tr = $derived(createT(page.data?.locale));

  function titleOf(d: typeof data): string {
    if (d.type === 'crop') return d.plugin.displayName;
    if (d.type === 'animal-health') return d.item?.displayName ?? d.plugin?.displayName ?? '';
    if (d.type === 'amendment') return d.batch.name;
    return d.item.displayName;
  }
</script>

<svelte:head>
  <title>
    {titleOf(data)} · CropCard
  </title>
</svelte:head>

<nav class="breadcrumb" aria-label={tr('inv.breadcrumb')}>
  <a
    href="/inventory?type={data.type}{data.type === 'animal-health' && !data.item
      ? '&mode=catalog'
      : ''}">{tr('inv.allType', { type: invTypeLower(tr, data.type) })}</a
  >
</nav>

{#if data.type === 'pesticide'}
  <PesticideDetail
    item={data.item}
    lots={data.lots}
    movements={data.movements}
    plugin={data.plugin}
    phiByCrop={data.phiByCrop}
  />
{:else if data.type === 'fertility'}
  <FertilityDetail
    item={data.item}
    lots={data.lots}
    movements={data.movements}
    plugin={data.plugin}
  />
{:else if data.type === 'seed'}
  <SeedDetail
    item={data.item}
    lots={data.lots}
    movements={data.movements}
    plugin={data.plugin}
    seedSourcing={data.seedSourcing}
    showSeedSourcing={data.showSeedSourcing}
    canEditSeedSourcing={data.canEditSeedSourcing}
  />
{:else if data.type === 'feed'}
  <FeedDetail {...data} />
{:else if data.type === 'animal-health'}
  <AnimalHealthDetail {...data} />
{:else if data.type === 'amendment'}
  <AmendmentBatchDetail {...data} />
{:else if data.type === 'crop'}
  <CropPluginDetail
    plugin={data.plugin}
    resolvedArchetype={data.resolvedArchetype}
    hash={data.hash}
  />
{/if}

<style>
  .breadcrumb {
    margin-bottom: 12px;
  }
  .breadcrumb a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    font-size: 0.85rem;
    color: var(--color-forest, #1f5e3a);
    text-decoration: none;
  }
  .breadcrumb a:hover {
    text-decoration: underline;
  }
</style>
