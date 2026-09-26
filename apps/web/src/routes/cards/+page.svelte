<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import CardView from '$lib/components/cards/CardView.svelte';
  import CardPrintSheet from '$lib/components/cards/CardPrintSheet.svelte';
  import InstallNudge from '$lib/components/cards/InstallNudge.svelte';
  import { OfflineCards } from '$lib/components/cards/offlineCards.svelte';
  import { buildDeck } from '$lib/cards/build';
  import { DECK_FILTERS, filterDeck, isDeckFilter, type DeckFilter } from '$lib/cards/deck';
  import type { CardPrintLayout } from '$lib/cards/model';
  import { PRINT_HELP, PRINT_LAYOUTS } from '$lib/cards/print';
  import { installNudgeWanted } from '$lib/client/offlineStorage';
  import { currentPrefs, fmt } from '$lib/prefsState.svelte';

  const cards = new OfflineCards();
  const EMPTY_TEXT: Partial<Record<DeckFilter, string>> = {
    pinned: 'Nothing pinned yet. Pin a card to keep it at the top.',
    spray:
      'Spray cards appear for pesticides you have in stock, one for each calibrated sprayer. Add a product in Inventory to get one.',
    planting: 'No plantings yet. Add one on the Plan page and its card shows up here.',
    area: 'No areas yet. Draw your farm on the Plan page to get area cards.',
    equipment: 'No equipment yet. Add a sprayer or other gear in Inventory.'
  };
  const FILTER_KEY = 'cropcard.cardsFilter';

  let now = $state(Date.now());
  let online = $state(true);
  let filter = $state<DeckFilter>('all');
  let selected = $state<string[]>([]);
  let layout = $state<CardPrintLayout>('letter-4up');
  let showNudge = $state(false);
  let notice = $state<string | null>(null);

  const prefs = $derived(currentPrefs());
  const ownerId = $derived(page.data.activeOwner?.id ?? page.data.user?.activeOwnerId ?? null);
  const snapshot = $derived(cards.row?.bundle ?? null);
  const deck = $derived(snapshot ? buildDeck(snapshot, { prefs, now }) : []);
  const visible = $derived(filterDeck(deck, filter, cards.pinned));
  const printCards = $derived.by(() => {
    const chosen = new Set(selected);
    const picked = deck.filter((c) => chosen.has(c.key));
    return picked.length ? picked : visible;
  });

  onMount(() => {
    online = navigator.onLine;
    const onLine = () => (online = navigator.onLine);
    window.addEventListener('online', onLine);
    window.addEventListener('offline', onLine);
    const tick = setInterval(() => (now = Date.now()), 60_000);
    try {
      const saved = localStorage.getItem(FILTER_KEY);
      if (isDeckFilter(saved)) filter = saved;
    } catch {
      /* no storage */
    }
    const stop = cards.start(ownerId);
    return () => {
      window.removeEventListener('online', onLine);
      window.removeEventListener('offline', onLine);
      clearInterval(tick);
      stop();
    };
  });

  function pickFilter(id: DeckFilter) {
    filter = id;
    try {
      localStorage.setItem(FILTER_KEY, id);
    } catch {
      /* no storage */
    }
  }

  function toggleSelected(key: string) {
    selected = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
  }

  async function saveForOffline() {
    notice = null;
    const outcome = await cards.saveForOffline();
    now = Date.now();
    notice =
      outcome === 'updated' || outcome === 'unchanged'
        ? 'Saved. These cards now open on this device with no signal.'
        : outcome === 'offline'
          ? 'No signal right now. The cards you already saved still work.'
          : 'Could not refresh the cards just now. Try again in a moment.';
    showNudge = installNudgeWanted();
  }

  async function togglePin(key: string) {
    await cards.togglePin(key);
    if (cards.isPinned(key)) showNudge = installNudgeWanted();
  }

  function printSelected() {
    const previous = document.title;
    document.title = 'CropCard cards';
    window.print();
    document.title = previous;
  }
</script>

<svelte:head><title>Cards · CropCard</title></svelte:head>

<div class="no-print">
  <header class="head">
    <div>
      <Kicker>Field cards</Kicker>
      <h1 class="serif">Cards</h1>
      <p class="lede">
        Your farm on cards. They open with no signal and print onto index cards or plain paper.
      </p>
    </div>
    <button
      type="button"
      class="btn primary"
      onclick={saveForOffline}
      disabled={cards.syncing || !online}
    >
      {cards.syncing ? 'Saving…' : 'Save for offline'}
    </button>
  </header>

  <p class="status" role="status" data-testid="cards-status">
    {#if !cards.loaded}
      Loading your cards…
    {:else if cards.row}
      Saved on this device · as of {fmt.instant(cards.row.bundle.generatedAt, 'datetime')}
      {#if !online}· you are offline{/if}
    {:else if online}
      Not saved on this device yet. Tap Save for offline to keep them here.
    {:else}
      These cards have not been saved on this device yet. Open CropCard once with signal and they
      will be ready.
    {/if}
  </p>
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  {#if cards.storageKept === false}
    <p class="notice">
      This browser may clear saved cards when space runs low. Printing a copy is the safe bet.
    </p>
  {/if}
  {#if showNudge}
    <InstallNudge onDismiss={() => (showNudge = false)} />
  {/if}

  <div class="filters" role="group" aria-label="Show cards">
    {#each DECK_FILTERS as f (f.id)}
      <button
        type="button"
        class="chip"
        class:active={filter === f.id}
        aria-pressed={filter === f.id}
        onclick={() => pickFilter(f.id)}
      >
        {f.label}
      </button>
    {/each}
  </div>

  {#if snapshot && visible.length === 0}
    <p class="empty">{EMPTY_TEXT[filter] ?? 'No cards of this kind yet.'}</p>
  {/if}

  <ul class="deck" aria-label="Cards">
    {#each visible as card (card.key)}
      {@const pinned = cards.isPinned(card.key)}
      {@const isSelected = selected.includes(card.key)}
      <li class="slot" class:selected={isSelected}>
        <CardView {card} {prefs} {now} variant="compact" />
        <div class="slot-actions">
          <button
            type="button"
            class="btn ghost"
            aria-pressed={pinned}
            aria-label="{pinned ? 'Unpin' : 'Pin'} {card.title}"
            onclick={() => togglePin(card.key)}
          >
            {pinned ? 'Pinned' : 'Pin'}
          </button>
          <label class="select">
            <input
              type="checkbox"
              checked={isSelected}
              onchange={() => toggleSelected(card.key)}
              aria-label="Select {card.title} for printing"
            />
            <span>Select</span>
          </label>
        </div>
      </li>
    {/each}
  </ul>

  {#if deck.length}
    <section class="print-panel" aria-labelledby="print-heading">
      <h2 id="print-heading">Print</h2>
      <p class="hint">
        {selected.length
          ? `${selected.length} selected.`
          : 'Nothing selected, so every card shown above prints.'}
        {PRINT_HELP}
      </p>
      <fieldset>
        <legend>Paper</legend>
        {#each PRINT_LAYOUTS as l (l.id)}
          <label class="opt">
            <input type="radio" name="layout" value={l.id} bind:group={layout} />
            <span>{l.label}</span>
            <span class="hint">{l.hint}</span>
          </label>
        {/each}
      </fieldset>
      <div class="print-actions">
        <button type="button" class="btn primary" onclick={printSelected}>Print selected</button>
        {#if selected.length}
          <button type="button" class="btn ghost" onclick={() => (selected = [])}>
            Clear selection
          </button>
        {/if}
      </div>
    </section>
  {/if}
</div>

{#if snapshot}
  <CardPrintSheet cards={printCards} {layout} {prefs} {now} origin={snapshot.origin} />
{/if}

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-3);
  }
  h1 {
    margin: var(--space-1) 0;
    font-size: var(--font-size-display);
    color: var(--color-forest-deep);
  }
  .lede {
    margin: 0;
    color: var(--color-ink-soft);
    max-width: 60ch;
  }
  .status,
  .notice,
  .empty {
    margin: var(--space-3) 0 0;
    color: var(--color-ink-soft);
  }
  .notice {
    color: var(--color-ink);
    font-weight: 600;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-4) 0;
  }
  .chip {
    min-height: 48px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    font-weight: 600;
    cursor: pointer;
  }
  .chip.active {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: #fff;
  }
  .deck {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
    gap: var(--space-3);
  }
  .slot {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .slot.selected :global(.cardview) {
    box-shadow: 0 0 0 2px var(--color-forest);
  }
  .slot-actions {
    display: flex;
    gap: var(--space-2);
    align-items: stretch;
  }
  .btn {
    min-height: 48px;
    min-width: 48px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-input);
    font-size: var(--font-size-body);
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .btn.primary {
    background: var(--color-forest);
    color: #fff;
  }
  .btn.primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .btn.ghost {
    background: var(--color-paper);
    border-color: var(--color-divider);
    color: var(--color-ink);
  }
  .btn.ghost[aria-pressed='true'] {
    background: var(--pill-forest-bg);
    border-color: var(--pill-forest-bd);
    color: var(--pill-forest-fg);
  }
  .btn:focus-visible,
  .chip:focus-visible,
  .select:focus-within {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .select {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 48px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    cursor: pointer;
  }
  .select input {
    width: 22px;
    height: 22px;
    accent-color: var(--color-forest);
  }
  .print-panel {
    margin-top: var(--space-6);
    padding: var(--card-padding-loose);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
  }
  .print-panel h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-card-title);
  }
  .hint {
    color: var(--color-ink-soft);
    font-size: var(--font-size-caption);
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: var(--space-3) 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  legend {
    font-weight: 600;
    margin-bottom: var(--space-1);
  }
  .opt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-height: 48px;
  }
  .opt input {
    width: 22px;
    height: 22px;
    accent-color: var(--color-forest);
  }
  .print-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
