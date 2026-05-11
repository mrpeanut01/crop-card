<script lang="ts">
  import InventoryView from '$lib/components/InventoryView.svelte';

  let { data } = $props();
</script>

<InventoryView data={data.inventory} />
