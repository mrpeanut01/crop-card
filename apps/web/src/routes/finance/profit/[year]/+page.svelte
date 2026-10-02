<script lang="ts">
  import { onMount } from 'svelte';
  import { createT } from '$lib/i18n';
  import '$lib/components/finance/finance.css';
  import CardView from '$lib/components/cards/CardView.svelte';
  import CardPrintSheet from '$lib/components/cards/CardPrintSheet.svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import { PRINT_HELP } from '$lib/cards/print';
  import { currentPrefs } from '$lib/prefsState.svelte';

  const { data } = $props();
  const tr = $derived(createT(data.locale));
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

<svelte:head><title>{tr('finance.profit.pageTitle', { year: data.year })}</title></svelte:head>

<div class="fin-page wrap">
  <div class="no-print">
    <header>
      <Kicker>{tr('finance.kicker')}</Kicker>
      <h1 class="serif">{tr('finance.profit.h1', { year: data.year })}</h1>
      <p class="fin-lede">
        {tr('finance.profit.lede')}
      </p>
    </header>
    <CardView card={data.card} {prefs} />
    <div class="fin-actions actions">
      <button class="fin-primary" type="button" onclick={print}>{tr('finance.profit.print')}</button
      >
      <a class="fin-ghost" href="/finance?year={data.year}">{tr('finance.profit.back')}</a>
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
