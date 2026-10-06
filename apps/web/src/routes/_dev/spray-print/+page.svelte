<script lang="ts">
  import CardPrintSheet from '$lib/components/cards/CardPrintSheet.svelte';

  const { data } = $props();
</script>

<svelte:head><title>Spray print check · CropCard</title></svelte:head>

<CardPrintSheet
  cards={data.cards}
  layout={data.layout}
  origin={data.origin}
  now={data.now}
  preview
/>
