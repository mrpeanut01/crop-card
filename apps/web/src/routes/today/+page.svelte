<script lang="ts">
  import type { CalendarEvent } from '$lib/calendar/engine';
  import type { Task } from '$lib/db/tasks';
  import Card from '$lib/components/ui/Card.svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import Banner from '$lib/components/ui/Banner.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import ProvenanceLegend from '$lib/components/ui/ProvenanceLegend.svelte';
  // Phase 25e (#97) — Almanac /today shell components.
  import WeatherStrip from '$lib/components/today/WeatherStrip.svelte';
  import TodayHero from '$lib/components/today/TodayHero.svelte';
  import QuickActions from '$lib/components/today/QuickActions.svelte';
  import WeekStrip, { type WeekItem, type WeekKind } from '$lib/components/today/WeekStrip.svelte';
  import Recommendations, {
    type RecommendationItem
  } from '$lib/components/today/Recommendations.svelte';
  import SeasonGlance from '$lib/components/today/SeasonGlance.svelte';

  let { data } = $props();

  // Phase 25 v2 addendum (#80 partial / #89) — drives AI-on vs AI-off
  // variant. $derived so the variant re-paints on loader re-run.
  const aiEnabled = $derived(data.aiEnabled);

  // Phase 25e (#97) — header strip data.
  const todayDateLabel = $derived(
    new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  );
  // Use first letter of the user email as a friendly hello when no name is
  // wired up. The full session has display name once Phase 26 lands.
  const greeting = $derived.by(() => {
    const hour = new Date().getHours();
    const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    return `Good ${part}.`;
  });
  const subtitle = $derived.by(() => {
    if (data.priorityAction) {
      const wk = data.derivedEvents.length + data.primariesInWindow.length;
      return `One thing to do today. · ${wk} item${wk === 1 ? '' : 's'} this week.`;
    }
    return 'Nothing scheduled today. Check the week strip for what\'s coming.';
  });

  // Phase 25e (#97) — week-strip items map (YYYY-MM-DD → [{title, kind}]).
  const DAY_MS_LOCAL = 24 * 60 * 60 * 1000;
  function todayMidnight(): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const todayStartMs = $derived(todayMidnight());
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
      case 'orchard-task':
      case 'seasonal-task':
        return 'task';
      default:
        return 'task';
    }
  }
  function isoDay(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }
  const weekItemsByDay = $derived.by(() => {
    const out: Record<string, WeekItem[]> = {};
    const weekEndMs = todayStartMs + 7 * DAY_MS_LOCAL;
    for (const t of data.primariesInWindow) {
      if (t.scheduledFor < todayStartMs || t.scheduledFor >= weekEndMs) continue;
      const key = isoDay(t.scheduledFor);
      (out[key] ??= []).push({ title: t.title, kind: weekKindForTask(t) });
    }
    for (const e of data.derivedEvents) {
      if (e.startMs < todayStartMs || e.startMs >= weekEndMs) continue;
      // Skip passive events that pollute the strip (stage transitions, emergence).
      if (e.kind === 'emergence' || e.kind === 'stage-window' || e.kind === 'shade-window') continue;
      const key = isoDay(e.startMs);
      (out[key] ??= []).push({ title: e.title, kind: weekKindForEvent(e) });
    }
    return out;
  });

  // Phase 25e (#97) — recommendations card items (next-14-day plugin events).
  const recommendationItems = $derived.by<RecommendationItem[]>(() => {
    return data.upcoming.slice(0, 8).map((e: CalendarEvent, i: number) => ({
      id: `${e.kind}:${e.blockId}:${e.startMs}:${i}`,
      title: e.title,
      crop: e.varietyDisplayName,
      window: new Date(e.startMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }));
  });

  // Whether to show the legacy schedule view. URL-driven so power users can
  // bookmark e.g. /today?detail=open to default-open.
  let detailOpen = $state(false);

  type Tab = 'today' | '7d' | '30d' | 'season';
  type View = 'list' | 'calendar';
  const TABS: { id: Tab; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: 'Next 7 days' },
    { id: '30d', label: 'Next 30 days' },
    { id: 'season', label: 'Season' }
  ];

  /** Build a URL that preserves the other querystring params. */
  function urlFor(opts: { tab?: Tab; view?: View }): string {
    const params = new URLSearchParams();
    params.set('tab', opts.tab ?? data.tab);
    params.set('view', opts.view ?? data.view);
    return `?${params.toString()}`;
  }

  /** Calendar bucketing: fan all events + tasks into per-day slots so the
   *  calendar layouts can render them without recomputing. */
  type CalendarItem =
    | {
        kind: 'task';
        id: string;
        title: string;
        scheduledFor: number;
        taskKind: 'primary' | 'pre-task' | 'post-task';
      }
    | {
        kind: 'derived';
        title: string;
        startMs: number;
        endMs: number;
        derivedKind: string;
        blockId: string;
      };

  function dayKey(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }

  const calendarBuckets = $derived.by(() => {
    const buckets = new Map<string, CalendarItem[]>();
    const push = (k: string, item: CalendarItem) => {
      const list = buckets.get(k) ?? [];
      list.push(item);
      buckets.set(k, list);
    };
    for (const t of data.primariesInWindow) {
      push(dayKey(t.scheduledFor), {
        kind: 'task',
        id: t.id,
        title: t.title,
        scheduledFor: t.scheduledFor,
        taskKind: 'primary'
      });
    }
    for (const list of Object.values(data.tasksByPrimary as Record<string, Task[]>)) {
      for (const t of list) {
        push(dayKey(t.scheduledFor), {
          kind: 'task',
          id: t.id,
          title: t.title,
          scheduledFor: t.scheduledFor,
          taskKind: t.kind as 'pre-task' | 'post-task'
        });
      }
    }
    for (const e of data.derivedEvents) {
      push(dayKey(e.startMs), {
        kind: 'derived',
        title: e.title,
        startMs: e.startMs,
        endMs: e.endMs,
        derivedKind: e.kind,
        blockId: e.blockId
      });
    }
    return buckets;
  });

  /** Generate the days that the calendar should display in grid cells. */
  function gridDays(tab: Tab, fromMs: number): { date: string; ms: number }[] {
    const start = new Date(fromMs);
    start.setHours(0, 0, 0, 0);
    const count = tab === '7d' ? 7 : tab === '30d' ? 28 : tab === 'season' ? 84 : 1;
    const out: { date: string; ms: number }[] = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(start.getTime() + i * 86_400_000);
      out.push({ date: dayKey(d.getTime()), ms: d.getTime() });
    }
    return out;
  }

  function dayLabel(ms: number): string {
    const d = new Date(ms);
    return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getMonth() + 1}/${d.getDate()}`;
  }

  let busy = $state(false);
  let actionError = $state<string | null>(null);

  function fmtDate(ms: number): string {
    return new Date(ms).toLocaleDateString();
  }

  function fmtDateTime(ms: number): string {
    return new Date(ms).toLocaleString();
  }

  /** Promote a calendar-engine derived event into a real Task. */
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
        actionError = out.error ?? 'failed to schedule';
        return;
      }
      window.location.reload();
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function patchTask(id: string, body: Record<string, unknown>) {
    busy = true;
    actionError = null;
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        actionError = out.error ?? 'failed';
        return;
      }
      window.location.reload();
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  function preTasksFor(taskId: string): Task[] {
    return (data.tasksByPrimary as Record<string, Task[]>)[taskId] ?? [];
  }

  function fmtRange(startMs: number, endMs: number) {
    const a = new Date(startMs).toLocaleDateString();
    if (startMs === endMs) return a;
    const b = new Date(endMs).toLocaleDateString();
    return `${a} – ${b}`;
  }

  /**
   * Map a calendar event to a deep-link URL + a button label so the user can
   * one-tap from "today's action" into the right page with context filled in.
   */
  function ctaFor(e: CalendarEvent): { href: string; label: string } | null {
    switch (e.kind) {
      case 'spray-window': {
        const stage = (e.detail?.stage as string | undefined) ?? null;
        const params = new URLSearchParams();
        params.set('block', e.blockId);
        if (stage) params.set('windowStage', stage);
        return {
          href: `/scout?${params.toString()}`,
          label: 'Scout this block →'
        };
      }
      case 'companion-trigger':
        return {
          href: `/plan#block-${e.blockId}`,
          label: 'Open block plan →'
        };
      case 'harvest-window':
        // The plantingId isn't carried on the event; jump to /harvest where
        // the readiness card with the right block + variety auto-focuses.
        return { href: `/harvest`, label: 'Open harvest →' };
      case 'cover-termination':
        return {
          href: `/spray?block=${encodeURIComponent(e.blockId)}&windowStage=BURNDOWN`,
          label: 'Plan burndown →'
        };
      case 'planting':
        return { href: `/plan#block-${e.blockId}`, label: 'Open block plan →' };
      case 'orchard-task': {
        const taskKey = (e.detail?.taskKey as string | undefined) ?? '';
        // Spray-related orchard tasks → spray flow; harvest → harvest page.
        if (taskKey === 'harvest') return { href: '/harvest', label: 'Open harvest →' };
        const isSpray = /spray|fungicide|oil/.test(taskKey);
        if (isSpray) {
          const params = new URLSearchParams({ block: e.blockId });
          return {
            href: `/spray?${params.toString()}`,
            label: 'Plan this orchard spray →'
          };
        }
        return { href: `/plan#block-${e.blockId}`, label: 'Open block plan →' };
      }
      case 'curing-progress':
      case 'curing-ready':
        return { href: '/harvest', label: 'Open harvest →' };
      case 'seasonal-task':
        return { href: `/plan#block-${e.blockId}`, label: 'Open block plan →' };
      case 'emergence':
        return null;
    }
    return null;
  }
</script>

<!-- Phase 25e (#97) — Almanac /today shell. Greeting + weather strip,
     hero card + quick actions, week strip + recommendations + glance.
     1:1 with `direction-almanac-today.jsx` ATodayScreen. -->
<WeatherStrip
  dateLabel={todayDateLabel}
  {greeting}
  {subtitle}
  weather={data.weatherSummary}
/>

<div class="t-grid">
  <TodayHero action={data.priorityAction} {aiEnabled} />
  <QuickActions />
</div>

<div class="t-grid t-grid-second">
  <WeekStrip {todayStartMs} items={weekItemsByDay} />
  <div class="t-side-stack">
    <Recommendations {aiEnabled} items={recommendationItems} />
    <SeasonGlance glance={data.seasonGlance} />
  </div>
</div>

<div class="legend-tail">
  <ProvenanceLegend
    shown={aiEnabled
      ? ['plugin', 'data', 'ai', 'manual']
      : ['plugin', 'data', 'fallback', 'manual']}
    note={aiEnabled
      ? 'AI on · recommendations Claude-ranked · all editable'
      : 'AI off · plugin + your records · all editable'}
  />
</div>

<details class="legacy-detail" bind:open={detailOpen}>
  <summary>Full schedule view — tasks · calendar · sprayers · kernel info</summary>
<div class="tab-row">
  <div class="tabs" role="tablist" aria-label="Calendar window">
    {#each TABS as t (t.id)}
      <a
        class="tab"
        class:active={data.tab === t.id}
        role="tab"
        aria-selected={data.tab === t.id}
        href={urlFor({ tab: t.id })}
      >
        {t.label}
      </a>
    {/each}
  </div>
  <nav class="view-toggle" aria-label="View mode">
    <a
      class="view"
      class:active={data.view === 'list'}
      href={urlFor({ view: 'list' })}
      aria-current={data.view === 'list' ? 'page' : undefined}
    >
      ☰ List
    </a>
    <a
      class="view"
      class:active={data.view === 'calendar'}
      href={urlFor({ view: 'calendar' })}
      aria-current={data.view === 'calendar' ? 'page' : undefined}
    >
      ▦ Calendar
    </a>
  </nav>
</div>

{#if actionError}
  <Banner tone="rust" urgent>{actionError}</Banner>
{/if}

{#if data.view === 'calendar'}
  <section class="card calendar-panel" aria-label="Calendar view">
    {#if data.tab === 'today'}
      {@const today = gridDays('today', data.tabFromMs)[0]}
      {@const items = calendarBuckets.get(today.date) ?? []}
      <h2>{dayLabel(today.ms)}</h2>
      {#if items.length === 0}
        <p class="hint">Nothing scheduled today.</p>
      {:else}
        <ul class="day-strip">
          {#each items.sort((a, b) => (a.kind === 'task' ? a.scheduledFor : a.startMs) - (b.kind === 'task' ? b.scheduledFor : b.startMs)) as item, i (i)}
            <li class="day-item kind-{item.kind === 'task' ? item.taskKind : item.derivedKind}">
              <span class="when">
                {#if item.kind === 'task'}
                  {new Date(item.scheduledFor).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                {:else}
                  {new Date(item.startMs).toLocaleDateString()}
                {/if}
              </span>
              <strong>{item.title}</strong>
              {#if item.kind === 'derived'}
                <span class="kind-chip">{item.derivedKind}</span>
              {:else}
                <span class="kind-chip">{item.taskKind}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {:else if data.tab === '7d'}
      <h2>Next 7 days</h2>
      <div class="week-grid">
        {#each gridDays('7d', data.tabFromMs) as d (d.date)}
          <div class="day-cell">
            <header>{dayLabel(d.ms)}</header>
            {#each calendarBuckets.get(d.date) ?? [] as item, i (i)}
              <div class="cell-item kind-{item.kind === 'task' ? item.taskKind : item.derivedKind}">
                <strong>{item.title}</strong>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {:else if data.tab === '30d'}
      <h2>Next 30 days</h2>
      <div class="month-grid">
        {#each gridDays('30d', data.tabFromMs) as d (d.date)}
          {@const items = calendarBuckets.get(d.date) ?? []}
          <div class="month-cell" class:has-items={items.length > 0}>
            <span class="month-day">{new Date(d.ms).getDate()}</span>
            {#if items.length > 0}
              <span class="dot" title={items.map((it) => it.title).join('\n')}>{items.length}</span>
            {/if}
          </div>
        {/each}
      </div>
      <p class="hint">
        Each cell shows the count of scheduled tasks + plugin events. Switch to List to drill in.
      </p>
    {:else if data.tab === 'season'}
      <h2>Season — active crops</h2>
      {#if data.activeCrops.length === 0}
        <p class="hint">No active crops yet. Plant a crop on /plan to see a season strip here.</p>
      {:else}
        <div class="gantt">
          <div class="gantt-axis">
            {#each gridDays('season', data.tabFromMs).filter((_, i) => i % 7 === 0) as d (d.date)}
              <span class="gantt-week"
                >{new Date(d.ms).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric'
                })}</span
              >
            {/each}
          </div>
          {#each data.activeCrops as crop (crop.id)}
            <div class="gantt-row">
              <span class="gantt-label">{crop.varietyDisplayName}</span>
              <div class="gantt-track">
                {#each data.derivedEvents.filter((e) => e.blockId === crop.blockId) as e, i (i)}
                  {@const startPct =
                    ((e.startMs - data.tabFromMs) / (data.tabToMs - data.tabFromMs)) * 100}
                  {@const widthPct =
                    ((e.endMs - e.startMs) / (data.tabToMs - data.tabFromMs)) * 100}
                  <span
                    class="gantt-span kind-{e.kind}"
                    style="left:{Math.max(0, startPct)}%; width:{Math.max(1, widthPct)}%"
                    title="{e.title} — {new Date(e.startMs).toLocaleDateString()}"
                  ></span>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </section>
{/if}

<section
  class="card task-panel"
  aria-label="Scheduled tasks in window"
  class:hidden={data.view === 'calendar' && data.tab !== 'today'}
>
  <h2>
    {#if data.tab === 'today'}Today's tasks{:else if data.tab === '7d'}Next 7 days{:else if data.tab === '30d'}Next
      30 days{:else}Season{/if}
  </h2>

  {#if data.primariesInWindow.length === 0 && data.derivedEvents.length === 0}
    <p class="hint">
      Nothing scheduled in this window. Plugin suggestions below will appear once a crop is planted.
    </p>
  {/if}

  {#each data.primariesInWindow as primary (primary.id)}
    {@const pre = preTasksFor(primary.id).filter((t) => t.kind === 'pre-task')}
    {@const post = preTasksFor(primary.id).filter((t) => t.kind === 'post-task')}
    <article class="primary-task">
      <header>
        <span class="when">{fmtDateTime(primary.scheduledFor)}</span>
        <strong class="title">{primary.title}</strong>
      </header>
      {#if primary.body}<p class="body">{primary.body}</p>{/if}
      {#if pre.length > 0}
        <details open>
          <summary>{pre.length} pre-task{pre.length === 1 ? '' : 's'}</summary>
          <ul class="linked">
            {#each pre as t (t.id)}
              <li>
                <span class="when">{fmtDateTime(t.scheduledFor)}</span>
                <strong>{t.title}</strong>
                {#if t.body}<span class="body">— {t.body}</span>{/if}
                <button
                  class="mini"
                  onclick={() => patchTask(t.id, { action: 'complete' })}
                  disabled={busy}
                >
                  ✓ Done
                </button>
              </li>
            {/each}
          </ul>
        </details>
      {/if}
      {#if post.length > 0}
        <details>
          <summary>{post.length} post-task{post.length === 1 ? '' : 's'}</summary>
          <ul class="linked">
            {#each post as t (t.id)}
              <li>
                <span class="when">{fmtDateTime(t.scheduledFor)}</span>
                <strong>{t.title}</strong>
                {#if t.body}<span class="body">— {t.body}</span>{/if}
                <button
                  class="mini"
                  onclick={() => patchTask(t.id, { action: 'complete' })}
                  disabled={busy}
                >
                  ✓ Done
                </button>
              </li>
            {/each}
          </ul>
        </details>
      {/if}
      <div class="row">
        <button
          class="primary"
          onclick={() => patchTask(primary.id, { action: 'complete' })}
          disabled={busy}
        >
          ✓ Mark primary complete
        </button>
        <button
          class="secondary"
          onclick={() => patchTask(primary.id, { action: 'abort', reason: 'aborted from /today' })}
          disabled={busy}
        >
          Abort
        </button>
      </div>
    </article>
  {/each}

  {#if data.derivedEvents.length > 0}
    <h3 class="suggestions-heading">Plugin suggestions</h3>
    <p class="hint">
      Calendar engine derived these from your active crops. Click <strong>Schedule</strong> to promote
      one to a task you can attach pre/post-tasks to.
    </p>
    <ul class="suggestions">
      {#each data.derivedEvents as e (e.kind + e.blockId + e.startMs + e.title)}
        <li>
          <span class="when">{fmtDate(e.startMs)}</span>
          <strong>{e.title}</strong>
          <span class="kind">{e.kind}</span>
          {#if e.body}<span class="body">— {e.body}</span>{/if}
          <button class="mini" onclick={() => scheduleFromEvent(e)} disabled={busy}>
            + Schedule
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if data.tab === 'season' && data.activeCrops.length > 0}
    <h3 class="suggestions-heading">Active crops</h3>
    <ul class="active-crops">
      {#each data.activeCrops as c (c.id)}
        <li>
          <strong>{c.varietyDisplayName}</strong>
          — block {c.blockId.slice(0, 8)} — {c.plantingDate
            ? `planted ${fmtDate(c.plantingDate)}`
            : 'planned'}
          <Pill tone={c.status === 'active' ? 'forest' : 'neutral'}>{c.status}</Pill>
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if !data.bootstrapDone}
  <Card loose>
    <Kicker>UC-20 · One-time setup</Kicker>
    <h2 class="serif bootstrap-title">Get started</h2>
    <p class="bootstrap-lede">
      A few one-time setup steps. CropCard plans, calibrates, and records around blocks + sprayers —
      once these three are in place, the calendar drives the rest.
    </p>
    <ol class="bootstrap-steps">
      <li class:done={data.bootstrap.hasBlock && data.bootstrap.hasPlanting}>
        <span class="step-num" aria-hidden="true">
          {data.bootstrap.hasBlock && data.bootstrap.hasPlanting ? '✓' : '1'}
        </span>
        <div class="step-body">
          <strong>Add your first block & planting</strong>
          <small>
            {#if data.bootstrap.hasBlock && data.bootstrap.hasPlanting}
              Done.
            {:else if data.bootstrap.hasBlock}
              Block added. Now record a planting in it.
            {:else}
              A block is your field; a planting is what's growing in it.
            {/if}
          </small>
          {#if !(data.bootstrap.hasBlock && data.bootstrap.hasPlanting)}
            <a href="/plan" class="bootstrap-cta"><Button variant="primary" size="sm">Open Plan →</Button></a>
          {/if}
        </div>
      </li>
      <li class:done={data.bootstrap.hasSprayer}>
        <span class="step-num" aria-hidden="true">
          {data.bootstrap.hasSprayer ? '✓' : '2'}
        </span>
        <div class="step-body">
          <strong>Register a sprayer</strong>
          <small>
            {#if data.bootstrap.hasSprayer}
              Done.
            {:else}
              The kernel won't let you spray without one — it tracks chemistry & decon state.
            {/if}
          </small>
          {#if !data.bootstrap.hasSprayer}
            <a href="/equipment" class="bootstrap-cta"><Button variant="primary" size="sm">Open Equipment →</Button></a>
          {/if}
        </div>
      </li>
      <li class:done={data.bootstrap.hasCalibration}>
        <span class="step-num" aria-hidden="true">
          {data.bootstrap.hasCalibration ? '✓' : '3'}
        </span>
        <div class="step-body">
          <strong>Calibrate the sprayer</strong>
          <small>
            {#if data.bootstrap.hasCalibration}
              Done.
            {:else}
              UC-10 1/128-acre method. The dilution calculator scales every product rate by GPA.
            {/if}
          </small>
          {#if data.bootstrap.hasSprayer && !data.bootstrap.hasCalibration}
            <a href="/calibrate" class="bootstrap-cta"><Button variant="primary" size="sm">Open Calibrate →</Button></a>
          {/if}
        </div>
      </li>
    </ol>
  </Card>
{/if}

{#if data.lowStock.length > 0}
  <Banner tone="wheat">
    <strong>{data.lowStock.length} SKU{data.lowStock.length === 1 ? '' : 's'} low on stock:</strong>
    <ul class="alert-list">
      {#each data.lowStock as i (i.id)}
        <li>
          <a href="/stock/{i.id}">{i.displayName}</a>
          — {i.onHand} {i.defaultUnit} on hand (reorder at {i.reorderThreshold} {i.defaultUnit})
        </li>
      {/each}
    </ul>
  </Banner>
{/if}
{#if data.expiringStock.length > 0}
  <Banner tone="wheat">
    <strong>{data.expiringStock.length} lot{data.expiringStock.length === 1 ? '' : 's'} expiring within 30 days:</strong>
    <ul class="alert-list">
      {#each data.expiringStock as e (e.itemId + (e.lotNumber ?? ''))}
        <li>
          <a href="/stock/{e.itemId}">{e.itemName}</a>
          {#if e.lotNumber}<code>{e.lotNumber}</code>{/if}
          — {e.balance} {e.unit}, {e.daysUntilExpiry} day{e.daysUntilExpiry === 1 ? '' : 's'} left
        </li>
      {/each}
    </ul>
  </Banner>
{/if}

{#if data.eventsToday.length > 0}
  <section class="card today-actions">
    <h2>Today's actions</h2>
    <ul>
      {#each data.eventsToday as e (e.cropPluginId + e.title + e.startMs)}
        {@const cta = ctaFor(e)}
        <li class="event {e.kind}">
          <strong>{e.title}</strong>
          <small>{fmtRange(e.startMs, e.endMs)} · {e.varietyDisplayName}</small>
          {#if e.body}<p>{e.body}</p>{/if}
          {#if cta}
            <a class="cta" href={cta.href}>{cta.label}</a>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{:else}
  <section class="card empty">
    <h2>No scheduled action today</h2>
    <p>
      {#if data.counts.blocks === 0}
        Add a block on <a href="/plan">/plan</a> with a planting record to see calendar-driven actions
        here.
      {:else}
        Calendar engine has nothing for today. Plan a one-off spray on <a href="/spray">/spray</a> if
        needed.
      {/if}
    </p>
    <a href="/spray" class="primary">Plan a spray</a>
  </section>
{/if}

{#if data.upcoming.length > 0}
  <section class="card">
    <h2>Next 14 days</h2>
    <ul class="upcoming">
      {#each data.upcoming.slice(0, 12) as e (e.cropPluginId + e.title + e.startMs)}
        {@const cta = ctaFor(e)}
        <li class="event {e.kind}">
          <span class="when">{fmtRange(e.startMs, e.endMs)}</span>
          <strong>{e.title}</strong>
          <small>{e.varietyDisplayName}</small>
          {#if cta}<a class="cta-small" href={cta.href}>{cta.label}</a>{/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section class="card">
  <h2>Sprayers</h2>
  <ul class="sprayers">
    {#each data.sprayers as s (s.id)}
      <li>
        <strong>{s.label}</strong>
        <span class="id">{s.id}</span>
        {#if s.lastChemistryClass}
          <span class="warn">last load: {s.lastChemistryClass}</span>
          <a href="/spray/decon?sprayer={encodeURIComponent(s.id)}" class="link">Decon →</a>
        {:else}
          <span class="ok">clean</span>
        {/if}
        {#if s.lastDeconAt}
          <span class="meta">decon {new Date(s.lastDeconAt).toLocaleString()}</span>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<section class="card audit">
  <h2>Kernel</h2>
  <dl>
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
      <dd class="warn">
        <ul>
          {#each data.pluginFailures as f}<li>{f}</li>{/each}
        </ul>
      </dd>
    {/if}
  </dl>
</section>
</details>

<style>
  /* Phase 25e (#97) — Almanac /today shell layout. */
  .t-grid {
    display: grid;
    grid-template-columns: 1.7fr 1fr;
    gap: 18px;
    margin-bottom: 18px;
  }
  .t-grid-second {
    margin-bottom: 22px;
  }
  .t-side-stack {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .legend-tail {
    margin: 0 0 22px;
  }
  .legacy-detail {
    margin-top: 8px;
    border-top: 1px solid var(--color-divider-soft, var(--color-divider));
    padding-top: 14px;
  }
  .legacy-detail > summary {
    cursor: pointer;
    color: var(--color-forest-deep);
    font-weight: 600;
    font-size: 13px;
    list-style: revert;
    margin-bottom: 12px;
    padding: 6px 0;
  }
  .legacy-detail > summary:hover {
    color: var(--color-forest);
  }
  @media (max-width: 900px) {
    .t-grid,
    .t-grid-second {
      grid-template-columns: 1fr;
    }
  }
  .tab-row {
    display: flex;
    align-items: end;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0 0 1rem;
    border-bottom: 2px solid var(--color-divider);
  }
  .tabs {
    display: flex;
    gap: 0;
    overflow-x: auto;
  }
  .tab {
    padding: 0.6rem 1rem;
    color: #555;
    text-decoration: none;
    border-bottom: 3px solid transparent;
    margin-bottom: -2px;
    font-weight: 600;
    white-space: nowrap;
    min-height: 48px;
    display: flex;
    align-items: center;
  }
  .tab.active {
    color: var(--color-forest);
    border-bottom-color: var(--color-forest);
    background: var(--color-cream);
  }
  .view-toggle {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 4px;
  }
  .view {
    padding: 0.4rem 0.75rem;
    color: #555;
    text-decoration: none;
    border: 1px solid var(--color-divider);
    border-radius: 4px;
    font-size: 0.85rem;
    font-weight: 600;
    background: white;
    min-height: 36px;
    display: flex;
    align-items: center;
  }
  .view.active {
    background: var(--color-forest);
    color: white;
    border-color: var(--color-forest);
  }
  .calendar-panel {
    background: white;
    padding: 1.25rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .day-strip {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .day-strip li {
    display: flex;
    gap: 0.6rem;
    padding: 0.6rem;
    border-left: 3px solid var(--color-divider);
    margin-bottom: 0.3rem;
    background: var(--color-cream);
    border-radius: 0 4px 4px 0;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .day-strip li.kind-primary {
    border-left-color: var(--color-forest);
  }
  .day-strip li.kind-pre-task {
    border-left-color: var(--color-wheat);
  }
  .day-strip li.kind-post-task {
    border-left-color: #4a6ea3;
  }
  .day-strip li.kind-spray-window {
    border-left-color: #4a6ea3;
  }
  .kind-chip {
    background: white;
    color: #555;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    text-transform: uppercase;
    border: 1px solid var(--color-divider);
  }
  .week-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 0.4rem;
  }
  .day-cell {
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    min-height: 110px;
    padding: 0.4rem;
    background: var(--color-cream);
  }
  .day-cell header {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--color-forest);
    margin-bottom: 0.3rem;
    text-transform: uppercase;
  }
  .cell-item {
    background: white;
    border-radius: 3px;
    padding: 0.2rem 0.35rem;
    margin-bottom: 0.2rem;
    font-size: 0.78rem;
    border-left: 3px solid var(--color-divider);
  }
  .cell-item.kind-primary {
    border-left-color: var(--color-forest);
  }
  .cell-item.kind-pre-task {
    border-left-color: var(--color-wheat);
  }
  .cell-item.kind-post-task {
    border-left-color: #4a6ea3;
  }
  .cell-item.kind-spray-window {
    border-left-color: #4a6ea3;
  }
  .month-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 0.2rem;
  }
  .month-cell {
    aspect-ratio: 1;
    background: var(--color-cream);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 0.3rem;
    font-size: 0.85rem;
  }
  .month-cell.has-items {
    background: #e7f1ea;
    border: 1px solid var(--color-forest);
  }
  .month-day {
    color: #888;
    font-weight: 600;
  }
  .month-cell .dot {
    background: var(--color-forest);
    color: white;
    border-radius: 999px;
    text-align: center;
    width: 1.4rem;
    height: 1.4rem;
    line-height: 1.4rem;
    font-size: 0.75rem;
    font-weight: 700;
    margin-left: auto;
  }
  .gantt {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .gantt-axis {
    display: flex;
    gap: 0;
    padding-left: 8rem;
    color: #888;
    font-size: 0.7rem;
  }
  .gantt-week {
    flex: 1 0 0;
    text-align: left;
    padding: 0 0.2rem;
    border-left: 1px solid #eee;
  }
  .gantt-row {
    display: grid;
    grid-template-columns: 8rem 1fr;
    align-items: center;
    gap: 0.5rem;
  }
  .gantt-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-forest);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gantt-track {
    position: relative;
    height: 1.6rem;
    background: var(--color-cream);
    border-radius: 4px;
  }
  .gantt-span {
    position: absolute;
    top: 0.2rem;
    bottom: 0.2rem;
    background: rgba(31, 94, 58, 0.6);
    border-radius: 3px;
  }
  .gantt-span.kind-spray-window {
    background: rgba(74, 110, 163, 0.6);
  }
  .gantt-span.kind-harvest-window {
    background: rgba(179, 89, 0, 0.6);
  }
  .gantt-span.kind-orchard-task {
    background: rgba(120, 84, 184, 0.6);
  }
  .hidden {
    display: none;
  }
  .task-panel {
    background: white;
    padding: 1.25rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .primary-task {
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    padding: 0.75rem;
    margin-bottom: 0.75rem;
  }
  .primary-task header {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    margin-bottom: 0.4rem;
  }
  .primary-task .when {
    color: #777;
    font-size: 0.85rem;
  }
  .primary-task .title {
    font-size: 1rem;
  }
  .primary-task .body {
    color: #444;
    font-size: 0.9rem;
    margin: 0.25rem 0;
  }
  ul.linked {
    list-style: none;
    padding: 0.5rem 0 0;
    margin: 0;
  }
  ul.linked li {
    display: flex;
    gap: 0.4rem;
    align-items: baseline;
    flex-wrap: wrap;
    padding: 0.3rem 0;
    border-top: 1px dashed #e5e5e5;
    font-size: 0.9rem;
  }
  details summary {
    cursor: pointer;
    color: var(--color-forest);
    font-weight: 600;
    margin: 0.4rem 0;
  }
  .suggestions {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .suggestions li {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    flex-wrap: wrap;
    padding: 0.5rem 0;
    border-top: 1px solid #eee;
    font-size: 0.9rem;
  }
  .suggestions .kind {
    background: #f0f3f0;
    color: #555;
    border-radius: 3px;
    padding: 0.05rem 0.4rem;
    font-size: 0.75rem;
    text-transform: uppercase;
  }
  .suggestions-heading {
    margin-top: 1rem;
    color: #555;
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .active-crops {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
    font-size: 0.9rem;
  }
  .active-crops li {
    padding: 0.3rem 0;
    border-top: 1px solid #eee;
  }
  .status {
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.75rem;
    text-transform: uppercase;
    margin-left: 0.4rem;
  }
  .status-active {
    background: #e7f1ea;
    color: var(--color-forest);
  }
  .status-harvested {
    background: #fff8e1;
    color: var(--color-wheat);
  }
  .row {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.6rem;
    flex-wrap: wrap;
  }
  .primary,
  .secondary,
  .mini {
    border: none;
    cursor: pointer;
    border-radius: 4px;
    font-weight: 600;
  }
  .primary {
    background: var(--color-forest);
    color: white;
    padding: 0.5rem 0.9rem;
    /* T-06 (audit F-H): 44px violated the CLAUDE.md field-UI invariant
     * (≥48 dp tap targets for glove-operability). Bumped to 48 px so
     * Marco can hit the primary Today CTA reliably with gloves on. */
    min-height: 48px;
  }
  .secondary {
    background: #f0f3f0;
    color: var(--color-forest);
    padding: 0.5rem 0.9rem;
    /* T-06 (audit F-H): see .primary above. */
    min-height: 48px;
    border: 1px solid var(--color-forest);
  }
  .mini {
    background: var(--color-forest);
    color: white;
    font-size: 0.8rem;
    padding: 0.25rem 0.6rem;
    min-height: 32px;
  }
  .primary:disabled,
  .secondary:disabled,
  .mini:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .hint {
    color: #666;
    font-size: 0.9rem;
    margin: 0.4rem 0;
  }
  .error {
    background: #fce4e4;
    color: var(--color-rust);
    padding: 0.6rem;
    border-radius: 4px;
    margin: 0.5rem 0;
  }
  /* .alert-list is the <ul> inside the Banner low-stock / expiring lists
     (replaced .stock-alert / .stock-alert ul / .stock-alert code that
     backed the old bespoke <section class="stock-alerts">). */
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
  .date {
    margin: 0;
    color: #555;
    font-family: monospace;
  }
  .card {
    background: white;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: var(--color-forest);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .empty {
    text-align: center;
    padding: 2rem 1rem;
  }
  .empty h2 {
    color: #555;
  }
  .primary {
    display: inline-block;
    background: var(--color-forest);
    color: white;
    padding: 0.9rem 1.5rem;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
    margin-top: 0.75rem;
    min-height: 48px;
    line-height: 1.4;
  }
  .today-actions ul,
  .upcoming {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .today-actions li,
  .upcoming li {
    padding: 0.6rem 0.75rem;
    border-left: 4px solid var(--color-forest);
    background: #f8fbf9;
    margin: 0.4rem 0;
    border-radius: 0 4px 4px 0;
  }
  .event small {
    color: #555;
    margin-left: 0.5rem;
    font-family: monospace;
  }
  .event.spray-window {
    border-left-color: var(--color-wheat);
    background: #fff8ec;
  }
  .event.companion-trigger {
    border-left-color: #4d8e36;
  }
  .event.harvest-window {
    border-left-color: #6b3fa0;
    background: #f5f0fa;
  }
  .event.cover-termination {
    border-left-color: #777;
  }
  .event p {
    margin: 0.25rem 0 0;
    font-size: 0.9rem;
  }
  .cta {
    display: inline-flex;
    align-items: center;
    margin-top: 0.5rem;
    background: var(--color-forest);
    color: white;
    text-decoration: none;
    padding: 0.9rem 1.25rem;
    border-radius: 4px;
    font-weight: 600;
    font-size: 1rem;
    min-height: 60px;
    line-height: 1.4;
  }
  .cta-small {
    margin-left: auto;
    color: var(--color-forest);
    text-decoration: none;
    font-weight: 600;
    font-size: 0.85rem;
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--color-forest);
    border-radius: 4px;
  }
  .upcoming li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .upcoming .when {
    font-family: monospace;
    color: #555;
    min-width: 11rem;
  }
  .sprayers {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .sprayers li {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.5rem 0;
    border-top: 1px solid #eee;
  }
  .sprayers li:first-child {
    border-top: none;
  }
  .sprayers .id {
    font-family: monospace;
    color: #666;
    font-size: 0.85rem;
  }
  .sprayers .warn {
    background: var(--pill-wheat-bg);
    color: var(--color-wheat);
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .sprayers .ok {
    background: #e7f1ea;
    color: var(--color-forest);
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .sprayers .meta {
    color: #777;
    font-size: 0.8rem;
  }
  .sprayers .link {
    margin-left: auto;
    color: var(--color-rust);
    text-decoration: none;
    font-weight: 600;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.4rem 1rem;
    margin: 0;
  }
  dt {
    color: #666;
  }
  dd {
    margin: 0;
  }
  dd code {
    background: #f5f5f5;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
  }
  .warn ul {
    margin: 0;
    padding-left: 1.25rem;
  }
  /* .bootstrap section is now the Card primitive — its own wrapper
     styles are gone. .bootstrap-title is the serif h2 inside Card. */
  .bootstrap-title {
    margin-top: 4px;
    margin-bottom: 0.75rem;
  }
  .bootstrap-lede {
    color: #555;
    margin: 0 0 1rem;
  }
  .bootstrap-steps {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .bootstrap-steps li {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.75rem;
    padding: 0.75rem;
    border-radius: 6px;
    background: white;
    border-left: 4px solid var(--color-forest);
  }
  .bootstrap-steps li.done {
    opacity: 0.65;
    border-left-color: #888;
  }
  .step-num {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--color-forest);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 1.1rem;
  }
  .bootstrap-steps li.done .step-num {
    background: #4d8e36;
  }
  .step-body {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .step-body small {
    color: #555;
  }
  .step-body .cta {
    display: inline-flex;
    align-items: center;
    margin-top: 0.4rem;
    padding: 0.7rem 1rem;
    background: var(--color-forest);
    color: white;
    text-decoration: none;
    border-radius: 4px;
    font-weight: 600;
    min-height: 60px;
    line-height: 1.4;
    align-self: flex-start;
  }
</style>
