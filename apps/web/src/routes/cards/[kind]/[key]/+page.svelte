<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import CardView from '$lib/components/cards/CardView.svelte';
  import CardPrintSheet from '$lib/components/cards/CardPrintSheet.svelte';
  import InstallNudge from '$lib/components/cards/InstallNudge.svelte';
  import CareGuideList from '$lib/components/cards/CareGuideList.svelte';
  import PhotoHelp from '$lib/components/cards/PhotoHelp.svelte';
  import { careGuideCardsFor, photoHelpTargets } from '$lib/journal/targets';
  import { OfflineCards } from '$lib/components/cards/offlineCards.svelte';
  import { buildCard } from '$lib/cards/build';
  import { CARD_KIND_LABEL, isCardKind, type CardPrintLayout } from '$lib/cards/model';
  import { PRINT_HELP, PRINT_LAYOUTS } from '$lib/cards/print';
  import { installNudgeWanted } from '$lib/client/offlineStorage';
  import { currentPrefs } from '$lib/prefsState.svelte';

  const cards = new OfflineCards();

  let now = $state(Date.now());
  let layout = $state<CardPrintLayout>('index-4x6');
  let showNudge = $state(false);

  const prefs = $derived(currentPrefs());
  const ownerId = $derived(page.data.activeOwner?.id ?? page.data.user?.activeOwnerId ?? null);
  const key = $derived(page.params.key ?? '');
  const kind = $derived(page.params.kind ?? '');
  const snapshot = $derived(cards.row?.bundle ?? null);
  const card = $derived.by(() => {
    if (!snapshot || !isCardKind(kind)) return null;
    const built = buildCard(snapshot, key, { prefs, now });
    return built && built.kind === kind ? built : null;
  });
  const pinned = $derived(cards.isPinned(key));
  const careCards = $derived(
    snapshot && card ? careGuideCardsFor(snapshot, key, { prefs, now }) : []
  );
  const helpTargets = $derived(
    snapshot && card ? photoHelpTargets(snapshot, key, { prefs, now }) : []
  );
  const role = $derived((page.data.user?.role as string | undefined) ?? null);

  onMount(() => {
    const tick = setInterval(() => (now = Date.now()), 60_000);
    const stop = cards.start(ownerId);
    return () => {
      clearInterval(tick);
      stop();
    };
  });

  async function togglePin() {
    await cards.togglePin(key);
    if (cards.isPinned(key)) showNudge = installNudgeWanted();
  }

  function print() {
    if (!card) return;
    const previous = document.title;
    document.title = card.title;
    window.print();
    document.title = previous;
  }
</script>

<svelte:head><title>{card ? `${card.title} · Cards` : 'Card'} · CropCard</title></svelte:head>

<div class="no-print">
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="/cards">Cards</a>
    {#if isCardKind(kind)}<span aria-hidden="true">›</span>
      <span>{CARD_KIND_LABEL[kind]}</span>{/if}
  </nav>

  {#if !cards.loaded}
    <p class="status" role="status">Loading the card…</p>
  {:else if card}
    <div class="one">
      <CardView {card} {prefs} {now} />
    </div>
    <div class="actions">
      <button type="button" class="btn ghost" aria-pressed={pinned} onclick={togglePin}>
        {pinned ? 'Pinned' : 'Pin'}
      </button>
      <button type="button" class="btn primary" onclick={print}>Print this card</button>
    </div>
    {#if cards.storageKept === false}
      <p class="status">
        This browser may clear saved cards when space runs low. Printing a copy is the safe bet.
      </p>
    {/if}
    {#if showNudge}
      <InstallNudge onDismiss={() => (showNudge = false)} />
    {/if}
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
    <p class="hint">{PRINT_HELP}</p>
    <CareGuideList cards={careCards} {prefs} {now} />
    {#key key}
      <PhotoHelp targets={helpTargets} {role} {prefs} />
    {/key}
  {:else if snapshot}
    <p class="status" role="status">
      This card is not in the copy saved on this device. It may be new since the last save, or it no
      longer exists. <a href="/cards">Back to your cards</a>
    </p>
  {:else}
    <p class="status" role="status">
      Your cards have not been saved on this device yet. Open CropCard once with signal and they
      will be ready. <a href="/cards">Go to Cards</a>
    </p>
  {/if}
</div>

{#if card && snapshot}
  <CardPrintSheet cards={[card]} {layout} {prefs} {now} origin={snapshot.origin} />
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
  .one {
    max-width: 640px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-3) 0;
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
  .btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .status {
    color: var(--color-ink-soft);
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
  .hint {
    color: var(--color-ink-soft);
    font-size: var(--font-size-caption);
  }
</style>
