<script lang="ts">
  import '$lib/cards/print.css';
  import CardView from './CardView.svelte';
  import type { Snippet } from 'svelte';
  import type { CardModel, CardPrintLayout } from '$lib/cards/model';
  import { paginateCards, printLinkFor } from '$lib/cards/print';
  import { DEFAULT_PREFS, type Prefs } from '$lib/prefs';

  interface Props {
    cards: CardModel[];
    layout?: CardPrintLayout;
    prefs?: Prefs;
    /** Server-provided ORIGIN; the QR is left off when it is missing. */
    origin?: string | null;
    /** Show the sheet on screen too (print preview, tests). */
    preview?: boolean;
    now?: number;
    /** Drawn above a card that prints on its own page, e.g. the farm map. */
    figure?: Snippet<[CardModel]>;
  }

  const {
    cards,
    layout = 'letter-4up',
    prefs = DEFAULT_PREFS,
    origin = null,
    preview = false,
    now = Date.now(),
    figure
  }: Props = $props();

  const pages = $derived(
    paginateCards(
      cards.map((card) => ({ card, link: printLinkFor(origin, card.key) })),
      layout
    )
  );
</script>

<div class="card-print-sheet layout-{layout}" class:preview data-layout={layout}>
  {#each pages as page, i (i)}
    <div class="sheet-page" class:full-page={page.full} data-full-page={page.full || undefined}>
      {#each page.items as { card, link } (card.key)}
        <div class="print-cell">
          {#if page.full && figure}
            <div class="print-figure">{@render figure(card)}</div>
          {/if}
          <CardView {card} variant="print" {prefs} {now} printLink={link} />
        </div>
      {/each}
    </div>
  {/each}
</div>
