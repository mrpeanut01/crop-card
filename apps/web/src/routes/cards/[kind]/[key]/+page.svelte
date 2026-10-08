<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import CardView from '$lib/components/cards/CardView.svelte';
  import CardPrintSheet from '$lib/components/cards/CardPrintSheet.svelte';
  import InstallNudge from '$lib/components/cards/InstallNudge.svelte';
  import CareGuideList from '$lib/components/cards/CareGuideList.svelte';
  import PhotoHelp from '$lib/components/cards/PhotoHelp.svelte';
  import { careGuideCardsFor, photoHelpTargets } from '$lib/journal/targets';
  import { OfflineCards } from '$lib/components/cards/offlineCards.svelte';
  import { barnPinKeys, buildCard } from '$lib/cards/build';
  import { isCardKind, type CardPrintLayout } from '$lib/cards/model';
  import { PRINT_LAYOUTS, isCalendarKind, needsFullPage, printLinkFor } from '$lib/cards/print';
  import { wholePrintParts } from '$lib/cards/printPack';
  import { CARD_KIND_LABEL_KEYS } from '$lib/components/cards/kindLabels';
  import { createT } from '$lib/i18n';
  import { installNudgeWanted } from '$lib/client/offlineStorage';
  import { currentPrefs } from '$lib/prefsState.svelte';
  import { cardViewParams, snapshotOlderThan, withoutPrintParam } from '$lib/cards/viewParams';
  import { formatInstant } from '$lib/prefs';
  import { outsideWindowNote, periodTodayHref } from '$lib/cards/build/calendar';
  import FlockQuickActions from '$lib/components/animals/FlockQuickActions.svelte';
  import SeedStartPanel from '$lib/components/cards/SeedStartPanel.svelte';
  import PlantingHours from '$lib/components/cards/PlantingHours.svelte';
  import OrchardPanel from '$lib/components/orchard/OrchardPanel.svelte';
  import TaskTimer from '$lib/components/tasks/TaskTimer.svelte';
  import { isClosedStatus, type TaskStatus } from '$lib/tasks/status';

  const tr = $derived(createT(page.data?.locale));
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
  const cards = new OfflineCards();
  const FRESH_PRINT_WAIT_MS = 5000;

  let now = $state(Date.now());
  let unsynced = $state<ReadonlySet<string>>(new Set());

  async function refreshUnsynced() {
    const { loadUnsyncedSubjects } = await import('$lib/client/animalHold');
    unsynced = await loadUnsyncedSubjects(cards.row?.bundle ?? null);
  }
  $effect(() => {
    if (cards.row) void refreshUnsynced();
  });

  let queuedClose = $state(false);
  async function refreshQueuedClose(taskId: string) {
    try {
      const { listQueuedTaskActions } = await import('$lib/client/taskQueue');
      const rows = await listQueuedTaskActions();
      queuedClose = rows.some((r) => r.taskId === taskId && !r.rejected);
    } catch {
      queuedClose = false;
    }
  }
  $effect(() => {
    if (kind === 'task' && cards.row) void refreshQueuedClose(key.slice(key.indexOf('_') + 1));
  });
  let layout = $state<CardPrintLayout>('index-4x6');
  let showNudge = $state(false);

  const prefs = $derived(currentPrefs());
  const ownerId = $derived(page.data.activeOwner?.id ?? page.data.user?.activeOwnerId ?? null);
  const key = $derived(page.params.key ?? '');
  const kind = $derived(page.params.kind ?? '');
  const snapshot = $derived(cards.row?.bundle ?? null);
  const view = $derived(cardViewParams(page.url.searchParams, kind));
  const card = $derived.by(() => {
    if (!snapshot || !isCardKind(kind)) return null;
    const built = buildCard(snapshot, key, {
      prefs,
      now,
      bedMapOnMs: view.bedMapOnMs,
      unsyncedAnimalSubjects: unsynced,
      area: view.area,
      who: view.who
    });
    return built && built.kind === kind ? built : null;
  });
  const printParts = $derived.by(() => {
    if (!card?.printWhole || !snapshot) return 1;
    const link = printLinkFor(snapshot.origin, card.key);
    return wholePrintParts(card, layout, {
      locale: page.data?.locale,
      qr: !!link,
      url: link?.url ?? null
    }).length;
  });
  const taskOpen = $derived(
    !queuedClose && !(card?.status && isClosedStatus(card.status.id as TaskStatus))
  );

  let autoPrinted = $state(false);
  let freshWaitOver = $state(false);
  let printNotice = $state('');
  $effect(() => {
    if (!view.autoPrint || !card || !snapshot || autoPrinted) return;
    const older = snapshotOlderThan(snapshot.generatedAt, view.afterMs);
    if (older && !freshWaitOver) return;
    autoPrinted = true;
    printNotice = older
      ? tr('cardsui.one.printingCopy', {
          time: formatInstant(snapshot.generatedAt, prefs, 'time')
        })
      : '';
    replaceState(withoutPrintParam(new URL(page.url.href)), page.state);
    void tick().then(print);
  });
  const pinned = $derived(cards.isPinned(key));
  const barnKeys = $derived(
    snapshot && card?.kind === 'flock' ? barnPinKeys(snapshot, key.slice(key.indexOf('_') + 1)) : []
  );
  const barnPinned = $derived(cards.allPinned(barnKeys));

  async function toggleBarn() {
    if (barnPinned) {
      await cards.unpinAll(barnKeys);
      return;
    }
    await cards.pinAll(barnKeys);
    showNudge = installNudgeWanted();
  }
  const careCards = $derived(
    snapshot && card ? careGuideCardsFor(snapshot, key, { prefs, now }) : []
  );
  const helpTargets = $derived(
    snapshot && card ? photoHelpTargets(snapshot, key, { prefs, now }) : []
  );
  const role = $derived((page.data.user?.role as string | undefined) ?? null);

  onMount(() => {
    const tick = setInterval(() => (now = Date.now()), 60_000);
    const freshWait = setTimeout(() => (freshWaitOver = true), FRESH_PRINT_WAIT_MS);
    const stop = cards.start(ownerId);
    return () => {
      clearInterval(tick);
      clearTimeout(freshWait);
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

<svelte:head
  ><title
    >{card
      ? tr('cardsui.one.titleNamed', { title: card.title })
      : tr('cardsui.one.titleBare')}</title
  ></svelte:head
>

<div class="no-print">
  <nav class="crumbs" aria-label={tr('cardsui.one.breadcrumb')}>
    <a href="/cards">{tr('cardsui.h1')}</a>
    {#if isCardKind(kind)}<span aria-hidden="true">›</span>
      <span>{tr(CARD_KIND_LABEL_KEYS[kind])}</span>{/if}
  </nav>

  {#if !cards.loaded}
    <p class="status" role="status">{tr('cardsui.one.loading')}</p>
  {:else if card}
    <div class="one">
      <CardView {card} {prefs} {now} />
    </div>
    {#if printNotice}
      <p class="status" role="status" data-testid="print-notice">{printNotice}</p>
    {:else if view.autoPrint && !autoPrinted && snapshot && snapshotOlderThan(snapshot.generatedAt, view.afterMs)}
      <p class="status" role="status">{tr('cardsui.one.gettingLatest')}</p>
    {/if}
    <div class="actions">
      <button type="button" class="btn ghost" aria-pressed={pinned} onclick={togglePin}>
        {pinned ? tr('cardsui.pinned') : tr('cardsui.pin')}
      </button>
      {#if barnKeys.length > 1}
        <button type="button" class="btn ghost" aria-pressed={barnPinned} onclick={toggleBarn}>
          {barnPinned ? tr('cardsui.barnPinned') : tr('cardsui.barnPin')}
        </button>
      {/if}
      <button type="button" class="btn primary" onclick={print}
        >{tr('cardsui.one.printThis')}</button
      >
    </div>
    {#if cards.storageKept === false}
      <p class="status">
        {tr('cardsui.storageWarn')}
      </p>
    {/if}
    {#if showNudge}
      <InstallNudge onDismiss={() => (showNudge = false)} />
    {/if}
    {#if needsFullPage(card)}
      <p class="hint" data-testid="full-page-note">
        {isCalendarKind(card.kind)
          ? tr('cardsui.one.landscapeNote')
          : tr('cardsui.one.fullPageNote')}
      </p>
    {:else}
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
      {#if printParts > 1}
        <p class="hint" data-testid="print-parts-note">
          {tr('cardsui.printsAs', { n: printParts })}
        </p>
      {/if}
    {/if}
    <p class="hint">{tr('cardsui.printHelp')}</p>
    {#if card.kind === 'flock' && snapshot}
      <FlockQuickActions
        {snapshot}
        groupId={key.slice(key.indexOf('_') + 1)}
        {role}
        {prefs}
        {now}
        {unsynced}
        onChange={refreshUnsynced}
      />
    {/if}
    {#if card.kind === 'task' && page.data.user?.id}
      <div class="task-timer">
        <TaskTimer
          taskId={key.slice(key.indexOf('_') + 1)}
          taskTitle={card.title}
          userId={page.data.user.id}
          canAct={role !== null && role !== 'inspector'}
          open={taskOpen}
        />
      </div>
    {/if}
    {#if card.kind === 'planting' && snapshot}
      <SeedStartPanel {snapshot} plantingId={key.slice(key.indexOf('_') + 1)} {role} />
      <PlantingHours plantingId={key.slice(key.indexOf('_') + 1)} {role} />
      <OrchardPanel cropId={key.slice(key.indexOf('_') + 1)} {snapshot} />
    {/if}
    {#if card.kind === 'area' && snapshot}
      <OrchardPanel areaId={key.slice(key.indexOf('_') + 1)} {snapshot} />
    {/if}
    <CareGuideList cards={careCards} {prefs} {now} />
    {#key key}
      <PhotoHelp targets={helpTargets} {role} {prefs} sprayTerms={snapshot?.sprayTerms ?? []} />
    {/key}
  {:else if snapshot && (kind === 'week' || kind === 'month')}
    <p class="status" role="status" data-testid="calendar-outside-window">
      {outsideWindowNote(page.data?.locale)}
      <a href={periodTodayHref(kind, key)}>{tr('cardsui.one.backToday')}</a> ·
      <a href="/cards">{tr('cardsui.one.backCards')}</a>
    </p>
  {:else if snapshot}
    <p class="status" role="status">
      {tr('cardsui.one.notInCopy')} <a href="/cards">{tr('cardsui.one.backCards')}</a>
    </p>
  {:else}
    <p class="status" role="status">
      {tr('cardsui.one.notSavedYet')} <a href="/cards">{tr('cardsui.one.goCards')}</a>
    </p>
  {/if}
</div>

{#if card && snapshot}
  <CardPrintSheet cards={[card]} {layout} {prefs} {now} origin={snapshot.origin} />
{/if}

<style>
  .task-timer {
    max-width: 640px;
    margin: var(--space-3) 0;
  }
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
