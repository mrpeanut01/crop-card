<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import CardView from '$lib/components/cards/CardView.svelte';
  import { OfflineCards } from '$lib/components/cards/offlineCards.svelte';
  import { parseRecordCardKey, recordHref } from '$lib/cards/model';
  import {
    recordKindLabel,
    savedCopyCards,
    savedCopyNotice,
    type SavedRecordCard
  } from '$lib/cards/recordCard';
  import { currentPrefs } from '$lib/prefsState.svelte';
  import { createT } from '$lib/i18n';

  const tr = $derived(createT(page.data?.locale));
  const cards = new OfflineCards();
  const prefs = $derived(currentPrefs());
  const ownerId = $derived(page.data.activeOwner?.id ?? page.data.user?.activeOwnerId ?? null);
  const key = $derived(page.params.key ?? '');
  const parsed = $derived(parseRecordCardKey(key));

  let saved = $state<{ model: SavedRecordCard; savedAt: number } | null>(null);
  let ready = $state(false);
  let pinned = $state(false);
  let pinNote = $state<string | null>(null);
  let now = $state(Date.now());

  async function read() {
    try {
      const store = await import('$lib/client/recordCardStore');
      saved = await store.openRecordCard(key);
      pinned = saved ? await store.isRecordCardPinned(key) : false;
    } catch {
      saved = null;
      pinned = false;
    } finally {
      ready = true;
    }
  }

  $effect(() => {
    if (cards.loaded && key) void read();
  });

  onMount(() => {
    const tick = setInterval(() => (now = Date.now()), 60_000);
    const stop = cards.start(ownerId);
    return () => {
      clearInterval(tick);
      stop();
    };
  });

  async function togglePin() {
    pinNote = null;
    try {
      const store = await import('$lib/client/recordCardStore');
      if (pinned) {
        await store.unpinRecordCard(key);
        pinned = false;
        return;
      }
      const outcome = await store.pinRecordCard(key);
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

  const title = $derived(saved?.model.cards[0]?.title ?? tr('cardsui.rec.untitled'));
</script>

<svelte:head><title>{tr('cardsui.one.titleNamed', { title })}</title></svelte:head>

<nav class="crumbs" aria-label={tr('cardsui.one.breadcrumb')}>
  <a href="/cards">{tr('cardsui.h1')}</a>
  <span aria-hidden="true">›</span>
  <span>{tr('cardsui.rec.heading')}</span>
</nav>

{#if !ready}
  <p class="status" role="status">{tr('cardsui.one.loading')}</p>
{:else if saved}
  <p class="saved-note" role="note" data-testid="saved-copy-notice">
    {savedCopyNotice(saved.savedAt, prefs, tr)}
  </p>
  <p class="kind">{recordKindLabel(saved.model.recordKind, tr)}</p>
  <div class="one">
    {#each savedCopyCards(saved.model) as card (card.key)}
      <CardView {card} {prefs} {now} />
    {/each}
  </div>
  <div class="actions">
    <button
      type="button"
      class="btn ghost"
      data-pinned={pinned}
      aria-describedby="saved-record-pin-hint"
      data-testid="saved-record-pin"
      onclick={togglePin}
    >
      {pinned ? tr('cardsui.rec.unpin') : tr('cardsui.pin')}
    </button>
    <a class="btn ghost" href={recordHref(saved.model.recordKind, saved.model.rowId)}>
      {tr('cardsui.rec.openRecord')}
    </a>
    <a class="btn ghost" href="/cards">{tr('cardsui.one.backCards')}</a>
  </div>
  <p class="pin-hint" id="saved-record-pin-hint" data-testid="saved-record-pin-hint">
    {pinned ? tr('cardsui.rec.pinnedKeptHint') : tr('cardsui.rec.tempHint')}
  </p>
  {#if pinNote}<p class="status" role="status">{pinNote}</p>{/if}
{:else}
  <p class="status" role="status" data-testid="record-not-saved">{tr('cardsui.rec.notSaved')}</p>
  <div class="actions">
    {#if parsed}
      <a class="btn ghost" href={recordHref(parsed.recordKind, parsed.rowId)}
        >{tr('cardsui.rec.openRecord')}</a
      >
    {/if}
    <a class="btn ghost" href="/cards">{tr('cardsui.one.backCards')}</a>
  </div>
{/if}

<style>
  .crumbs {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
    margin-bottom: var(--space-3);
  }
  .crumbs a {
    color: var(--color-forest);
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    min-height: 48px;
  }
  .saved-note {
    margin: 0 0 var(--space-3);
    max-width: 640px;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-input);
    background: var(--pill-wheat-bg);
    border: 1px solid var(--pill-wheat-bd);
    color: var(--pill-wheat-fg);
    font-weight: 600;
  }
  .kind {
    margin: 0 0 var(--space-2);
    color: var(--color-ink-soft);
    font-size: var(--font-size-caption);
    font-weight: 600;
  }
  .one {
    max-width: 640px;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-3) 0;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    min-width: 48px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-input);
    font-size: var(--font-size-body);
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    text-decoration: none;
  }
  .btn.ghost {
    background: var(--color-paper);
    border-color: var(--color-divider);
    color: var(--color-ink);
  }
  .btn.ghost[data-pinned='true'] {
    background: var(--pill-forest-bg);
    border-color: var(--pill-forest-bd);
    color: var(--pill-forest-fg);
  }
  .btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .status {
    color: var(--color-ink-soft);
  }
  .pin-hint {
    margin: var(--space-1) 0 0;
    color: var(--color-ink-soft);
    font-size: var(--font-size-caption);
  }
</style>
