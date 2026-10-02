<script lang="ts">
  import { onMount } from 'svelte';
  import PageSetupQuestions from '$lib/components/setup/PageSetupQuestions.svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { createT, type MessageKey } from '$lib/i18n';
  import { cropDisplayNameByEnglish } from '$lib/i18n/cropName';
  import { periodCardPrintHref, printRangeNote, periodPrintable } from '$lib/cards/build/calendar';
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
  import TaskTimer from '$lib/components/tasks/TaskTimer.svelte';
  import type { TaskTimerRow } from '$lib/client/dexie';
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
  import type { SeasonSpan, SeasonSpanKind } from '$lib/today/seasonTimeline';
  import { TODAY_VIEWS, type TodayView } from '$lib/today/views';
  import { weatherByDate } from '$lib/today/weatherSummary';
  import type { QueuedTaskRow } from '$lib/client/taskQueue';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';
  import { formatDueDay } from '$lib/prefs';
  import { dateTimeFormat } from '$lib/intlCache';
  import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
  import { formatHours } from '$lib/labour/hours';
  import {
    isClosedStatus,
    taskStatusLabel,
    TASK_STATUSES,
    type TaskStatus
  } from '$lib/tasks/status';
  import { taskDisplayTitle } from '$lib/tasks/title';
  import {
    defaultAssigneeWho,
    memberNameIn,
    resolveAssigneeWho,
    type AssigneeWho
  } from '$lib/tasks/assignee';

  const { data } = $props();
  const tr = $derived(createT(page.data?.locale));

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
    return tr(
      part === 'morning'
        ? 'today.greeting.morning'
        : part === 'afternoon'
          ? 'today.greeting.afternoon'
          : 'today.greeting.evening'
    );
  });

  let queuedRows = $state<QueuedTaskRow[]>([]);
  const queued = $derived.by(() => {
    const m = new Map<string, QueuedTaskAction>();
    for (const r of queuedRows) if (!r.rejected) m.set(r.taskId, r.action);
    return m;
  });
  const rejected = $derived(new Set(queuedRows.filter((r) => r.rejected).map((r) => r.taskId)));

  const tasks = $derived(
    (data.deckTasks as Task[]).map((t) => ({ ...t, title: taskDisplayTitle(t, page.data?.locale) }))
  );
  const isTaskStatus = (s: string | undefined): s is TaskStatus =>
    (TASK_STATUSES as readonly (string | undefined)[]).includes(s);
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
    if (counts.late) parts.push(tr('today.sum.late', { count: counts.late }));
    if (counts.dueToday) parts.push(tr('today.sum.dueToday', { count: counts.dueToday }));
    if (counts.planned) parts.push(tr('today.sum.planned', { count: counts.planned }));
    if (counts.done) parts.push(tr('today.sum.done', { count: counts.done }));
    if (counts.skipped) parts.push(tr('today.sum.skipped', { count: counts.skipped }));
    return parts.join(' · ');
  });

  const subtitle = $derived.by(() => {
    const open = counts.late + counts.dueToday;
    if (data.priorityAction) {
      return open > 1
        ? tr('today.subtitle.firstThen', { count: open - 1 })
        : tr('today.subtitle.one');
    }
    return view === 'day' ? tr('today.subtitle.noneDay') : tr('today.subtitle.none');
  });

  function whereFor(t: Task): string | null {
    const planting = t.cropId ? data.plantingNames[t.cropId] : undefined;
    const blockId = t.blockId ?? planting?.blockId;
    const block = blockId ? data.blockNames[blockId] : undefined;
    const parts = [planting && cropDisplayNameByEnglish(planting.name, data.locale), block].filter(
      Boolean
    );
    return parts.length ? parts.join(' · ') : null;
  }

  function cardFor(t: Task, linked: Task[]) {
    const planting = t.cropId ? data.plantingNames[t.cropId] : undefined;
    const card = buildTaskCard(
      t,
      {
        where: whereFor(t),
        equipmentLabel: t.equipmentId ? (data.equipmentLabels[t.equipmentId] ?? null) : null,
        before: linked.filter((l) => l.kind === 'pre-task').map((l) => l.title),
        after: linked.filter((l) => l.kind === 'post-task').map((l) => l.title),
        queued: queued.get(t.id) ?? null,
        asOf: data.nowMs,
        assignee: t.assignee ? memberNameIn(t.assignee.name, data.locale) : null,
        href: taskPlanHref(t.blockId ?? planting?.blockId ?? null)
      },
      { now: data.nowMs, prefs }
    );
    const status = card.status;
    return status && isTaskStatus(status.id)
      ? { ...card, status: { ...status, label: taskStatusLabel(status.id, page.data?.locale) } }
      : card;
  }

  const deck = $derived(
    shownEntries.map((e) => ({
      entry: e,
      card: cardFor(
        e.task,
        e.linked.map((l) => l.task)
      ),
      start: taskStart(e.task, page.data?.locale),
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
      crop: cropDisplayNameByEnglish(e.varietyDisplayName, data.locale),
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
  let stripMessage = $state('');
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

  let runningRow = $state<TaskTimerRow | null>(null);
  async function refreshRunning(): Promise<void> {
    if (!userId) return;
    try {
      const [{ runningTimer }, { primeActiveOwnerId }] = await Promise.all([
        import('$lib/client/taskTimer'),
        import('$lib/client/syncQueue')
      ]);
      primeActiveOwnerId(data.user?.activeOwnerId ?? null);
      runningRow = await runningTimer(userId);
    } catch {
      runningRow = null;
    }
  }
  onMount(() => {
    void refreshRunning();
    const onChange = () => void refreshRunning();
    window.addEventListener('cropcard:task-timer', onChange);
    return () => window.removeEventListener('cropcard:task-timer', onChange);
  });
  /** D-28: a running timer whose card is not in view gets a strip. */
  const timerStrip = $derived(
    canAct && runningRow && !(view === 'day' && deckById.has(runningRow.taskId)) ? runningRow : null
  );

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
    liveMessage = tr('today.msg.savedOffline');
  }

  /** Done and Skip go through the replayable close endpoint with one client
   *  record id, so a lost answer followed by the offline replay never logs
   *  the time twice (F1-15). */
  /** True when the close saved or waits in the offline queue. */
  async function closeTask(
    taskId: string,
    action: QueuedTaskAction,
    reason?: string,
    minutes?: number
  ): Promise<boolean> {
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
        return true;
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
        return true;
      }
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        actionError = tr('today.err.saveFailed', {
          detail: out.error ?? tr('today.err.serverSaid', { status: res.status })
        });
        return false;
      }
      const out = (await res.json().catch(() => null)) as {
        seedStart?: { step?: string; cropId?: string } | null;
        alreadyClosed?: boolean;
        timeSaved?: boolean;
      } | null;
      liveMessage =
        action !== 'complete'
          ? tr('today.msg.skipped')
          : out?.alreadyClosed
            ? out.timeSaved
              ? tr('today.msg.alreadyClosedTime')
              : tr('today.msg.alreadyClosed')
            : minutes
              ? tr('today.msg.doneLogged', { time: formatHours(minutes) })
              : tr('today.msg.done');
      if (action === 'complete') {
        const seed = out?.seedStart;
        trayPrompt =
          seed?.step === 'sow' && seed.cropId && data.user?.role === 'owner'
            ? { cropId: seed.cropId }
            : null;
        if (trayPrompt) liveMessage = tr('today.msg.doneLogTray');
      }
      await invalidateAll();
      return true;
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
      return false;
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
        actionError = tr('today.err.scheduleFailed', {
          detail: out.error ?? tr('today.err.serverSaid', { status: res.status })
        });
        return;
      }
      liveMessage = tr('today.msg.added');
      sheet = null;
      await invalidateAll();
    } catch (err) {
      actionError =
        navigator.onLine === false
          ? tr('today.err.needsSignal')
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
    return tr('today.cal.range', { from: a, to: fmt.day(endMs) });
  }

  const EVENT_KIND_LABEL: Record<string, MessageKey> = {
    'spray-window': 'today.event.sprayWindow',
    'harvest-window': 'today.event.harvestWindow',
    planting: 'today.event.planting',
    'cover-termination': 'today.event.cover',
    'orchard-task': 'today.event.orchard',
    'seasonal-task': 'today.event.seasonal',
    'curing-progress': 'today.event.curing',
    'curing-ready': 'today.event.curing',
    'companion-trigger': 'today.event.companion',
    emergence: 'today.event.emergence',
    'stage-window': 'today.event.stage',
    'shade-window': 'today.event.shade'
  };

  const SPAN_KEY = {
    grow: 'today.season.span.grow',
    plant: 'today.season.span.plant',
    till: 'today.season.span.till',
    fertilize: 'today.season.span.fertilize',
    spray: 'today.season.span.spray',
    harvest: 'today.season.span.harvest'
  } as const satisfies Record<SeasonSpanKind, string>;

  const VIEW_KEY = {
    day: 'today.view.day',
    week: 'today.view.week',
    month: 'today.view.month',
    season: 'today.view.season'
  } as const satisfies Record<TodayView, string>;

  function ctaFor(e: CalendarEvent): { href: string; label: MessageKey } | null {
    switch (e.kind) {
      case 'spray-window': {
        const stage = (e.detail?.stage as string | undefined) ?? null;
        const params = new URLSearchParams();
        params.set('block', e.blockId);
        if (stage) params.set('windowStage', stage);
        return { href: `/scout?${params.toString()}`, label: 'today.cta.scout' };
      }
      case 'companion-trigger':
      case 'planting':
      case 'seasonal-task':
        return { href: `/plan#block-${e.blockId}`, label: 'today.cta.blockPlan' };
      case 'harvest-window':
      case 'curing-progress':
      case 'curing-ready':
        return { href: '/harvest', label: 'today.cta.harvest' };
      case 'cover-termination':
        return {
          href: `/spray?block=${encodeURIComponent(e.blockId)}&windowStage=BURNDOWN`,
          label: 'today.cta.burndown'
        };
      case 'orchard-task': {
        const taskKey = (e.detail?.taskKey as string | undefined) ?? '';
        if (taskKey === 'harvest') return { href: '/harvest', label: 'today.cta.harvest' };
        if (/spray|fungicide|oil/.test(taskKey)) {
          const params = new URLSearchParams({ block: e.blockId });
          return { href: `/spray?${params.toString()}`, label: 'today.cta.orchardSpray' };
        }
        return { href: `/plan#block-${e.blockId}`, label: 'today.cta.blockPlan' };
      }
    }
    return null;
  }

  function spanDates(s: SeasonSpan): string {
    return fmtRange(s.startMs, s.endMs);
  }
</script>

<svelte:head><title>{tr('today.title')} · CropCard</title></svelte:head>

{#snippet suggestionCard(e: CalendarEvent, dayYmd: string | null = null)}
  {@const cta = ctaFor(e)}
  <div class="suggestion">
    <div class="s-main">
      <strong>{e.title}</strong>
      <span class="s-meta"
        >{fmtRange(e.startMs, e.endMs)} · {cropDisplayNameByEnglish(
          e.varietyDisplayName,
          data.locale
        )} ·
        <span class="s-kind"
          >{EVENT_KIND_LABEL[e.kind]
            ? tr(EVENT_KIND_LABEL[e.kind])
            : e.kind.replace(/-/g, ' ')}</span
        ></span
      >
      {#if e.body}<span class="s-body">{e.body}</span>{/if}
    </div>
    <div class="s-actions">
      {#if cta}<a class="btn ghost" href={cta.href}>{tr(cta.label)}</a>{/if}
      {#if canAct}
        <button
          type="button"
          class="btn ghost"
          aria-label={tr('today.sugg.scheduleAria', { title: e.title })}
          disabled={busy}
          onclick={() => scheduleFromEvent(e, dayYmd)}>{tr('today.sugg.schedule')}</button
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
    >{tr('today.who.moreForEveryone', { count: filtered.hiddenCount })}</button
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
      {userId}
      onDone={(id, minutes) => closeTask(id, 'complete', undefined, minutes)}
      onSkip={(id, reason) => closeTask(id, 'abort', reason)}
      onAssigned={async (name) => {
        liveMessage = name ? tr('today.msg.givenTo', { name }) : tr('today.msg.givenToNobody');
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
    kicker={tr('today.title')}
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
          <a href={c.href}>{c.name}</a>:
          {#if c.count > 0}{c.count}
            {c.count === 1 ? 'log' : 'logs'}{/if}{#if c.count > 0 && c.meatCount > 0},
          {/if}{#if c.meatCount > 0}meat recorded as food{/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if data.winterizeAlerts.length > 0}
  <section class="card winterize-alert" aria-label={tr('today.winter.aria')}>
    <h2>❄ {tr('today.winter.heading')}</h2>
    <p>
      {tr('today.winter.body', { count: data.winterizeAlerts.length })}
    </p>
    <ul>
      {#each data.winterizeAlerts as a (a.sprayerId)}
        <li>
          <a href="/equipment/{encodeURIComponent(a.sprayerId)}/winterize">{a.label}</a>
          {#if a.uncalibrated}<span class="pill">{tr('today.winter.uncalibrated')}</span>{/if}
          {#if a.neverWinterized}<span class="pill">{tr('today.winter.never')}</span>{/if}
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
    <h2 id="care-heading" class="serif">{tr('today.animalCare')}</h2>
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
      {view === 'day'
        ? tr('today.deck.dayHeading')
        : view === 'season'
          ? tr('today.deck.seasonHeading')
          : tr('today.deck.calendarHeading')}
    </h2>
    {#if view === 'day' && summary}<p class="deck-sum" data-testid="deck-summary">{summary}</p>{/if}
  </div>
  <div class="chips" role="group" aria-label={tr('today.deck.show')}>
    {#each TODAY_VIEWS as v (v.id)}
      <button type="button" class="chip" aria-pressed={view === v.id} onclick={() => setView(v.id)}
        >{tr(VIEW_KEY[v.id])}</button
      >
    {/each}
  </div>

  {#if view !== 'season' && hasTeam}
    <div class="who" role="group" aria-label={tr('today.who.aria')} data-testid="who-filter">
      <button
        type="button"
        class="who-seg"
        aria-pressed={who === 'mine'}
        onclick={() => setWho('mine')}>{tr('today.who.mine')}</button
      >
      <button
        type="button"
        class="who-seg"
        aria-pressed={who === 'all'}
        onclick={() => setWho('all')}>{tr('today.who.everyone')}</button
      >
    </div>
  {/if}

  <p class="sr-only" role="status" aria-live="polite">{liveMessage}</p>
  {#if timerStrip}
    <TaskTimer
      variant="strip"
      taskId={timerStrip.taskId}
      taskTitle={timerStrip.taskTitle?.trim() || tr('tasks.timer.aTask')}
      {userId}
      {canAct}
      open={false}
      onStatus={(text) => {
        liveMessage = text;
        stripMessage = text;
      }}
    />
  {:else if stripMessage}
    <p class="strip-note" data-testid="timer-strip-status">{stripMessage}</p>
  {/if}
  {#if trayPrompt}
    <div class="tray-prompt" data-testid="log-tray-prompt">
      <p>{tr('today.tray.prompt')}</p>
      <div class="tray-actions">
        <a class="tray-btn primary" href="{plantingCardHref(trayPrompt.cropId)}#log-tray"
          >{tr('today.tray.log')}</a
        >
        <button type="button" class="tray-btn" onclick={() => (trayPrompt = null)}
          >{tr('today.tray.notNow')}</button
        >
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
          })}>{data.calendar.view === 'week' ? tr('today.print.week') : tr('today.print.month')}</a
        >
      {:else}
        <p class="print-range" data-testid="print-calendar-range">{printRangeNote(data.locale)}</p>
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
        <p class="serif empty-title">{tr('today.empty.mine')}</p>
      </div>
    {:else if deck.length === 0}
      <div class="empty" data-testid="deck-empty">
        <p class="serif empty-title">{tr('today.empty.none')}</p>
        {#if nothingPlanted}
          <p>
            {tr('today.empty.nothingPlanted')}
          </p>
          <a class="btn primary" href="/plan">{tr('today.empty.planCrop')}</a>
        {:else if todayEvents.length > 0}
          <p>{tr('today.empty.suggestionsBelow')}</p>
        {:else}
          <p>{tr('today.empty.nothingDue')}</p>
        {/if}
        {#if !gardenOnly}
          <a class="empty-link" href="/spray">{tr('today.empty.planSpray')}</a>
        {/if}
      </div>
    {:else}
      <ul class="cards" aria-label={tr('today.deck.tasksAria')}>
        {#each deck as d (d.entry.task.id)}
          <li>{@render taskCard(d.entry.task.id)}</li>
        {/each}
      </ul>
    {/if}

    {#if who === 'mine' && filtered.hiddenCount > 0}
      {@render moreForEveryone()}
    {/if}

    {#if todayEvents.length > 0}
      <h3 class="sub-head">{tr('today.sugg.heading')}</h3>
      <p class="hint">
        {tr('today.sugg.hint')}
      </p>
      <ul class="suggestions" aria-label={tr('today.sugg.aria')}>
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
        <p class="hint">{tr('today.sheet.nothingDay')}</p>
      {:else}
        <ul class="sheet-list">
          {#each sheetChips as c (c.key)}
            <li>
              {#if c.type === 'task'}
                {@render taskCard(c.taskId)}
              {:else if suggestions[c.index]}
                <p class="sheet-kicker">{tr('today.sheet.suggestedBy')}</p>
                {@render suggestionCard(suggestions[c.index], sheet.day)}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {:else if sheetRow && data.season}
      {#if sheetRow.spans.length === 0}
        <p class="hint">{tr('today.sheet.noDates')}</p>
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
                    >{tr(SPAN_KEY[s.kind])} · {spanDates(s)} · {s.recorded
                      ? tr('today.sheet.done')
                      : tr('today.sheet.planned')}</span
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
    <strong>{tr('today.stock.low', { count: data.lowStock.length })}</strong>
    <ul class="alert-list">
      {#each data.lowStock as i (i.id)}
        <li>
          <a href="/inventory/{STOCK_CATEGORY_TO_INVENTORY_TYPE[i.category] ?? 'pesticide'}/{i.id}"
            >{i.displayName}</a
          >: {tr('today.stock.lowLine', {
            onHand: i.onHand,
            unit: i.defaultUnit,
            threshold: i.reorderThreshold
          })}
        </li>
      {/each}
    </ul>
  </Banner>
{/if}
{#if data.expiringStock.length > 0}
  <Banner tone="wheat">
    <strong>{tr('today.stock.expiring', { count: data.expiringStock.length })}</strong>
    <ul class="alert-list">
      {#each data.expiringStock as e (e.itemId + (e.lotNumber ?? ''))}
        <li>
          <a
            href="/inventory/{STOCK_CATEGORY_TO_INVENTORY_TYPE[e.category] ??
              'pesticide'}/{e.itemId}">{e.itemName}</a
          >
          {#if e.lotNumber}<code>{e.lotNumber}</code>{/if}: {tr('today.stock.expiryLine', {
            balance: e.balance,
            unit: e.unit,
            count: e.daysUntilExpiry
          })}
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
    note={aiEnabled ? tr('today.legend.aiOn') : tr('today.legend.aiOff')}
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
  .strip-note {
    margin: 8px 0;
    color: var(--color-ink-soft);
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
