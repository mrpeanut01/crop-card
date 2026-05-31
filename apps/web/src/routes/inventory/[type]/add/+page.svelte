<script lang="ts">
  import A_InventoryAddFlow from '$lib/components/inventory/A_InventoryAddFlow.svelte';

  const { data } = $props();
</script>

<svelte:head>
  <title>New {data.type} — CropCard</title>
</svelte:head>

<nav class="breadcrumb" aria-label="Breadcrumb">
  <a href="/inventory?type={data.type}">← All {data.type}</a>
</nav>

<A_InventoryAddFlow type={data.type} aiEnabled={data.aiEnabled} />

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
