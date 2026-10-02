<script lang="ts">
  import A_InventoryAddFlow from '$lib/components/inventory/A_InventoryAddFlow.svelte';
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

{#if data.aiEnabled}<AiUsageChip />{/if}

<A_InventoryAddFlow
  type={data.type}
  aiEnabled={data.aiEnabled}
  canSave={data.canSave}
  library={data.library}
/>

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
