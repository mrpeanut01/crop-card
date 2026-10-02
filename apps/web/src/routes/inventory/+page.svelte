<script lang="ts">
  import A_InventoryList from '$lib/components/inventory/A_InventoryList.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  const { data } = $props();
  const tr = $derived(createT(page.data?.locale));
</script>

<svelte:head>
  <title>{tr('inv.pageTitle')}</title>
</svelte:head>

<A_InventoryList
  type={data.type}
  mode={data.mode}
  counts={data.counts}
  rows={data.rows}
  canAdd={data.canAdd}
  visibleTypes={data.visibleTypes}
  amendments={data.amendments}
  canAddAmendment={data.canAddAmendment}
/>
