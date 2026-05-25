<script lang="ts">
  import InventoryView from '$lib/components/InventoryView.svelte';

  let { data } = $props();
</script>

<!--
  Phase 25d (#89) — opt-in entry point to the new 5-method add waterfall
  at /stock/add. The InventoryView modal stays as the back-compat path
  (sticky on the page below); operators can choose either flow until the
  new surface is proven across all 4 methods.
-->
{#if data.canEdit}
  <div class="add-cta">
    <a class="add-cta-link" href="/stock/add">+ Add stock (5-method waterfall)</a>
  </div>
{/if}

<InventoryView data={data.inventory} />

<style>
  .add-cta {
    display: flex;
    justify-content: flex-end;
    margin: 0 0 10px;
  }
  .add-cta-link {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    padding: 9px 16px;
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    font-size: 13.5px;
    font-weight: 600;
    min-height: 38px;
    display: inline-flex;
    align-items: center;
  }
  .add-cta-link:hover {
    filter: brightness(1.08);
  }
</style>
