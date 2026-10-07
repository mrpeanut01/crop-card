<script lang="ts">
  import A_InventoryAddFlow from '$lib/components/inventory/A_InventoryAddFlow.svelte';
  import A_InventoryEditForm from '$lib/components/inventory/A_InventoryEditForm.svelte';
  import AmendmentBatchForm from '$lib/components/amendments/AmendmentBatchForm.svelte';
  import AiUsageChip from '$lib/components/billing/AiUsageChip.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { invTypeWord } from '$lib/components/inventory/typeLabel';

  const { data } = $props();
  const tr = $derived(createT(page.data?.locale));
</script>

<svelte:head>
  <title>{tr('inv.add.pageTitle', { type: invTypeWord(tr, data.type) })}</title>
</svelte:head>

<nav class="breadcrumb" aria-label={tr('inv.breadcrumb')}>
  <a href="/inventory?type={data.type}">{tr('inv.allType', { type: invTypeWord(tr, data.type) })}</a
  >
</nav>

{#if data.type === 'amendment'}
  <h1 class="serif">{tr('inv.add.amendmentTitle')}</h1>
  <AmendmentBatchForm today={data.today ?? ''} canSave={data.canSave} />
{:else if data.hayCutting}
  <A_InventoryEditForm
    type={data.type}
    library={data.library}
    hayCutting={data.hayCutting}
    prefill={{
      category: 'feed',
      displayName: tr('inv.add.hayName', { cutting: data.hayCutting.label }),
      defaultUnit: data.hayCutting.bales ? 'bale' : 'lb',
      quantity: data.hayCutting.bales ?? undefined,
      source: 'manual'
    }}
  />
{:else}
  {#if data.aiEnabled}<AiUsageChip />{/if}

  <A_InventoryAddFlow
    type={data.type}
    aiEnabled={data.aiEnabled}
    canSave={data.canSave}
    library={data.library}
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
  h1 {
    margin: 0 0 12px;
    font-size: 1.4rem;
    color: var(--color-forest-deep, #1f3522);
  }
</style>
