<script lang="ts">
  import A_InventoryList from '$lib/components/inventory/A_InventoryList.svelte';

  const { data } = $props();
</script>

<svelte:head>
  <title>Inventory — CropCard</title>
</svelte:head>

<A_InventoryList
  type={data.type}
  mode={data.mode}
  counts={data.counts}
  rows={data.rows}
/>
