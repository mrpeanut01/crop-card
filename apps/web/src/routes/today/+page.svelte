<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll, replaceState } from '$app/navigation';
  import type { CalendarEvent } from '$lib/calendar/engine';
  import type { Task } from '$lib/db/tasks';
  import { STOCK_CATEGORY_TO_INVENTORY_TYPE } from '$lib/inventory/types';
  import Banner from '$lib/components/ui/Banner.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import ProvenanceLegend from '$lib/components/ui/ProvenanceLegend.svelte';
  import WeatherStrip from '$lib/components/today/WeatherStrip.svelte';
  import TodayHero from '$lib/components/today/TodayHero.svelte';
  import QuickActions from '$lib/components/today/QuickActions.svelte';
  import WeekStrip, { type WeekItem, type WeekKind } from '$lib/components/today/WeekStrip.svelte';
  import SeasonStrip from '$lib/components/today/SeasonStrip.svelte';
  import TaskDeckCard, { type LinkedTaskItem } from '$lib/components/today/TaskDeckCard.svelte';
  import Recommendations, {
    type RecommendationItem
  } from '$lib/components/today/Recommendations.svelte';
  import SeasonGlance from '$lib/components/today/SeasonGlance.svelte';
  import GettingStartedCard from '$lib/components/today/GettingStartedCard.svelte';
  import { buildTaskCard } from '$lib/cards/build/task';
  import { taskPlanHref } from '$lib/cards/build/common';
  import { cardHref, cardKey } from '$lib/cards/model';
  import { taskStart } from '$lib/tasks/start';
  import type { QueuedTaskAction } from '$lib/tasks/status';
  import {
    TODAY_WINDOWS,
    buildTaskDeck,
    calendarItems,
    deckCounts,
    eventsForWindow,
    periodForWindow,
    type TodayView,
    type TodayWindow,
    type WeekPeriod
  } from '$lib/today/deck';
  import type { QueuedTaskRow } from '$lib/client/taskQueue';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';

  const { data } = $props();

  const aiEnabled = $derived(data.aiEnabled);
  const prefs = $derived(currentPrefs());
  const canAct = $derived(!!data.user && data.user.role !== 'inspector');

  const todayDateLabel = $derived(fmt.instant(data.nowMs, 'date-long', { year: undefined }));
  const greeting = $derived.by(() => {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone: prefs.timeZone
      }).format(new Date(data.nowMs))
    );
    const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    return `Good ${part}.`;
  });

  // svelte-ignore state_referenced_locally
  let deckWindow = $state<TodayWindow>(data.deckWindow);
  // svelte-ignore state_referenced_locally
  let view = $state<TodayView>(data.view);
  // svelte-ignore state_referenced_locally
  let calPeriod = $state<WeekPeriod>(periodForWindow(data.deckWindow));

  let queuedRows = $state<QueuedTaskRow[]>([]);
  const queued = $derived.by(() => {
    const m = new Map<string, QueuedTaskAction>();
    for (const r of queuedRows) if (!r.rejected) m.set(r.taskId, r.action);
    return m;
  });
  const rejected = $derived(new Set(queuedRows.filter((r) => r.rejected).map((r) => r.taskId)));

  const tasks = $derived(data.deckTasks as Task[]);
  const entries = $derived(
    buildTaskDeck(tasks, {
      window: deckWindow,
      now: data.nowMs,
      timeZone: prefs.timeZone,
      queued
    })
  );
  const counts = $derived(deckCounts(entries));
  const summary = $derived.by(() => {
    const parts: string[] = [];
    if (counts.late) parts.push(`${counts.late} late`);
    if (counts.dueToday) parts.push(`${counts.dueToday} due today`);
    if (counts.planned) parts.push(`${counts.planned} planned`);
    if (counts.done) parts.push(`${counts.done} done`);
    if (counts.skipped) parts.push(`${counts.skipped} skipped`);
    return parts.join(' · ');
  });

  const subtitle = $derived.by(() => {
    const open = counts.late + counts.dueToday;
    if (data.priorityAction) {
      return open > 1
        ? `One thing to do first, then ${open - 1} more on the list.`
        : 'One thing to do today.';
    }
    return 'Nothing scheduled today. Check the list below for what is coming.';
  });

  function whereFor(t: Task): string | null {
    const planting = t.cropId ? data.plantingNames[t.cropId] : undefined;
    const blockId = t.blockId ?? planting?.blockId;
    const block = blockId ? data.blockNames[blockId] : undefined;
    const parts = [planting?.name, block].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  }

  function cardFor(t: Task, linked: Task[]) {
    const planting = t.cropId ? data.plantingNames[t.cropId] : undefined;
    return buildTaskCard(
      t,
      {
        where: whereFor(t),
        equipmentLabel: t.equipmentId ? (data.equipmentLabels[t.equipmentId] ?? null) : null,
        before: linked.filter((l) => l.kind === 'pre-task').map((l) => l.title),
        after: linked.filter((l) => l.kind === 'post-task').map((l) => l.title),
        queued: queued.get(t.id) ?? null,
        asOf: data.nowMs,
        href: taskPlanHref(t.blockId ?? planting?.blockId ?? null)
      },
      { now: data.nowMs, prefs }
    );
  }

  const deck = $derived(
    entries.map((e) => ({
      entry: e,
      card: cardFor(
        e.task,
        e.linked.map((l) => l.task)
      ),
      start: taskStart(e.task),
      linked: e.linked.map((l): LinkedTaskItem => ({
        id: l.task.id,
        title: l.task.title,
        kind: l.task.kind === 'post-task' ? 'post-task' : 'pre-task',
        status: l.status,
        queued: l.queued !== null
      }))
    }))
  );

  const windowEvents = $derived(
    eventsForWindow(
      data.seasonEvents as CalendarEvent[],
      data.eventsToday as CalendarEvent[],
      deckWindow,
      data.nowMs
    )
  );

  const DECK_HEADINGS: Record<TodayWindow, string> = {
    today: "Today's work",
    '7d': 'The next 7 days',
    '30d': 'The next 30 days',
    season: 'The season ahead'
  };

  function weekKindForTask(t: Task): WeekKind {
    switch (t.relatedEventTable) {
      case 'spray_event':
      case 'insecticide_event':
      case 'fungicide_event':
        return 'spray';
      case 'harvest_event':
      case 'hay_cutting':
        return 'harvest';
      case 'fertility_application':
        return 'fertility';
    }
    switch (t.category) {
      case 'spray':
        return 'spray';
      case 'scout':
        return 'scout';
      case 'harvest':
      case 'hay-cutting':
        return 'harvest';
      case 'fertilize':
        return 'fertility';
      case 'plant':
        return 'planting';
      default:
        return 'task';
    }
  }
  function weekKindForEvent(e: CalendarEvent): WeekKind {
    switch (e.kind) {
      case 'spray-window':
        return 'spray';
      case 'harvest-window':
      case 'curing-ready':
        return 'harvest';
      case 'planting':
      case 'cover-termination':
        return 'planting';
      default:
        return 'task';
    }
  }
  const PASSIVE_KINDS = new Set(['emergence', 'stage-window', 'shade-window']);
  const todayStartMs = $derived(Date.parse(data.today));
  const weekItemsByDay = $derived.by(() => {
    type Row = { at: number; value: WeekItem };
    const rows: Row[] = [];
    for (const t of tasks) {
      if (t.kind !== 'primary' || t.completedAt !== undefined || t.abortedAt !== undefined)
        continue;
      if (queued.has(t.id)) continue;
      rows.push({ at: t.scheduledFor, value: { title: t.title, kind: weekKindForTask(t) } });
    }
    for (const e of data.seasonEvents as CalendarEvent[]) {
      if (PASSIVE_KINDS.has(e.kind)) continue;
      rows.push({ at: e.startMs, value: { title: e.title, kind: weekKindForEvent(e) } });
    }
    return calendarItems(rows, data.today, prefs.timeZone, (v) => v);
  });

  const recommendationItems = $derived.by<RecommendationItem[]>(() =>
    data.upcoming.slice(0, 8).map((e: CalendarEvent, i: number) => ({
      id: `${e.kind}:${e.blockId}:${e.startMs}:${i}`,
      title: e.title,
      crop: e.varietyDisplayName,
      window: fmt.day(e.startMs, 'month-day')
    }))
  );

  function setWindow(w: TodayWindow) {
    deckWindow = w;
    calPeriod = periodForWindow(w);
    syncUrl();
  }
  function setView(v: TodayView) {
    view = v;
    syncUrl();
  }
  function syncUrl() {
    const url = new URL(window.location.href);
    if (deckWindow === 'today') url.searchParams.delete('tab');
    else url.searchParams.set('tab', deckWindow);
    if (view === 'list') url.searchParams.delete('view');
    else url.searchParams.set('view', view);
    try {
      replaceState(url, {});
    } catch {
      /* before hydration finishes; state still applies */
    }
  }

  let busy = $state(false);
  let actionError = $state<string | null>(null);
  let liveMessage = $state('');

  async function refreshQueued(): Promise<void> {
    try {
      const { listQueuedTaskActions } = await import('$lib/client/taskQueue');
      const next = await listQueuedTaskActions();
      const waiting = (rows: QueuedTaskRow[]) => rows.filter((r) => !r.rejected).length;
      const drained = waiting(next) < waiting(queuedRows);
      queuedRows = next;
      if (drained && navigator.onLine) await invalidateAll();
    } catch {
      queuedRows = [];
    }
  }

  onMount(() => {
    void refreshQueued();
    const timer = setInterval(refreshQueued, 4000);
    return () => clearInterval(timer);
  });

  async function queueAction(taskId: string, action: QueuedTaskAction, reason?: string) {
    const { queueTaskAction } = await import('$lib/client/taskQueue');
    await queueTaskAction(taskId, action, reason);
    await refreshQueued();
    liveMessage = 'Saved on this phone. It will save when you have signal.';
  }

  async function closeTask(taskId: string, action: QueuedTaskAction, reason?: string) {
    busy = true;
    actionError = null;
    liveMessage = '';
    const body =
      action === 'complete'
        ? { action: 'complete', occurredAt: Date.now() }
        : { action: 'abort', reason: reason || undefined };
    try {
      if (navigator.onLine === false) {
        await queueAction(taskId, action, reason);
        return;
      }
      let res: Response;
      try {
        res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
      } catch {
        await queueAction(taskId, action, reason);
        return;
      }
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        actionError = `That did not save. ${out.error ?? `The server said ${res.status}.`}`;
        return;
      }
      liveMessage = action === 'complete' ? 'Marked done.' : 'Skipped.';
      await invalidateAll();
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function scheduleFromEvent(e: CalendarEvent) {
    busy = true;
    actionError = null;
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: e.title,
          body: e.body ?? `Promoted from ${e.kind} suggestion`,
          kind: 'primary',
          blockId: e.blockId,
          cropId: e.cropId,
          scheduledFor: e.startMs,
          pluginTemplateKey: `derived:${e.kind}:${e.blockId}:${e.startMs}`
        })
      });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        actionError = `That did not schedule. ${out.error ?? `The server said ${res.status}.`}`;
        return;
      }
      liveMessage = 'Added to your list.';
      await invalidateAll();
    } catch (err) {
      actionError =
        navigator.onLine === false
          ? 'Scheduling needs signal. Try again when you are back online.'
          : err instanceof Error
            ? err.message
            : String(err);
    } finally {
      busy = false;
    }
  }

  function fmtRange(startMs: number, endMs: number) {
    const a = fmt.day(startMs);
    if (startMs === endMs) return a;
    return `${a} to ${fmt.day(endMs)}`;
  }

  const EVENT_KIND_LABEL: Record<string, string> = {
    'spray-window': 'Spray window',
    'harvest-window': 'Harvest window',
    planting: 'Planting',
    'cover-termination': 'Cover crop',
    'orchard-task': 'Orchard',
    'seasonal-task': 'Seasonal',
    'curing-progress': 'Curing',
    'curing-ready': 'Curing',
    'companion-trigger': 'Companion',
    emergence: 'Emergence',
    'stage-window': 'Growth stage',
    'shade-window': 'Shade'
  };

  function ctaFor(e: CalendarEvent): { href: string; label: string } | null {
    switch (e.kind) {
      case 'spray-window': {
        const stage = (e.detail?.stage as string | undefined) ?? null;
        const params = new URLSearchParams();
        params.set('block', e.blockId);
        if (stage) params.set('windowStage', stage);
        return { href: `/scout?${params.toString()}`, label: 'Scout this block' };
      }
      case 'companion-trigger':
      case 'planting':
      case 'seasonal-task':
        return { href: `/plan#block-${e.blockId}`, label: 'Open block plan' };
      case 'harvest-window':
      case 'curing-progress':
      case 'curing-ready':
        return { href: '/harvest', label: 'Open harvest' };
      case 'cover-termination':
        return {
          href: `/spray?block=${encodeURIComponent(e.blockId)}&windowStage=BURNDOWN`,
          label: 'Plan burndown'
        };
      case 'orchard-task': {
        const taskKey = (e.detail?.taskKey as string | undefined) ?? '';
        if (taskKey === 'harvest') return { href: '/harvest', label: 'Open harvest' };
        if (/spray|fungicide|oil/.test(taskKey)) {
          const params = new URLSearchParams({ block: e.blockId });
          return { href: `/spray?${params.toString()}`, label: 'Plan this orchard spray' };
        }
        return { href: `/plan#block-${e.blockId}`, label: 'Open block plan' };
      }
    }
    return null;
  }
</script>

<WeatherStrip
  dateLabel={todayDateLabel}
  {greeting}
  {subtitle}
  weather={data.weather}
  canSetLocation={data.canSetFarmLocation}
/>

{#if data.gettingStarted}
  <GettingStartedCard facts={data.gettingStarted.facts} dismissed={data.gettingStarted.dismissed} />
{/if}

<div class="t-grid">
  <TodayHero
    action={data.priorityAction}
    {aiEnabled}
    onSkip={canAct ? (taskId, reason) => closeTask(taskId, 'abort', reason) : undefined}
  />
  <QuickActions profile={data.farmProfile} />
</div>

{#if data.winterizeAlerts.length > 0}
  <section class="card winterize-alert" aria-label="Winterization reminder">
    <h2>❄ Winterization check</h2>
    <p>
      {data.winterizeAlerts.length === 1 ? 'A sprayer was' : 'Sprayers were'} used this season but
      {data.winterizeAlerts.length === 1 ? 'was' : 'were'} not winterized after the prior one. Recalibrate
      (UC-10) and winterize before storage.
    </p>
    <ul>
      {#each data.winterizeAlerts as a (a.sprayerId)}
        <li>
          <a href="/equipment/{encodeURIComponent(a.sprayerId)}/winterize">{a.label}</a>
          {#if a.uncalibrated}<span class="pill">Uncalibrated</span>{/if}
          {#if a.neverWinterized}<span class="pill">Never winterized</span>{/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section class="deck" aria-labelledby="deck-heading" data-testid="today-deck">
  <div class="deck-head">
    <h2 id="deck-heading" class="serif">{DECK_HEADINGS[deckWindow]}</h2>
    {#if summary}<p class="deck-sum" data-testid="deck-summary">{summary}</p>{/if}
  </div>
  <div class="filters">
    <div class="chips" role="group" aria-label="Show work for">
      {#each TODAY_WINDOWS as w (w.id)}
        <button
          type="button"
          class="chip"
          aria-pressed={deckWindow === w.id}
          onclick={() => setWindow(w.id)}>{w.label}</button
        >
      {/each}
    </div>
    <div class="chips" role="group" aria-label="Show as">
      <button
        type="button"
        class="chip"
        aria-pressed={view === 'list'}
        onclick={() => setView('list')}>Cards</button
      >
      <button
        type="button"
        class="chip"
        aria-pressed={view === 'calendar'}
        onclick={() => setView('calendar')}>Calendar</button
      >
    </div>
  </div>

  <p class="sr-only" role="status" aria-live="polite">{liveMessage}</p>
  {#if actionError}
    <Banner tone="rust" urgent>{actionError}</Banner>
  {/if}

  {#if view === 'calendar'}
    <div class="calendar">
      <WeekStrip {todayStartMs} items={weekItemsByDay} bind:period={calPeriod} />
      {#if deckWindow === 'season'}
        <SeasonStrip
          crops={data.activeCrops}
          events={data.seasonEvents as CalendarEvent[]}
          fromMs={data.nowMs}
          toMs={data.nowMs + 200 * 86_400_000}
        />
      {/if}
    </div>
  {:else}
    {#if deck.length === 0}
      <div class="empty" data-testid="deck-empty">
        {#if deckWindow === 'today'}
          <p class="serif empty-title">Nothing on the list for today.</p>
        {:else}
          <p class="serif empty-title">Nothing scheduled in this window.</p>
        {/if}
        <p>
          {#if data.counts.blocks === 0}
            Add an Area on the <a href="/plan">Plan</a> page and plant something, and the jobs it needs
            will show up here.
          {:else}
            Your crop calendar suggestions are below. Plan a one-off spray any time.
          {/if}
        </p>
        <a class="btn primary" href="/spray">Plan a spray</a>
      </div>
    {:else}
      <ul class="cards" aria-label="Tasks">
        {#each deck as d (d.entry.task.id)}
          <li>
            <TaskDeckCard
              card={d.card}
              taskId={d.entry.task.id}
              status={d.entry.status}
              start={d.start}
              {canAct}
              queued={d.entry.queued !== null}
              rejected={rejected.has(d.entry.task.id)}
              linked={d.linked}
              {busy}
              {prefs}
              now={data.nowMs}
              onDone={(id) => closeTask(id, 'complete')}
              onSkip={(id, reason) => closeTask(id, 'abort', reason)}
            />
          </li>
        {/each}
      </ul>
    {/if}

    {#if windowEvents.length > 0}
      <h3 class="sub-head">From your crop calendar</h3>
      <p class="hint">
        Your crops suggest these. Schedule one to add it to your list, where it can get its own prep
        and follow-up jobs.
      </p>
      <ul class="suggestions" aria-label="Crop calendar suggestions">
        {#each windowEvents as e (e.kind + e.blockId + e.startMs + e.title)}
          {@const cta = ctaFor(e)}
          <li class="suggestion">
            <div class="s-main">
              <strong>{e.title}</strong>
              <span class="s-meta"
                >{fmtRange(e.startMs, e.endMs)} · {e.varietyDisplayName} ·
                <span class="s-kind">{EVENT_KIND_LABEL[e.kind] ?? e.kind.replace(/-/g, ' ')}</span
                ></span
              >
              {#if e.body}<span class="s-body">{e.body}</span>{/if}
            </div>
            <div class="s-actions">
              {#if cta}<a class="btn ghost" href={cta.href}>{cta.label}</a>{/if}
              {#if canAct}
                <button
                  type="button"
                  class="btn ghost"
                  aria-label="Schedule: {e.title}"
                  disabled={busy}
                  onclick={() => scheduleFromEvent(e)}>Schedule</button
                >
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if deckWindow === 'season' && data.activeCrops.length > 0}
      <h3 class="sub-head">Active crops</h3>
      <ul class="active-crops">
        {#each data.activeCrops as c (c.id)}
          <li>
            <a href={cardHref('planting', cardKey('planting', c.id))}>{c.varietyDisplayName}</a>
            <span class="s-meta"
              >{data.blockNames[c.blockId] ?? 'Unnamed block'} · {c.plantingDate
                ? `planted ${fmt.day(c.plantingDate)}`
                : 'planned'}</span
            >
            <Pill tone={c.status === 'active' ? 'forest' : 'neutral'}>{c.status}</Pill>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<div class="t-grid t-grid-second">
  <Recommendations
    items={recommendationItems}
    onSchedule={canAct
      ? (id) => {
          const idx = recommendationItems.findIndex((r) => r.id === id);
          const ev = data.upcoming[idx];
          if (ev) scheduleFromEvent(ev);
        }
      : undefined}
  />
  <SeasonGlance glance={data.seasonGlance} />
</div>

{#if data.lowStock.length > 0}
  <Banner tone="wheat">
    <strong>{data.lowStock.length} item{data.lowStock.length === 1 ? '' : 's'} low on stock:</strong
    >
    <ul class="alert-list">
      {#each data.lowStock as i (i.id)}
        <li>
          <a href="/inventory/{STOCK_CATEGORY_TO_INVENTORY_TYPE[i.category] ?? 'pesticide'}/{i.id}"
            >{i.displayName}</a
          >: {i.onHand}
          {i.defaultUnit} on hand (reorder at {i.reorderThreshold}
          {i.defaultUnit})
        </li>
      {/each}
    </ul>
  </Banner>
{/if}
{#if data.expiringStock.length > 0}
  <Banner tone="wheat">
    <strong
      >{data.expiringStock.length} lot{data.expiringStock.length === 1 ? '' : 's'} expiring within 30
      days:</strong
    >
    <ul class="alert-list">
      {#each data.expiringStock as e (e.itemId + (e.lotNumber ?? ''))}
        <li>
          <a
            href="/inventory/{STOCK_CATEGORY_TO_INVENTORY_TYPE[e.category] ??
              'pesticide'}/{e.itemId}">{e.itemName}</a
          >
          {#if e.lotNumber}<code>{e.lotNumber}</code>{/if}: {e.balance}
          {e.unit}, {e.daysUntilExpiry} day{e.daysUntilExpiry === 1 ? '' : 's'} left
        </li>
      {/each}
    </ul>
  </Banner>
{/if}

<section class="card gear" aria-labelledby="gear-heading" data-testid="today-gear">
  <h2 id="gear-heading">Sprayers and safety rules</h2>
  {#if data.sprayers.length === 0}
    <p class="hint">No sprayers yet. Add one from <a href="/inventory">Inventory</a>.</p>
  {:else}
    <ul class="sprayers">
      {#each data.sprayers as s (s.id)}
        <li>
          <strong>{s.label}</strong>
          {#if s.lastChemistryClass}
            <span class="warn">last load: {s.lastChemistryClass}</span>
            <a href="/spray/decon?sprayer={encodeURIComponent(s.id)}" class="link">Decon</a>
          {:else}
            <span class="ok">clean</span>
          {/if}
          {#if s.lastDeconAt}
            <span class="meta">decon {fmt.instant(s.lastDeconAt)}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  <dl class="kernel">
    <dt>Rules version</dt>
    <dd><code>{data.rulesVersion}</code></dd>
    <dt>Crops registered</dt>
    <dd>{data.counts.crops}</dd>
    <dt>Herbicides registered</dt>
    <dd>{data.counts.herbicides}</dd>
    <dt>Blocks defined</dt>
    <dd>{data.counts.blocks}</dd>
    {#if data.pluginFailures.length > 0}
      <dt>Plugin load failures</dt>
      <dd class="warn-list">
        <ul>
          {#each data.pluginFailures as f, idx (idx)}<li>{f}</li>{/each}
        </ul>
      </dd>
    {/if}
  </dl>
</section>

<div class="legend-tail">
  <ProvenanceLegend
    shown={aiEnabled
      ? ['plugin', 'data', 'ai', 'manual']
      : ['plugin', 'data', 'fallback', 'manual']}
    note={aiEnabled
      ? 'AI on · plugin + your records · all editable'
      : 'AI off · plugin + your records · all editable'}
  />
</div>

<style>
  .t-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
    gap: 18px;
    margin-bottom: 18px;
  }
  .t-grid-second {
    margin-bottom: 22px;
  }
  .legend-tail {
    margin: 0 0 22px;
  }
  @media (max-width: 900px) {
    .t-grid,
    .t-grid-second {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .deck {
    margin: 0 0 22px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .deck-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 14px;
  }
  .deck-head h2 {
    margin: 0;
    font-size: 22px;
    color: var(--color-ink);
  }
  .deck-sum {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 14px;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    min-height: 48px;
    padding: 0 14px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: var(--color-cream);
  }
  .chip:focus-visible,
  .btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
    gap: 12px;
  }
  .cards > li {
    min-width: 0;
  }
  .calendar {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .empty {
    padding: 18px;
    border: 1px dashed var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
  }
  .empty p {
    margin: 0 0 8px;
    color: var(--color-ink-soft);
  }
  .empty .empty-title {
    font-size: 18px;
    color: var(--color-ink);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 16px;
    border-radius: var(--radius-input);
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .btn.primary {
    background: var(--color-forest);
    color: var(--color-cream);
    border: 1px solid var(--color-forest);
  }
  .btn.ghost {
    background: var(--color-paper);
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .sub-head {
    margin: 8px 0 0;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-ink-soft);
  }
  .hint {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 14px;
  }
  .suggestions,
  .active-crops {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .suggestion {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
    padding: 10px 12px;
    border: 1px solid var(--color-divider-soft);
    border-left: 4px solid var(--color-wheat);
    border-radius: var(--radius-input);
    background: var(--color-paper);
  }
  .s-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1 1 14rem;
    overflow-wrap: anywhere;
  }
  .s-meta {
    color: var(--color-ink-soft);
    font-size: 13px;
  }
  .s-kind {
    text-transform: lowercase;
  }
  .s-body {
    font-size: 14px;
    color: var(--color-ink);
  }
  .s-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .active-crops li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    min-height: 48px;
    border-top: 1px solid var(--color-divider-soft);
  }
  .active-crops a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    font-weight: 600;
    color: var(--color-forest-deep);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .alert-list {
    margin: 0.4rem 0 0 1.25rem;
    padding: 0;
  }
  .alert-list code {
    background: var(--color-paper);
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.85rem;
  }
  .card {
    background: var(--color-paper);
    border: 1px solid var(--color-divider-soft);
    border-radius: var(--radius-card);
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
  }
  .card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: var(--color-forest-deep);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .sprayers {
    list-style: none;
    padding: 0;
    margin: 0 0 12px;
  }
  .sprayers li {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.5rem 0;
    border-top: 1px solid var(--color-divider-soft);
  }
  .sprayers li:first-child {
    border-top: none;
  }
  .sprayers .warn {
    background: var(--pill-wheat-bg);
    color: var(--pill-wheat-fg);
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .sprayers .ok {
    background: var(--pill-forest-bg);
    color: var(--pill-forest-fg);
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .sprayers .meta {
    color: var(--color-ink-soft);
    font-size: 0.8rem;
  }
  .sprayers .link {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    padding: 0 8px;
    color: var(--color-rust);
    font-weight: 600;
  }
  .kernel {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.4rem 1rem;
    margin: 0;
  }
  .kernel dt {
    color: var(--color-ink-soft);
  }
  .kernel dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .warn-list ul {
    margin: 0;
    padding-left: 1.25rem;
  }
  .winterize-alert {
    border-left: 4px solid #2a6ca8;
    background: #eef5fb;
  }
  .winterize-alert h2 {
    color: #1b4c78;
  }
  .winterize-alert ul {
    margin: 0.5rem 0 0;
    padding-left: 1.25rem;
  }
  .winterize-alert li {
    padding: 0.2rem 0;
  }
  .winterize-alert a {
    color: #1b4c78;
    font-weight: 600;
  }
  .winterize-alert .pill {
    background: #d6e6f4;
    color: #1b4c78;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.75rem;
    margin-left: 0.4rem;
  }
</style>
