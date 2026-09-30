<script lang="ts">
  import { onMount } from 'svelte';
  import PageSetupQuestions from '$lib/components/setup/PageSetupQuestions.svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import {
    PRINT_RANGE_NOTE,
    periodCardPrintHref,
    periodPrintable
  } from '$lib/cards/build/calendar';
  import type { CalendarEvent } from '$lib/calendar/engine';
  import type { Task } from '$lib/db/tasks';
  import { STOCK_CATEGORY_TO_INVENTORY_TYPE } from '$lib/inventory/types';
  import Banner from '$lib/components/ui/Banner.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import ProvenanceLegend from '$lib/components/ui/ProvenanceLegend.svelte';
  import WeatherStrip from '$lib/components/today/WeatherStrip.svelte';
  import ForecastSheet from '$lib/components/today/ForecastSheet.svelte';
  import TodayHero from '$lib/components/today/TodayHero.svelte';
  import QuickActions from '$lib/components/today/QuickActions.svelte';
  import CalendarGrid from '$lib/components/today/CalendarGrid.svelte';
  import SeasonTimeline from '$lib/components/today/SeasonTimeline.svelte';
  import TaskDeckCard, { type LinkedTaskItem } from '$lib/components/today/TaskDeckCard.svelte';
  import CareTaskCard from '$lib/components/animals/CareTaskCard.svelte';
  import Recommendations, {
    type RecommendationItem
  } from '$lib/components/today/Recommendations.svelte';
  import SeasonGlance from '$lib/components/today/SeasonGlance.svelte';
  import AdviceCards from '$lib/components/today/AdviceCards.svelte';
  import GettingStartedCard from '$lib/components/today/GettingStartedCard.svelte';
  import AlphaWelcome from '$lib/components/feedback/AlphaWelcome.svelte';
  import { buildTaskCard } from '$lib/cards/build/task';
  import { taskPlanHref } from '$lib/cards/build/common';
  import { taskStart } from '$lib/tasks/start';
  import { plantingCardHref } from '$lib/cards/model';
  import type { QueuedTaskAction } from '$lib/tasks/status';
  import {
    buildCalendarDeck,
    buildTaskDeck,
    deckCounts,
    filterByAssignee,
    eventsForWindow,
    type DeckEntry
  } from '$lib/today/deck';
  import {
    calendarCells,
    suggestionScheduleMs,
    suggestionTemplateKey,
    type CalendarChip
  } from '$lib/today/calendar';
  import { SEASON_SPAN_LABEL, type SeasonSpan } from '$lib/today/seasonTimeline';
  import { TODAY_VIEWS, type TodayView } from '$lib/today/views';
  import { weatherByDate } from '$lib/today/weatherSummary';
  import type { QueuedTaskRow } from '$lib/client/taskQueue';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';
  import { formatDueDay } from '$lib/prefs';
  import { dateTimeFormat } from '$lib/intlCache';
  import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
  import { formatHours } from '$lib/labour/hours';
  import { isClosedStatus } from '$lib/tasks/status';
  import { defaultAssigneeWho, resolveAssigneeWho, type AssigneeWho } from '$lib/tasks/assignee';

  const { data } = $props();

  const aiEnabled = $derived(data.aiEnabled);
  const gardenOnly = $derived(data.farmProfile === 'garden');
  const nothingPlanted = $derived(data.counts.blocks === 0 || data.counts.plantings === 0);
  const prefs = $derived(currentPrefs());
  const canAct = $derived(!!data.user && data.user.role !== 'inspector');
  const view = $derived<TodayView>(data.view);

  const todayDateLabel = $derived(fmt.instant(data.nowMs, 'date-long', { year: undefined }));
  const greeting = $derived.by(() => {
    const hour = Number(
      dateTimeFormat('en-US', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone: prefs.timeZone
      }).format(new Date(data.nowMs))
    );
    const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    return `Good ${part}.`;
  });

  let queuedRows = $state<QueuedTaskRow[]>([]);
  const queued = $derived.by(() => {
    const m = new Map<string, QueuedTaskAction>();
    for (const r of queuedRows) if (!r.rejected) m.set(r.taskId, r.action);
    return m;
  });
  const rejected = $derived(new Set(queuedRows.filter((r) => r.rejected).map((r) => r.taskId)));

  const tasks = $derived(data.deckTasks as Task[]);
  const entries = $derived<DeckEntry<Task>[]>(
    data.calendar
      ? buildCalendarDeck(tasks, {
          now: data.nowMs,
          timeZone: prefs.timeZone,
          fromYmd: data.calendar.grid.fromYmd,
          toYmd: data.calendar.grid.toYmd,
          queued
        })
      : buildTaskDeck(tasks, {
          window: 'today',
          now: data.nowMs,
          timeZone: prefs.timeZone,
          queued
        })
  );
  const userId = $derived(data.user?.id ?? '');
  const defaultWho = $derived(
    defaultAssigneeWho(
      data.user?.role,
      userId,
      entries
        .flatMap((e) => [e, ...e.linked])
        .flatMap((i) => (isClosedStatus(i.status) ? [] : [i.task]))
    )
  );
  const othersAssigned = $derived(
    entries.some((e) => !!e.task.assigneeUserId && e.task.assigneeUserId !== userId)
  );
  /** A solo farm or garden household has nobody to hand work to. */
  const hasTeam = $derived(!!data.hasTeam || othersAssigned);
  const who = $derived<AssigneeWho>(
    hasTeam ? resolveAssigneeWho(page.url.searchParams.get('who'), defaultWho) : 'all'
  );
  const filtered = $derived(filterByAssignee(entries, who, userId));
  const shownEntries = $derived(filtered.shown);
  const canAssign = $derived(data.user?.role === 'owner' && !data.user?.impersonating && hasTeam);
  function setWho(next: AssigneeWho) {
    if (next === who) return;
    navigate({ who: next === defaultWho ? null : next });
  }
  const counts = $derived(deckCounts(view === 'day' ? shownEntries : []));
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
    return view === 'day'
      ? 'Nothing scheduled today. Check the list below for what is coming.'
      : 'Nothing scheduled today.';
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
        assignee: t.assignee?.name ?? null,
        href: taskPlanHref(t.blockId ?? planting?.blockId ?? null)
      },
      { now: data.nowMs, prefs }
    );
  }

  const deck = $derived(
    shownEntries.map((e) => ({
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
        queued: l.queued !== null,
        due: formatDueDay(l.task.scheduledFor, prefs, 'month-day', { weekday: 'short' }),
        body: l.task.body ?? null
      }))
    }))
  );
  const deckById = $derived(new Map(deck.map((d) => [d.entry.task.id, d])));

  const todayEvents = $derived(
    eventsForWindow([], data.eventsToday as CalendarEvent[], 'today', data.nowMs)
  );

  const forecastByDate = $derived(
    data.weather.status === 'ok' ? weatherByDate(data.weather.days) : {}
  );
  const suggestions = $derived((data.calendar?.suggestions ?? []) as CalendarEvent[]);
  const cells = $derived.by(() => {
    if (!data.calendar) return {};
    return calendarCells({
      entries: shownEntries,
      suggestions,
      scheduledKeys: new Set(data.calendar.scheduledKeys),
      fromYmd: data.calendar.grid.fromYmd,
      toYmd: data.calendar.grid.toYmd,
      todayYmd: data.today,
      timeZone: prefs.timeZone
    });
  });

  const recommendationItems = $derived.by<RecommendationItem[]>(() =>
    data.upcoming.slice(0, 8).map((e: CalendarEvent, i: number) => ({
      id: `${e.kind}:${e.blockId}:${e.startMs}:${i}`,
      title: e.title,
      crop: e.varietyDisplayName,
      window: fmt.day(e.startMs, 'month-day')
    }))
  );

  let forecastOpen = $state(false);

  type Sheet =
    | { kind: 'day'; day: string; only: string | null }
    | { kind: 'season-row'; index: number }
    | null;
  let sheet = $state<Sheet>(null);
  const sheetChips = $derived.by<CalendarChip[]>(() => {
    if (sheet?.kind !== 'day') return [];
    const all = (cells as Record<string, CalendarChip[]>)[sheet.day] ?? [];
    const only = sheet.only;
    return only ? all.filter((c) => c.key === only) : all;
  });
  const sheetRow = $derived(
    sheet?.kind === 'season-row' && data.season ? data.season.timeline.rows[sheet.index] : null
  );
  const sheetTitle = $derived.by(() => {
    if (sheet?.kind === 'day') return fmt.day(sheet.day, 'date-long', { year: undefined });
    if (sheetRow) return `${sheetRow.name}, ${sheetRow.blockName}`;
    return '';
  });

  function navigate(params: Record<string, string | null>) {
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(params)) {
      if (v === null) url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    }
    void goto(`${url.pathname}${url.search}`, { noScroll: true, keepFocus: true });
  }
  function setView(v: TodayView) {
    if (v === view) return;
    sheet = null;
    navigate({ view: v === 'day' ? null : v, at: null, season: null, tab: null });
  }

  let busy = $state(false);
  let actionError = $state<string | null>(null);
  let liveMessage = $state('');
  let careMessage = $state('');
  let trayPrompt = $state<{ cropId: string } | null>(null);

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

  async function queueAction(
    taskId: string,
    action: QueuedTaskAction,
    reason: string | undefined,
    minutes: number | undefined,
    clientId: string
  ) {
    const { queueTaskAction } = await import('$lib/client/taskQueue');
    await queueTaskAction(taskId, action, reason, minutes ? { minutes } : {}, clientId);
    await refreshQueued();
    liveMessage = 'Saved on this phone. It will upload when you have signal.';
  }

  /** Done and Skip go through the replayable close endpoint with one client
   *  record id, so a lost answer followed by the offline replay never logs
   *  the time twice (F1-15). */
  async function closeTask(
    taskId: string,
    action: QueuedTaskAction,
    reason?: string,
    minutes?: number
  ) {
    busy = true;
    actionError = null;
    liveMessage = '';
    const clientId = crypto.randomUUID();
    const body =
      action === 'complete'
        ? { taskId, action: 'complete', occurredAt: Date.now(), ...(minutes ? { minutes } : {}) }
        : { taskId, action: 'abort', reason: reason || undefined };
    try {
      if (navigator.onLine === false) {
        await queueAction(taskId, action, reason, minutes, clientId);
        return;
      }
      let res: Response;
      try {
        res = await fetch('/api/tasks/close', {
          method: 'POST',
          headers: { 'content-type': 'application/json', [CLIENT_RECORD_HEADER]: clientId },
          body: JSON.stringify(body)
        });
      } catch {
        await queueAction(taskId, action, reason, minutes, clientId);
        return;
      }
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        actionError = `That did not save. ${out.error ?? `The server said ${res.status}.`}`;
        return;
      }
      const out = (await res.json().catch(() => null)) as {
        seedStart?: { step?: string; cropId?: string } | null;
        alreadyClosed?: boolean;
        timeSaved?: boolean;
      } | null;
      liveMessage =
        action !== 'complete'
          ? 'Skipped.'
          : out?.alreadyClosed
            ? out.timeSaved
              ? 'Someone already closed this job. Your time was saved.'
              : 'Someone already closed this job.'
            : minutes
              ? `Marked done. ${formatHours(minutes)} logged.`
              : 'Marked done.';
      if (action === 'complete') {
        const seed = out?.seedStart;
        trayPrompt =
          seed?.step === 'sow' && seed.cropId && data.user?.role === 'owner'
            ? { cropId: seed.cropId }
            : null;
        if (trayPrompt) liveMessage = 'Marked done. Log the tray so the calendar shows it.';
      }
      await invalidateAll();
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function scheduleFromEvent(e: CalendarEvent, dayYmd: string | null = null) {
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
          scheduledFor: suggestionScheduleMs(e, data.today, prefs.timeZone, dayYmd),
          pluginTemplateKey: suggestionTemplateKey(e)
        })
      });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        actionError = `That did not schedule. ${out.error ?? `The server said ${res.status}.`}`;
        return;
      }
      liveMessage = 'Added to your list.';
      sheet = null;
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

  function spanDates(s: SeasonSpan): string {
    return fmtRange(s.startMs, s.endMs);
  }
</script>

<svelte:head><title>Today · CropCard</title></svelte:head>

{#snippet suggestionCard(e: CalendarEvent, dayYmd: string | null = null)}
  {@const cta = ctaFor(e)}
  <div class="suggestion">
    <div class="s-main">
      <strong>{e.title}</strong>
      <span class="s-meta"
        >{fmtRange(e.startMs, e.endMs)} · {e.varietyDisplayName} ·
        <span class="s-kind">{EVENT_KIND_LABEL[e.kind] ?? e.kind.replace(/-/g, ' ')}</span></span
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
          onclick={() => scheduleFromEvent(e, dayYmd)}>Schedule</button
        >
      {/if}
    </div>
  </div>
{/snippet}

{#snippet moreForEveryone()}
  <button
    type="button"
    class="more-all"
    data-testid="more-for-everyone"
    onclick={() => setWho('all')}
    >{filtered.hiddenCount}
    {filtered.hiddenCount === 1 ? 'more task' : 'more tasks'} for everyone</button
  >
{/snippet}

{#snippet taskCard(taskId: string)}
  {@const d = deckById.get(taskId)}
  {#if d}
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
      {canAssign}
      assigneeUserId={d.entry.task.assigneeUserId ?? null}
      onDone={(id, minutes) => closeTask(id, 'complete', undefined, minutes)}
      onSkip={(id, reason) => closeTask(id, 'abort', reason)}
      onAssigned={async (name) => {
        liveMessage = name ? `Given to ${name}.` : 'Given to nobody in particular.';
        await invalidateAll();
      }}
    />
  {/if}
{/snippet}

<WeatherStrip
  dateLabel={todayDateLabel}
  {greeting}
  {subtitle}
  weather={data.weather}
  canSetLocation={data.canSetFarmLocation}
  onOpenForecast={() => (forecastOpen = true)}
/>
<ForecastSheet
  open={forecastOpen}
  onClose={() => (forecastOpen = false)}
  weather={data.weather}
  canSetLocation={data.canSetFarmLocation}
/>

<AlphaWelcome suppressed={(data.dirtySprayers?.length ?? 0) > 0} />

{#if data.gettingStarted}
  <GettingStartedCard facts={data.gettingStarted.facts} dismissed={data.gettingStarted.dismissed} />
{/if}

{#if data.setupPrompts.nudges.length > 0}
  <PageSetupQuestions
    nudges={data.setupPrompts.nudges}
    scope={`today:${data.user?.activeOwnerId ?? ''}`}
    kicker="Today"
    latLon={data.setupLatLon}
  />
{/if}

<div class="t-grid">
  <TodayHero
    action={data.priorityAction}
    {aiEnabled}
    onSkip={canAct ? (taskId, reason) => closeTask(taskId, 'abort', reason) : undefined}
    onDone={canAct
      ? (taskId, minutes) => closeTask(taskId, 'complete', undefined, minutes)
      : undefined}
    {busy}
  />
  <QuickActions profile={data.farmProfile} />
</div>

{#if data.deconAlerts.length > 0}
  <section class="card decon-alert" aria-label="Sprayer cleanout" data-testid="today-decon-alert">
    <h2>Sprayer cleanout due</h2>
    <p>
      {data.deconAlerts.length === 1 ? 'A sprayer still holds' : 'Sprayers still hold'} the last load.
      Run the cleanout before the next spray.
    </p>
    <ul>
      {#each data.deconAlerts as s (s.id)}
        <li>
          <strong>{s.label}</strong>
          <span class="pill">last load: {s.lastChemistryClass}</span>
          <a href="/spray/decon?sprayer={encodeURIComponent(s.id)}"
            >{data.user?.role === 'owner' ? 'Run the cleanout' : 'See the cleanout steps'}</a
          >
        </li>
      {/each}
    </ul>
    <a class="alert-link" href="/equipment">All equipment</a>
  </section>
{/if}

{#if data.coveredLogs.length > 0}
  <section class="card covered-alert" role="alert" aria-label="Treated food already logged">
    <h2>Food logged during a treatment hold</h2>
    <p>
      Eggs, milk or meat were saved as food or for sale while a treatment hold applied. If any of
      these were sold, tell the buyer. This stays here for two weeks after the treatment was
      recorded, even if a log is changed to discarded.
    </p>
    <ul>
      {#each data.coveredLogs as c (c.subjectType + c.subjectId)}
        <li>
          <a
            href={c.count > 0
              ? `/animals/${encodeURIComponent(c.subjectId)}/log`
              : `/animals/${encodeURIComponent(c.subjectId)}`}>{c.name}</a
          >:
          {#if c.count > 0}{c.count}
            {c.count === 1 ? 'log' : 'logs'}{/if}{#if c.count > 0 && c.meatCount > 0},
          {/if}{#if c.meatCount > 0}meat recorded as food{/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

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

{#if view === 'day'}
  <AdviceCards cards={data.advice} onSaved={() => invalidateAll()} />
{/if}

{#if data.animalCare.length > 0 || careMessage}
  <section class="animal-care" aria-labelledby="care-heading" data-testid="today-animal-care">
    <h2 id="care-heading" class="serif">Animal care</h2>
    {#if careMessage}<p class="care-ok" role="status">{careMessage}</p>{/if}
    {#each data.animalCare as card (card.key)}
      <CareTaskCard
        {card}
        todayYmd={data.careTodayYmd}
        isOwner={data.isOwner}
        {canAct}
        products={data.animalCareForm.products}
        stock={data.animalCareForm.stock}
        onChanged={async (text) => {
          careMessage = text;
          await refreshQueued();
          await invalidateAll();
        }}
      />
    {/each}
  </section>
{/if}

<section class="deck" aria-labelledby="deck-heading" data-testid="today-deck" data-view={view}>
  <div class="deck-head">
    <h2 id="deck-heading" class="serif">
      {view === 'day' ? "Today's work" : view === 'season' ? 'Season timeline' : 'Calendar'}
    </h2>
    {#if view === 'day' && summary}<p class="deck-sum" data-testid="deck-summary">{summary}</p>{/if}
  </div>
  <div class="chips" role="group" aria-label="Show">
    {#each TODAY_VIEWS as v (v.id)}
      <button type="button" class="chip" aria-pressed={view === v.id} onclick={() => setView(v.id)}
        >{v.label}</button
      >
    {/each}
  </div>

  {#if view !== 'season' && hasTeam}
    <div class="who" role="group" aria-label="Whose jobs" data-testid="who-filter">
      <button
        type="button"
        class="who-seg"
        aria-pressed={who === 'mine'}
        onclick={() => setWho('mine')}>Mine</button
      >
      <button
        type="button"
        class="who-seg"
        aria-pressed={who === 'all'}
        onclick={() => setWho('all')}>Everyone</button
      >
    </div>
  {/if}

  <p class="sr-only" role="status" aria-live="polite">{liveMessage}</p>
  {#if trayPrompt}
    <div class="tray-prompt" data-testid="log-tray-prompt">
      <p>Sown? Log the tray so the calendar shows it as sown.</p>
      <div class="tray-actions">
        <a class="tray-btn primary" href="{plantingCardHref(trayPrompt.cropId)}#log-tray"
          >Log the tray</a
        >
        <button type="button" class="tray-btn" onclick={() => (trayPrompt = null)}>Not now</button>
      </div>
    </div>
  {/if}
  {#if actionError}
    <Banner tone="rust" urgent>{actionError}</Banner>
  {/if}

  {#if data.calendar}
    <CalendarGrid
      view={data.calendar.view}
      anchor={data.calendar.anchor}
      grid={data.calendar.grid}
      todayYmd={data.today}
      {cells}
      weather={forecastByDate}
      blockNames={data.blockNames}
      onPage={(at) => navigate({ at: at === null || at === data.today ? null : at })}
      onOpenChip={(day, chip) => (sheet = { kind: 'day', day, only: chip.key })}
      onOpenDay={(day) => (sheet = { kind: 'day', day, only: null })}
    />
    {#if who === 'mine' && filtered.hiddenCount > 0}
      {@render moreForEveryone()}
    {/if}
    <div class="print-row">
      {#if periodPrintable(data.calendar.view, data.calendar.anchor, data.today)}
        <a
          class="print-btn"
          data-testid="print-calendar"
          href={periodCardPrintHref(data.calendar.view, data.calendar.anchor, {
            who,
            viewerId: data.user?.id ?? null
          })}>{data.calendar.view === 'week' ? 'Print week' : 'Print month'}</a
        >
      {:else}
        <p class="print-range" data-testid="print-calendar-range">{PRINT_RANGE_NOTE}</p>
      {/if}
    </div>
  {:else if data.season}
    <SeasonTimeline
      year={data.season.year}
      years={data.season.years}
      timeline={data.season.timeline}
      now={data.nowMs}
      onSelectYear={(y) => navigate({ season: String(y) })}
      onOpenRow={(i) => (sheet = { kind: 'season-row', index: i })}
    />
  {:else}
    {#if deck.length === 0 && who === 'mine' && filtered.hiddenCount > 0}
      <div class="empty" data-testid="deck-empty-mine">
        <p class="serif empty-title">Nothing is given to you today.</p>
      </div>
    {:else if deck.length === 0}
      <div class="empty" data-testid="deck-empty">
        <p class="serif empty-title">Nothing on the list for today.</p>
        {#if nothingPlanted}
          <p>
            Add an Area on the Plan page and plant something, and the jobs it needs will show up
            here.
          </p>
          <a class="btn primary" href="/plan">Plan a crop</a>
        {:else if todayEvents.length > 0}
          <p>Your crop calendar suggestions are below.</p>
        {:else}
          <p>Nothing is due today. Week and Month show what is coming.</p>
        {/if}
        {#if !gardenOnly}
          <a class="empty-link" href="/spray">Plan a spray</a>
        {/if}
      </div>
    {:else}
      <ul class="cards" aria-label="Tasks">
        {#each deck as d (d.entry.task.id)}
          <li>{@render taskCard(d.entry.task.id)}</li>
        {/each}
      </ul>
    {/if}

    {#if who === 'mine' && filtered.hiddenCount > 0}
      {@render moreForEveryone()}
    {/if}

    {#if todayEvents.length > 0}
      <h3 class="sub-head">From your crop calendar</h3>
      <p class="hint">
        Your crops suggest these. Schedule one to add it to your list, where it can get its own prep
        and follow-up jobs.
      </p>
      <ul class="suggestions" aria-label="Crop calendar suggestions">
        {#each todayEvents as e (e.kind + e.blockId + e.startMs + e.title)}
          <li>{@render suggestionCard(e)}</li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<Modal open={sheet !== null} onClose={() => (sheet = null)} title={sheetTitle}>
  <div class="sheet" data-testid="today-sheet">
    {#if sheet?.kind === 'day'}
      {#if sheetChips.length === 0}
        <p class="hint">Nothing scheduled on this day.</p>
      {:else}
        <ul class="sheet-list">
          {#each sheetChips as c (c.key)}
            <li>
              {#if c.type === 'task'}
                {@render taskCard(c.taskId)}
              {:else if suggestions[c.index]}
                <p class="sheet-kicker">Suggested by your crop calendar</p>
                {@render suggestionCard(suggestions[c.index], sheet.day)}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {:else if sheetRow && data.season}
      {#if sheetRow.spans.length === 0}
        <p class="hint">No dates yet. Give it a planting date on the Plan page.</p>
      {:else}
        <ul class="sheet-list">
          {#each sheetRow.spans as s, k (k)}
            {@const ev = s.suggestion !== undefined ? data.season.events[s.suggestion] : undefined}
            <li class="span-item" data-kind={s.kind}>
              {#if ev && ev.endMs >= data.nowMs}
                {@render suggestionCard(ev as CalendarEvent)}
              {:else}
                <div class="span-line">
                  <strong>{s.label}</strong>
                  <span class="s-meta"
                    >{SEASON_SPAN_LABEL[s.kind]} · {spanDates(s)} · {s.recorded
                      ? 'Done'
                      : 'Planned'}</span
                  >
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</Modal>

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
  .who {
    display: inline-flex;
    align-self: flex-start;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    overflow: hidden;
    margin-bottom: var(--space-2);
  }
  .who-seg {
    min-height: 48px;
    min-width: 88px;
    padding: 0 var(--space-4);
    border: 0;
    background: var(--color-paper);
    color: var(--color-forest-deep);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .who-seg + .who-seg {
    border-left: 1px solid var(--color-divider);
  }
  .who-seg[aria-pressed='true'] {
    background: var(--color-forest);
    color: var(--color-cream);
  }
  .who-seg:focus-visible,
  .more-all:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .more-all {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    margin-top: var(--space-2);
    padding: 0 var(--space-3);
    border: 1px dashed var(--color-divider);
    border-radius: var(--radius-input);
    background: transparent;
    color: var(--color-forest-deep);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .animal-care {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  .animal-care h2 {
    margin: 0;
  }
  .care-ok {
    margin: 0;
    color: var(--color-forest-deep);
    font-weight: 600;
  }
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
  .sheet-list {
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
  .empty-link {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    color: var(--color-forest-deep);
    font-weight: 600;
  }
  .btn + .empty-link {
    margin-left: 12px;
  }
  .empty-link:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .sheet {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .sheet-list > li {
    min-width: 0;
  }
  .sheet-kicker {
    margin: 0 0 4px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-ink-soft);
  }
  .span-line {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border: 1px solid var(--color-divider-soft);
    border-radius: var(--radius-input);
    overflow-wrap: anywhere;
  }
  .decon-alert {
    border-left: 4px solid var(--color-rust, #ba4b38);
  }
  .decon-alert h2 {
    color: var(--color-rust, #ba4b38);
  }
  .decon-alert p {
    margin: 0;
  }
  .decon-alert ul {
    margin: 0.5rem 0 0;
    padding: 0;
    list-style: none;
  }
  .decon-alert li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
  }
  .decon-alert li a,
  .alert-link {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    font-weight: 600;
    color: var(--color-forest-deep);
  }
  .decon-alert .pill {
    background: var(--pill-wheat-bg);
    color: var(--pill-wheat-fg);
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-size: 0.85rem;
    font-weight: 600;
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
  .covered-alert {
    border-left: 4px solid #a8432a;
    background: #fbf0ec;
  }
  .covered-alert h2 {
    color: #6e2413;
  }
  .covered-alert ul {
    margin: 0.5rem 0 0;
    padding-left: 1.25rem;
  }
  .covered-alert a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    color: #6e2413;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .tray-prompt {
    margin: 8px 0;
    padding: 10px 12px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
  }
  .tray-prompt p {
    margin: 0 0 8px;
  }
  .tray-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .tray-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    min-width: 48px;
    padding: 0 14px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    color: var(--color-forest-deep);
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .tray-btn.primary {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: var(--color-cream);
  }
  .tray-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .print-range {
    margin: 0;
    font-size: 0.9rem;
    color: var(--color-ink-soft);
  }
  .print-row {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-2);
  }
  .print-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    min-width: 48px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-forest-deep);
    font-weight: 600;
    text-decoration: none;
  }
  .print-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
