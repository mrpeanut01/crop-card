<script lang="ts">
  import { onMount } from 'svelte';
  import CardView from '$lib/components/cards/CardView.svelte';
  import type { CardModel, CardPrintLayout } from '$lib/cards/model';
  import { PRINT_LAYOUTS } from '$lib/cards/print';
  import type { Prefs } from '$lib/prefs';

  interface Props {
    recordKind: string;
    rowId: string;
    prefs: Prefs;
    onPrint: (job: { cards: CardModel[]; layout: CardPrintLayout; origin: string | null }) => void;
    fetcher?: typeof fetch;
  }
  const { recordKind, rowId, prefs, onPrint, fetcher }: Props = $props();

  type Load =
    | { state: 'loading' }
    | { state: 'ready'; cards: CardModel[]; origin: string | null }
    | { state: 'error'; message: string };

  let load = $state<Load>({ state: 'loading' });
  let layout = $state<CardPrintLayout>('index-4x6');
  const selectId = $derived(`record-card-layout-${rowId}`);

  onMount(() => {
    const doFetch = fetcher ?? fetch;
    const url = `/api/records/${encodeURIComponent(recordKind)}/${encodeURIComponent(rowId)}/card`;
    doFetch(url, { headers: { accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) {
          load = {
            state: 'error',
            message:
              res.status === 404
                ? 'This record is no longer here.'
                : 'The card could not load. Try again in a moment.'
          };
          return;
        }
        const body = (await res.json()) as { cards: CardModel[]; origin: string | null };
        load = { state: 'ready', cards: body.cards, origin: body.origin };
      })
      .catch(() => {
        load = {
          state: 'error',
          message: 'No connection, so this card cannot load. Your saved cards are in the deck.'
        };
      });
  });
</script>

<div class="record-card" data-testid="record-card-panel" aria-live="polite">
  {#if load.state === 'loading'}
    <p class="note">Loading the card…</p>
  {:else if load.state === 'error'}
    <p class="note">{load.message} <a href="/cards">Open your card deck</a></p>
  {:else if load.cards.length === 0}
    <p class="note">This record has no card of its own. Open the record for every detail.</p>
  {:else}
    <div class="cards">
      {#each load.cards as card (card.key)}
        <CardView {card} {prefs} />
      {/each}
    </div>
    <div class="print-row">
      <label for={selectId}>Paper</label>
      <select id={selectId} bind:value={layout}>
        {#each PRINT_LAYOUTS as l (l.id)}
          <option value={l.id}>{l.label}</option>
        {/each}
      </select>
      <button
        type="button"
        class="print"
        onclick={() => {
          if (load.state === 'ready') onPrint({ cards: load.cards, layout, origin: load.origin });
        }}
      >
        Print card
      </button>
    </div>
  {/if}
</div>

<style>
  .record-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 0;
    position: sticky;
    left: 0;
    width: min(620px, calc(100vw - 48px));
    white-space: normal;
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .note {
    margin: 0;
    color: var(--color-ink-soft);
  }
  .note a {
    color: var(--color-forest-deep);
    font-weight: 600;
  }
  .print-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .print-row label {
    font-weight: 600;
    color: var(--color-ink-soft);
  }
  .print-row select {
    min-height: 48px;
    padding: 0 10px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    font: inherit;
  }
  .print {
    min-height: 48px;
    padding: 0 16px;
    border: none;
    border-radius: var(--radius-input, 6px);
    background: var(--color-forest);
    color: var(--color-cream);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .print:hover {
    background: var(--color-forest-deep);
  }
</style>
