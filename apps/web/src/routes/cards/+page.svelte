<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import CardView from '$lib/components/cards/CardView.svelte';
  import CardPrintSheet from '$lib/components/cards/CardPrintSheet.svelte';
  import InstallNudge from '$lib/components/cards/InstallNudge.svelte';
  import Hint from '$lib/components/ui/Hint.svelte';
  import { markHintSeen } from '$lib/client/hints';
  import { OfflineCards } from '$lib/components/cards/offlineCards.svelte';
  import { barnPinKeys, buildDeck } from '$lib/cards/build';
  import {
    DECK_FILTERS,
    filterDeck,
    foldMembers,
    isDeckFilter,
    type DeckFilter
  } from '$lib/cards/deck';
  import { parseCardKey } from '$lib/cards/model';
  import type { CardPrintLayout } from '$lib/cards/model';
  import { PRINT_LAYOUTS } from '$lib/cards/print';
  import { installNudgeWanted } from '$lib/client/offlineStorage';
  import { currentPrefs, fmt } from '$lib/prefsState.svelte';
  import { recordKindLabel, savedRecordHref } from '$lib/cards/recordCard';
  import type { SavedRecordCardRow } from '$lib/client/recordCardStore';
  import { createT } from '$lib/i18n';

  const tr = $derived(createT(page.data?.locale));
  const cards = new OfflineCards();
  const FILTER_LABEL_KEYS = {
    all: 'cardsui.filter.all',
    pinned: 'cardsui.filter.pinned',
    today: 'cardsui.filter.today',
    animals: 'cardsui.filter.animals',
    planting: 'cardsui.filter.planting',
    area: 'cardsui.filter.area',
    equipment: 'cardsui.filter.equipment',
    spray: 'cardsui.filter.spray',
    careGuide: 'cardsui.filter.careGuide'
  } as const;
  const LAYOUT_KEYS = {
    'letter-4up': {
      label: 'cardsui.layout.letter4up.label',
      hint: 'cardsui.layout.letter4up.hint'
    },
    'index-3x5': { label: 'cardsui.layout.index3x5.label', hint: 'cardsui.layout.index3x5.hint' },
    'index-4x6': { label: 'cardsui.layout.index4x6.label', hint: 'cardsui.layout.index4x6.hint' },
    'letter-landscape': {
      label: 'cardsui.layout.landscape.label',
      hint: 'cardsui.layout.landscape.hint'
    }
  } as const;
  const EMPTY_STATE = {
    all: {
      text: 'cardsui.empty.all',
      href: '/plan',
      action: 'cardsui.empty.openPlan'
    },
    pinned: { text: 'cardsui.empty.pinned' },
    today: {
      text: 'cardsui.empty.today',
      href: '/plan',
      action: 'cardsui.empty.openPlan'
    },
    animals: {
      text: 'cardsui.empty.animals',
      href: '/animals/add',
      action: 'cardsui.empty.addAnimals'
    },
    spray: {
      text: 'cardsui.empty.spray',
      href: '/inventory/pesticide/add',
      action: 'cardsui.empty.addPesticide'
    },
    planting: {
      text: 'cardsui.empty.planting',
      href: '/plan',
      action: 'cardsui.empty.addPlanting'
    },
    area: {
      text: 'cardsui.empty.area',
      href: '/plan/farm',
      action: 'cardsui.empty.drawFarm'
    },
    equipment: {
      text: 'cardsui.empty.equipment',
      href: '/equipment?add=sprayer',
      action: 'cardsui.empty.addSprayer'
    },
    careGuide: {
      text: 'cardsui.empty.careGuide',
      href: '/plan',
      action: 'cardsui.empty.addPlanting'
    }
  } as const;
  const FILTER_KEY = 'cropcard.cardsFilter';

  let now = $state(Date.now());
  let online = $state(true);
  let filter = $state<DeckFilter>('all');
  let selected = $state<string[]>([]);
  let layout = $state<CardPrintLayout>('letter-4up');
  let showNudge = $state(false);
  let notice = $state<string | null>(null);
  let unsynced = $state<ReadonlySet<string>>(new Set());
  let savedRecords = $state<{ row: SavedRecordCardRow; pinned: boolean }[]>([]);

  async function loadSavedRecords() {
    try {
      const { listSavedRecordCards } = await import('$lib/client/recordCardStore');
      const { pinned, recent } = await listSavedRecordCards();
      savedRecords = [
        ...pinned.map((row) => ({ row, pinned: true })),
        ...recent.map((row) => ({ row, pinned: false }))
      ];
    } catch {
      savedRecords = [];
    }
  }
  $effect(() => {
    if (cards.loaded) void loadSavedRecords();
  });

  async function refreshUnsynced() {
    const { loadUnsyncedSubjects } = await import('$lib/client/animalHold');
    unsynced = await loadUnsyncedSubjects(cards.row?.bundle ?? null);
  }
  $effect(() => {
    if (cards.row) void refreshUnsynced();
  });

  const prefs = $derived(currentPrefs());
  const ownerId = $derived(page.data.activeOwner?.id ?? page.data.user?.activeOwnerId ?? null);
  const snapshot = $derived(cards.row?.bundle ?? null);
  const deck = $derived(
    snapshot ? buildDeck(snapshot, { prefs, now, unsyncedAnimalSubjects: unsynced }) : []
  );
  const visible = $derived(filterDeck(deck, filter, cards.pinned));
  const shownRecords = $derived(
    filter === 'pinned' ? savedRecords.filter((r) => r.pinned) : savedRecords
  );
  const slots = $derived(foldMembers(visible));
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
    const tick = setInterval(() => {
      now = Date.now();
      if (cards.row) void refreshUnsynced();
    }, 60_000);
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
    void markHintSeen('cards_offline');
    const outcome = await cards.saveForOffline();
    now = Date.now();
    notice =
      outcome === 'updated' || outcome === 'unchanged'
        ? tr('cardsui.saved')
        : outcome === 'offline'
          ? tr('cardsui.noSignal')
          : tr('cardsui.refreshFailed');
    showNudge = installNudgeWanted();
  }

  async function togglePin(key: string) {
    await cards.togglePin(key);
    if (cards.isPinned(key)) showNudge = installNudgeWanted();
  }

  function barnKeys(flockKey: string): string[] {
    const parsed = parseCardKey(flockKey);
    return snapshot && parsed?.kind === 'flock' ? barnPinKeys(snapshot, parsed.id) : [];
  }

  async function toggleBarn(flockKey: string) {
    const keys = barnKeys(flockKey);
    if (cards.allPinned(keys)) {
      await cards.unpinAll(keys);
      return;
    }
    await cards.pinAll(keys);
    showNudge = installNudgeWanted();
  }

  function printSelected() {
    const previous = document.title;
    document.title = tr('cardsui.printTitle');
    window.print();
    document.title = previous;
  }
</script>

<svelte:head><title>{tr('cardsui.title')}</title></svelte:head>

<div class="no-print">
  <header class="head">
    <div>
      <Kicker>{tr('cardsui.kicker')}</Kicker>
      <h1 class="serif">{tr('cardsui.h1')}</h1>
      <p class="lede">
        {tr('cardsui.lede')}
      </p>
    </div>
    <button
      type="button"
      class="btn primary"
      data-hint-anchor="cards_offline"
      onclick={saveForOffline}
      disabled={cards.syncing || !online}
    >
      {cards.syncing ? tr('cardsui.saving') : tr('cardsui.saveOffline')}
    </button>
  </header>

  <p class="status" role="status" data-testid="cards-status">
    {#if !cards.loaded}
      {tr('cardsui.loading')}
    {:else if cards.row}
      {tr('cardsui.savedOnDevice', {
        date: fmt.instant(cards.row.bundle.generatedAt, 'datetime')
      })}
      {#if !online}{tr('cardsui.youAreOffline')}{/if}
    {:else if online}
      {tr('cardsui.notSaved')}
    {:else}
      {tr('cardsui.notSavedOffline')}
    {/if}
  </p>
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  {#if cards.storageKept === false}
    <p class="notice">
      {tr('cardsui.storageWarn')}
    </p>
  {/if}
  {#if online}
    <Hint
      key="cards_offline"
      anchor="[data-hint-anchor=cards_offline]"
      text={tr('cardsui.hint')}
      suppressed={showNudge}
    />
  {/if}
  {#if showNudge}
    <InstallNudge onDismiss={() => (showNudge = false)} />
  {/if}

  <div class="filters" role="group" aria-label={tr('cardsui.showCards')}>
    {#each DECK_FILTERS as f (f.id)}
      <button
        type="button"
        class="chip"
        class:active={filter === f.id}
        aria-pressed={filter === f.id}
        onclick={() => pickFilter(f.id)}
      >
        {tr(FILTER_LABEL_KEYS[f.id])}
      </button>
    {/each}
  </div>

  {#if snapshot && visible.length === 0 && !(filter === 'pinned' && shownRecords.length)}
    {@const empty = EMPTY_STATE[filter]}
    <p class="empty">{tr(empty.text)}</p>
    {#if 'href' in empty && online}
      <a class="empty-action" href={empty.href}>{tr(empty.action)}</a>
    {/if}
  {/if}

  {#snippet slotActions(card: (typeof visible)[number])}
    {@const pinned = cards.isPinned(card.key)}
    {@const isSelected = selected.includes(card.key)}
    <div class="slot-actions">
      <button
        type="button"
        class="btn ghost"
        aria-pressed={pinned}
        aria-label={tr(pinned ? 'cardsui.unpinNamed' : 'cardsui.pinNamed', { title: card.title })}
        onclick={() => togglePin(card.key)}
      >
        {pinned ? tr('cardsui.pinned') : tr('cardsui.pin')}
      </button>
      <label class="select">
        <input
          type="checkbox"
          checked={isSelected}
          onchange={() => toggleSelected(card.key)}
          aria-label={tr('cardsui.selectForPrint', { title: card.title })}
        />
        <span>{tr('cardsui.select')}</span>
      </label>
    </div>
  {/snippet}

  <ul class="deck" aria-label={tr('cardsui.h1')}>
    {#each slots as slot (slot.card.key)}
      {@const card = slot.card}
      {@const isSelected = selected.includes(card.key)}
      <li class="slot" class:selected={isSelected}>
        <CardView {card} {prefs} {now} variant="compact" />
        {@render slotActions(card)}
        {#if card.kind === 'flock'}
          {@const barn = cards.allPinned(barnKeys(card.key))}
          <button
            type="button"
            class="btn ghost barn"
            aria-pressed={barn}
            data-testid="pin-barn"
            onclick={() => toggleBarn(card.key)}
          >
            {barn ? tr('cardsui.barnPinned') : tr('cardsui.barnPin')}
          </button>
        {/if}
        {#if slot.members.length}
          <details class="members" data-testid="flock-members">
            <summary>{tr('cardsui.members', { count: slot.members.length })}</summary>
            <ul class="member-list" aria-label={tr('cardsui.membersOf', { title: card.title })}>
              {#each slot.members as member (member.key)}
                <li class="slot" class:selected={selected.includes(member.key)}>
                  <CardView card={member} {prefs} {now} variant="compact" />
                  {@render slotActions(member)}
                </li>
              {/each}
            </ul>
          </details>
        {/if}
      </li>
    {/each}
  </ul>

  {#if shownRecords.length}
    <section class="saved-records" aria-labelledby="saved-records-heading">
      <h2 id="saved-records-heading">{tr('cardsui.rec.heading')}</h2>
      <ul class="saved-list" data-testid="saved-records">
        {#each shownRecords as item (item.row.key)}
          {@const meta = {
            kind: recordKindLabel(item.row.model.recordKind, tr),
            date: fmt.instant(item.row.savedAt, 'date')
          }}
          <li>
            <a class="saved-link" href={savedRecordHref(item.row.key)}>
              <span class="saved-title"
                >{item.row.model.cards[0]?.title ?? tr('cardsui.rec.untitled')}</span
              >
              <span class="saved-meta">
                {item.pinned ? tr('cardsui.rec.metaPinned', meta) : tr('cardsui.rec.meta', meta)}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if deck.length}
    <section class="print-panel" aria-labelledby="print-heading">
      <h2 id="print-heading">{tr('cardsui.print')}</h2>
      <p class="hint">
        {selected.length
          ? tr('cardsui.nSelected', { count: selected.length })
          : tr('cardsui.nothingSelected')}
        {tr('cardsui.printHelp')}
      </p>
      <fieldset>
        <legend>{tr('cardsui.paper')}</legend>
        {#each PRINT_LAYOUTS as l (l.id)}
          <label class="opt">
            <input type="radio" name="layout" value={l.id} bind:group={layout} />
            <span>{tr(LAYOUT_KEYS[l.id].label)}</span>
            <span class="hint">{tr(LAYOUT_KEYS[l.id].hint)}</span>
          </label>
        {/each}
      </fieldset>
      <div class="print-actions">
        <button type="button" class="btn primary" onclick={printSelected}
          >{tr('cardsui.printSelected')}</button
        >
        {#if selected.length}
          <button type="button" class="btn ghost" onclick={() => (selected = [])}>
            {tr('cardsui.clearSelection')}
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
  .empty-action {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    font-weight: 600;
    color: var(--color-forest);
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
  .members summary {
    min-height: 48px;
    display: flex;
    align-items: center;
    font-weight: 600;
    cursor: pointer;
    color: var(--color-forest);
  }
  .member-list {
    list-style: none;
    margin: 0;
    padding: 0 0 0 var(--space-2);
    display: grid;
    gap: var(--space-3);
    border-left: 2px solid var(--color-divider);
  }
  .barn {
    width: 100%;
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
  .members summary:focus-visible,
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
  .saved-records {
    margin-top: var(--space-6);
  }
  .saved-records h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-card-title);
  }
  .saved-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .saved-link {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 48px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    color: var(--color-ink);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .saved-link:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .saved-title {
    font-weight: 600;
    color: var(--color-forest-deep);
  }
  .saved-meta {
    color: var(--color-ink-soft);
    font-size: var(--font-size-caption);
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
