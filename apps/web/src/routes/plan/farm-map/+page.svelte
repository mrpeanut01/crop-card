<script lang="ts">
  import CardView from '$lib/components/cards/CardView.svelte';
  import CardPrintSheet from '$lib/components/cards/CardPrintSheet.svelte';
  import FarmMapFigure from '$lib/components/farm/FarmMapFigure.svelte';
  import { buildFarmMapCard } from '$lib/cards/build';
  import { FULL_PAGE_NOTE, PRINT_HELP } from '$lib/cards/print';
  import { layoutFarmFigure } from '$lib/farm/featureFigure';
  import { currentPrefs } from '$lib/prefsState.svelte';
  import { createT } from '$lib/i18n';

  const { data } = $props();
  const tr = $derived(createT(data.locale));

  const prefs = $derived(currentPrefs());
  const features = $derived(data.snapshot.mapFeatures ?? []);
  const drawnFeatureKinds = $derived.by(() => {
    const figure = layoutFarmFigure(data.mapFields, data.mapBlocks, features);
    return [...new Set([...figure.lines, ...figure.points].map((f) => f.kind))];
  });
  const card = $derived(buildFarmMapCard(data.snapshot, { prefs, drawnFeatureKinds }));

  function print() {
    const previous = document.title;
    document.title = `${card.title} ${tr('plan.farmMap.docTitleSuffix')}`;
    window.print();
    document.title = previous;
  }
</script>

<svelte:head><title>{tr('plan.farmMap.pageTitle')}</title></svelte:head>

<div class="wrap">
  <div class="no-print">
    <header>
      <p class="kicker">{tr('plan.farmMap.kicker')}</p>
      <h1 class="serif">{card.title}</h1>
      <p class="lede">{tr('plan.farmMap.lede')}</p>
    </header>

    <div class="grid">
      <FarmMapFigure
        fields={data.mapFields}
        blocks={data.mapBlocks}
        {features}
        label="{card.title} {tr('plan.farmMap.mapLabelSuffix')}"
      />
      <CardView {card} {prefs} />
    </div>

    <section class="print-box" aria-labelledby="print-title">
      <h2 id="print-title">{tr('plan.farmMap.print')}</h2>
      <p class="paper">{FULL_PAGE_NOTE} {tr('plan.farmMap.letterPaper')}</p>
      <div class="actions">
        <button type="button" class="primary" onclick={print}
          >{tr('plan.farmMap.printOrSave')}</button
        >
        {#if data.canEdit}
          <a class="secondary" href="/settings/farm/map">{tr('plan.farmMap.editMap')}</a>
        {/if}
      </div>
      <p class="hint">{PRINT_HELP}</p>
    </section>
  </div>

  <CardPrintSheet cards={[card]} {prefs} origin={data.snapshot.origin}>
    {#snippet figure()}
      <FarmMapFigure
        fields={data.mapFields}
        blocks={data.mapBlocks}
        {features}
        label="{card.title} {tr('plan.farmMap.mapLabelSuffix')}"
      />
    {/snippet}
  </CardPrintSheet>
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
  .paper {
    margin: 0 0 8px;
    font-size: 14px;
    color: var(--color-ink-soft);
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
