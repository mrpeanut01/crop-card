<script lang="ts">
  import CardView from '$lib/components/cards/CardView.svelte';
  import CardPrintSheet from '$lib/components/cards/CardPrintSheet.svelte';
  import FarmMapFigure from '$lib/components/farm/FarmMapFigure.svelte';
  import { buildFarmMapCard } from '$lib/cards/build';
  import type { CardPrintLayout } from '$lib/cards/model';
  import { PRINT_HELP, PRINT_LAYOUTS } from '$lib/cards/print';
  import { currentPrefs } from '$lib/prefsState.svelte';

  const { data } = $props();

  const prefs = $derived(currentPrefs());
  const card = $derived(buildFarmMapCard(data.snapshot, { prefs }));
  let layout = $state<CardPrintLayout>('letter-4up');

  function print() {
    const previous = document.title;
    document.title = `${card.title} farm map card`;
    window.print();
    document.title = previous;
  }
</script>

<svelte:head><title>Farm map card · CropCard</title></svelte:head>

<div class="wrap">
  <div class="no-print">
    <header>
      <p class="kicker">Farm map card</p>
      <h1 class="serif">{card.title}</h1>
      <p class="lede">
        The whole farm on one card, ready for the barn wall or the truck. Print it, or save it as a
        PDF from the print dialog. Printing works without a signal.
      </p>
    </header>

    <div class="grid">
      <FarmMapFigure
        fields={data.mapFields}
        blocks={data.mapBlocks}
        features={data.snapshot.mapFeatures ?? []}
        label="{card.title} map"
      />
      <CardView {card} {prefs} />
    </div>

    <section class="print-box" aria-labelledby="print-title">
      <h2 id="print-title">Print</h2>
      <fieldset>
        <legend>Paper</legend>
        {#each PRINT_LAYOUTS as l (l.id)}
          <label class="opt">
            <input type="radio" name="layout" value={l.id} bind:group={layout} />
            <span>{l.label} <span class="hint">{l.hint}</span></span>
          </label>
        {/each}
      </fieldset>
      <div class="actions">
        <button type="button" class="primary" onclick={print}>Print or save as PDF</button>
        {#if data.canEdit}
          <a class="secondary" href="/settings/farm/map">Edit the map</a>
        {/if}
      </div>
      <p class="hint">{PRINT_HELP}</p>
    </section>
  </div>

  <CardPrintSheet cards={[card]} {layout} {prefs} origin={data.snapshot.origin} />
</div>

<style>
  .wrap {
    max-width: 1100px;
    margin: 0 auto;
    padding: 16px 16px 96px;
  }
  @media print {
    .wrap {
      padding: 0;
      max-width: none;
    }
  }
  .kicker {
    margin: 0;
    font-size: var(--font-size-kicker, 11px);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--color-ink-muted);
  }
  h1 {
    margin: 4px 0 6px;
    font-size: 1.9rem;
    color: var(--color-forest-deep);
  }
  .lede {
    margin: 0 0 16px;
    max-width: 70ch;
    color: var(--color-ink-soft);
    font-size: 14px;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: 16px;
    align-items: start;
  }
  @media (max-width: 760px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .print-box {
    margin-top: 20px;
    padding: 16px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 10px);
    background: var(--color-paper);
  }
  .print-box h2 {
    margin: 0 0 8px;
    font-size: 1.1rem;
  }
  fieldset {
    border: 0;
    margin: 0 0 8px;
    padding: 0;
  }
  legend {
    font-size: 13px;
    color: var(--color-ink-soft);
    margin-bottom: 4px;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
  }
  .opt input {
    width: 20px;
    height: 20px;
    accent-color: var(--color-forest);
  }
  .hint {
    color: var(--color-ink-muted);
    font-size: 12.5px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 8px 0;
  }
  .primary,
  .secondary {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    padding: 0 18px;
    border-radius: var(--radius-input, 8px);
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .primary {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: 0;
  }
  .secondary {
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-forest-deep);
  }
</style>
