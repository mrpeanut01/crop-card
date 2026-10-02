<script lang="ts">
  import { onMount } from 'svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import CardView from '$lib/components/cards/CardView.svelte';
  import HoldVoidPanel from './HoldVoidPanel.svelte';
  import { recordCardKey, type CardModel, type CardPrintLayout } from '$lib/cards/model';
  import { savedCopyCards, savedCopyNotice, type SavedRecordCard } from '$lib/cards/recordCard';
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
    | { state: 'saved'; cards: CardModel[]; savedAt: number }
    | { state: 'voided' }
    | { state: 'error'; message: string };

  type Store = typeof import('$lib/client/recordCardStore');
  async function store(): Promise<Store | null> {
    try {
      return await import('$lib/client/recordCardStore');
    } catch {
      return null;
    }
  }

  const VOID_URL: Record<string, (id: string) => string> = {
    spray: (id) => `/api/spray/records/${encodeURIComponent(id)}/void`,
    insecticide: (id) => `/api/insecticide/${encodeURIComponent(id)}/void`,
    fungicide: (id) => `/api/fungicide/${encodeURIComponent(id)}/void`
  };
  const voidUrl = $derived(VOID_URL[recordKind]?.(rowId) ?? null);

  let load = $state<Load>({ state: 'loading' });
  let layout = $state<CardPrintLayout>('index-4x6');
  const selectId = $derived(`record-card-layout-${rowId}`);
  const key = $derived(recordCardKey(recordKind, rowId));
  let stored = $state(false);
  let pinned = $state(false);
  let pinNote = $state<string | null>(null);

  async function remember(model: SavedRecordCard) {
    const s = await store();
    if (!s) return;
    try {
      stored = await s.saveRecordCard(model);
      pinned = stored && (await s.isRecordCardPinned(key));
    } catch {
      stored = false;
    }
  }

  async function forget() {
    stored = false;
    pinned = false;
    try {
      await (await store())?.forgetRecordCard(key);
    } catch {
      /* no storage: nothing saved to forget */
    }
  }

  async function showSavedCopy(): Promise<boolean> {
    const s = await store();
    if (!s) return false;
    try {
      const saved = await s.openRecordCard(key);
      if (!saved) return false;
      load = { state: 'saved', cards: savedCopyCards(saved.model), savedAt: saved.savedAt };
      stored = true;
      pinned = await s.isRecordCardPinned(key);
      return true;
    } catch {
      return false;
    }
  }

  async function togglePin() {
    pinNote = null;
    const s = await store();
    if (!s) return;
    try {
      if (pinned) {
        await s.unpinRecordCard(key);
        pinned = false;
        return;
      }
      const outcome = await s.pinRecordCard(key);
      if (outcome === 'pinned') {
        pinned = true;
        const { requestPersistentStorage } = await import('$lib/client/offlineStorage');
        void requestPersistentStorage();
      } else if (outcome === 'limit') {
        pinNote = tr('cardsui.rec.pinLimit');
      } else {
        pinNote = tr('cardsui.rec.pinFailed');
      }
    } catch {
      pinNote = tr('cardsui.rec.pinFailed');
    }
  }

  onMount(() => {
    const doFetch = fetcher ?? fetch;
    const url = `/api/records/${encodeURIComponent(recordKind)}/${encodeURIComponent(rowId)}/card`;
    doFetch(url, { headers: { accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 404) void forget();
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
        if (body.cards.length > 0)
          void remember({
            v: 1,
            recordKind,
            rowId,
            cards: body.cards,
            origin: body.origin ?? null
          });
      })
      .catch(async () => {
        if (await showSavedCopy()) return;
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
  {:else if load.state === 'saved'}
    <p class="saved-note" role="note" data-testid="saved-copy-notice">
      {savedCopyNotice(load.savedAt, prefs, tr)}
    </p>
    <div class="cards">
      {#each load.cards as card (card.key)}
        <CardView {card} {prefs} />
      {/each}
    </div>
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
  {#if stored && (load.state === 'ready' || load.state === 'saved')}
    <div class="pin-row">
      <button
        type="button"
        class="pin"
        aria-pressed={pinned}
        data-testid="record-card-pin"
        onclick={togglePin}
      >
        {pinned ? tr('cardsui.rec.pinnedOnDevice') : tr('cardsui.rec.pinOnDevice')}
      </button>
      <span class="pin-hint">
        {pinned ? tr('cardsui.rec.keptHint') : tr('cardsui.rec.tempHint')}
      </span>
    </div>
    {#if pinNote}<p class="note" role="status">{pinNote}</p>{/if}
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
        await forget();
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
  .saved-note {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-input, 6px);
    background: var(--pill-wheat-bg);
    border: 1px solid var(--pill-wheat-bd);
    color: var(--pill-wheat-fg);
    font-weight: 600;
  }
  .pin-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .pin {
    min-height: 48px;
    min-width: 48px;
    padding: 0 16px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .pin[aria-pressed='true'] {
    background: var(--pill-forest-bg);
    border-color: var(--pill-forest-bd);
    color: var(--pill-forest-fg);
  }
  .pin:focus-visible,
  .print:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .pin-hint {
    color: var(--color-ink-soft);
    font-size: var(--font-size-caption);
  }
  .print:hover {
    background: var(--color-forest-deep);
  }
</style>
