<script lang="ts">
  import '$lib/cards/print.css';
  import CardView from './CardView.svelte';
  import type { CardModel, CardPrintLayout } from '$lib/cards/model';
  import { paginate, printLinkFor } from '$lib/cards/print';
  import { DEFAULT_PREFS, type Prefs } from '$lib/prefs';

  interface Props {
    cards: CardModel[];
    layout?: CardPrintLayout;
    prefs?: Prefs;
    /** Server-provided ORIGIN; the QR is left off when it is missing. */
    origin?: string | null;
    /** Show the sheet on screen too (print preview, tests). */
    preview?: boolean;
  }

  const {
    cards,
    layout = 'letter-4up',
    prefs = DEFAULT_PREFS,
    origin = null,
    preview = false
  }: Props = $props();

  const pages = $derived(
    paginate(
      cards.map((card) => ({ card, link: printLinkFor(origin, card.key) })),
      layout
    )
  );
</script>

<div class="card-print-sheet layout-{layout}" class:preview data-layout={layout}>
  {#each pages as page, i (i)}
    <div class="sheet-page">
      {#each page as { card, link } (card.key)}
        <div class="print-cell">
          <CardView {card} variant="print" {prefs} printLink={link} />
        </div>
      {/each}
    </div>
  {/each}
</div>
