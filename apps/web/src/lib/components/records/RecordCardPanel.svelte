<script lang="ts">
  import { onMount } from 'svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import CardView from '$lib/components/cards/CardView.svelte';
  import HoldVoidPanel from './HoldVoidPanel.svelte';
  import type { CardModel, CardPrintLayout } from '$lib/cards/model';
  import { PRINT_LAYOUTS } from '$lib/cards/print';
  import type { Prefs } from '$lib/prefs';

  interface Props {
    recordKind: string;
    rowId: string;
    prefs: Prefs;
    onPrint: (job: { cards: CardModel[]; layout: CardPrintLayout; origin: string | null }) => void;
    fetcher?: typeof fetch;
    /** After the owner voids the record (32G G4). */
    onVoided?: () => void | Promise<void>;
  }
  const { recordKind, rowId, prefs, onPrint, fetcher, onVoided }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  type Load =
    | { state: 'loading' }
    | {
        state: 'ready';
        cards: CardModel[];
        origin: string | null;
        voidableUntilMs: number | null;
        canVoidHolds: boolean;
      }
    | { state: 'voided' }
    | { state: 'error'; message: string };

  const VOID_URL: Record<string, (id: string) => string> = {
    spray: (id) => `/api/spray/records/${encodeURIComponent(id)}/void`,
    insecticide: (id) => `/api/insecticide/${encodeURIComponent(id)}/void`,
    fungicide: (id) => `/api/fungicide/${encodeURIComponent(id)}/void`
  };
  const voidUrl = $derived(VOID_URL[recordKind]?.(rowId) ?? null);

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
            message: res.status === 404 ? tr('records.card.gone') : tr('records.card.loadFail')
          };
          return;
        }
        const body = (await res.json()) as {
          cards: CardModel[];
          origin: string | null;
          voidableUntilMs?: number | null;
          canVoidHolds?: boolean;
        };
        load = {
          state: 'ready',
          cards: body.cards,
          origin: body.origin,
          voidableUntilMs: body.voidableUntilMs ?? null,
          canVoidHolds: body.canVoidHolds === true
        };
      })
      .catch(() => {
        load = {
          state: 'error',
          message: tr('records.card.offline')
        };
      });
  });
</script>

<div class="record-card" data-testid="record-card-panel" aria-live="polite">
  {#if load.state === 'loading'}
    <p class="note">{tr('records.card.loading')}</p>
  {:else if load.state === 'voided'}
    <p class="note" role="status">Voided. This entry is no longer in your records.</p>
  {:else if load.state === 'error'}
    <p class="note">{load.message} <a href="/cards">{tr('records.card.openDeck')}</a></p>
  {:else if load.cards.length === 0}
    <p class="note">{tr('records.card.none')}</p>
  {:else}
    <div class="cards">
      {#each load.cards as card (card.key)}
        <CardView {card} {prefs} />
      {/each}
    </div>
    <div class="print-row">
      <label for={selectId}>{tr('records.card.paper')}</label>
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
        {tr('records.card.print')}
      </button>
    </div>
  {/if}
  {#if load.state === 'ready' && voidUrl}
    <HoldVoidPanel
      url={voidUrl}
      canVoidHolds={load.canVoidHolds}
      voidableUntilMs={load.voidableUntilMs}
      timeZone={prefs.timeZone}
      application
      {fetcher}
      onVoided={async () => {
        load = { state: 'voided' };
        await onVoided?.();
      }}
    />
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
