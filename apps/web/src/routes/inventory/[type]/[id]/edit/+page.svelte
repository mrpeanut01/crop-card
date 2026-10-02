<script lang="ts">
  import A_InventoryEditForm from '$lib/components/inventory/A_InventoryEditForm.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { invTypeWord } from '$lib/components/inventory/typeLabel';

  const { data } = $props();
  const tr = $derived(createT(page.data?.locale));
</script>

<svelte:head>
  <title>{tr('inv.edit.pageTitle', { type: invTypeWord(tr, data.type) })}</title>
</svelte:head>

<nav class="breadcrumb" aria-label={tr('inv.breadcrumb')}>
  {#if data.existing && 'id' in data.existing}
    <a href="/inventory/{data.type}/{data.existing.id}">{tr('inv.backToDetail')}</a>
  {:else}
    <a href="/inventory?type={data.type}"
      >{tr('inv.allType', { type: invTypeWord(tr, data.type) })}</a
    >
  {/if}
</nav>

<A_InventoryEditForm type={data.type} existing={data.existing} library={data.library} />

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
