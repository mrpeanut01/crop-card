<script lang="ts">
  import CardView from '$lib/components/cards/CardView.svelte';
  import CardPrintSheet from '$lib/components/cards/CardPrintSheet.svelte';
  import { buildAreaCards, buildPlantingCards } from '$lib/cards/build';
  import { sampleSnapshot } from '$lib/cards/build/fixtures';
  import type { CardPrintLayout } from '$lib/cards/model';
  import { PRINT_HELP, PRINT_LAYOUTS } from '$lib/cards/print';

  const snapshot = sampleSnapshot();
  const cards = [...buildPlantingCards(snapshot), ...buildAreaCards(snapshot)];
  let layout = $state<CardPrintLayout>('letter-4up');

  function print() {
    const previous = document.title;
    document.title = 'CropCard sample cards';
    window.print();
    document.title = previous;
  }
</script>

<svelte:head><title>Cards preview · CropCard</title></svelte:head>

<div class="wrap">
  <div class="no-print">
    <h1 class="serif">Cards preview</h1>
    <p>Sample snapshot rendered by the Planting and Area builders.</p>

    <h2>Screen</h2>
    <div class="grid">
      {#each cards as card (card.key)}
        <CardView {card} />
      {/each}
    </div>

    <h2>Compact</h2>
    <div class="list">
      {#each cards as card (card.key)}
        <CardView {card} variant="compact" />
      {/each}
    </div>

    <h2>Print</h2>
    <fieldset>
      <legend>Paper</legend>
      {#each PRINT_LAYOUTS as l (l.id)}
        <label class="opt">
          <input type="radio" name="layout" value={l.id} bind:group={layout} />
          {l.label} <span class="hint">{l.hint}</span>
        </label>
      {/each}
    </fieldset>
    <button type="button" class="print" onclick={print}>Print or save as PDF</button>
    <p class="hint">{PRINT_HELP}</p>
  </div>

  <CardPrintSheet {cards} {layout} origin={snapshot.origin} preview />
</div>

<style>
  .wrap {
    max-width: 1100px;
    margin: 0 auto;
    padding: var(--space-4);
  }
  @media print {
    .wrap {
      padding: 0;
      max-width: none;
    }
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
    gap: var(--space-4);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-width: 480px;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 48px;
  }
  .hint {
    color: var(--color-ink-muted);
    font-size: var(--font-size-caption);
  }
  .print {
    min-height: 48px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-input);
    background: var(--color-forest);
    color: var(--color-paper);
    border: 0;
    font-weight: 600;
  }
</style>
