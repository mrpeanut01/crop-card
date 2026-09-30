<script lang="ts">
  import { onMount } from 'svelte';
  import '$lib/components/finance/finance.css';
  import CardView from '$lib/components/cards/CardView.svelte';
  import CardPrintSheet from '$lib/components/cards/CardPrintSheet.svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import { PRINT_HELP } from '$lib/cards/print';
  import { currentPrefs } from '$lib/prefsState.svelte';

  const { data } = $props();
  const prefs = $derived(currentPrefs());

  function print() {
    const previous = document.title;
    document.title = `${data.card.title} ${data.year}`;
    window.print();
    document.title = previous;
  }

  onMount(() => {
    if (data.print) print();
  });
</script>

<svelte:head><title>Season profit {data.year} · CropCard</title></svelte:head>

<div class="fin-page wrap">
  <div class="no-print">
    <header>
      <Kicker>Money · owner only</Kicker>
      <h1 class="serif">Season profit, {data.year}.</h1>
      <p class="fin-lede">
        One block per crop, animal group and Area. Print it or save it as a PDF.
      </p>
    </header>
    <CardView card={data.card} {prefs} />
    <div class="fin-actions actions">
      <button class="fin-primary" type="button" onclick={print}>Print or save as PDF</button>
      <a class="fin-ghost" href="/finance?year={data.year}">Back to Money</a>
    </div>
    <p class="fin-help">{PRINT_HELP}</p>
  </div>
  <CardPrintSheet cards={[data.card]} {prefs} origin={data.origin} />
</div>

<style>
  .wrap {
    max-width: 760px;
  }
  .actions {
    margin-top: var(--space-3);
  }
  @media print {
    .no-print {
      display: none;
    }
    .wrap {
      max-width: none;
    }
  }
</style>
