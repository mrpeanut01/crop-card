<script lang="ts">
  import DesignerPage from '$lib/components/garden/DesignerPage.svelte';

  const { data } = $props();
</script>

{#key `${data.design.canvas.areaId}|${data.design.seasonYear}|${data.offline}`}
  <DesignerPage {data} />
{/key}
