<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import { MAX_TASK_MINUTES, MIN_TASK_MINUTES, formatHours } from '$lib/labour/hours';
  import { formatInstant } from '$lib/prefs';
  import { currentPrefs } from '$lib/prefsState.svelte';
  import type { TaskTimerRow } from '$lib/client/dexie';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { activeCardOwnerId } from '$lib/client/cardStore';
  import { primeActiveOwnerId } from '$lib/client/syncQueue';
  import { loadTaskTime, removeTaskTime, saveTaskTime } from '$lib/client/taskTimeClient';
  import {
    TASK_TIMER_EVENT,
    clockText,
    elapsedMinutes,
    needsRealTime,
    runningTimer,
    startTimer,
    stopTimer,
    timerStorageAvailable,
    tooShortToSave
  } from '$lib/client/taskTimer';
  import type { TaskTimeSummary } from '$lib/tasks/timeEntries';

  interface Props {
    taskId: string;
    taskTitle: string;
    userId: string;
    canAct: boolean;
    open: boolean;
    /** Where the host can close the task: Stop then offers Done, which
     *  hands over the minutes. The host clears the timer once Done saves. */
    onDone?: (minutes: number) => void;
    /** `strip` is the one-line "Timer running" bar on /today for a task
     *  that is not in view (D-28): Stop only, no Start, no saved time. */
    variant?: 'card' | 'strip';
    /** Hears each outcome, for a host whose strip unmounts once stopped. */
    onStatus?: (text: string) => void;
  }
  const {
    taskId,
    taskTitle,
    userId,
    canAct,
    open,
    onDone,
    variant = 'card',
    onStatus
  }: Props = $props();
  const uid = $props.id();
  const tr = $derived(createT(page.data?.locale));

  let ready = $state(false);
  let available = $state(false);
  let row = $state<TaskTimerRow | null>(null);
  let now = $state(Date.now());
  let status = $state('');
  function say(text: string) {
    status = text;
    if (text) onStatus?.(text);
  }
  let busy = $state(false);

  let sheet = $state<{ stopAt: number; startedAt: number } | null>(null);
  let typed = $state<number | string | null>('');
  let sheetError = $state('');

  let timeOpen = $state(false);
  let timeState = $state<'idle' | 'loading' | 'offline' | 'error' | 'ok'>('idle');
  let summary = $state<TaskTimeSummary | null>(null);
  let timeError = $state('');

  const prefs = $derived(currentPrefs());
  const mine = $derived(row !== null && row.taskId === taskId);
  const canStart = $derived(available && canAct && open && !mine);
  const short = $derived(sheet ? tooShortToSave(sheet.startedAt, sheet.stopAt) : false);
  const long = $derived(sheet ? needsRealTime(sheet.startedAt, sheet.stopAt) : false);
  const counted = $derived(sheet ? elapsedMinutes(sheet.startedAt, sheet.stopAt) : 0);
  const typedMinutes = $derived(Number(typed));
  const typedValid = $derived(
    typed !== null &&
      String(typed).trim() !== '' &&
      Number.isInteger(typedMinutes) &&
      typedMinutes >= MIN_TASK_MINUTES &&
      typedMinutes <= MAX_TASK_MINUTES
  );
  const sheetMinutes = $derived(long ? (typedValid ? typedMinutes : null) : counted);
  const ranFor = $derived.by(() => {
    if (!sheet) return '';
    const ms = sheet.stopAt - sheet.startedAt;
    if (!Number.isFinite(ms) || ms < 0) return '';
    return formatHours(ms / 60_000);
  });

  async function refresh() {
    now = Date.now();
    if (!available) return;
    row = await runningTimer(userId);
  }

  onMount(() => {
    let live = true;
    let tick: ReturnType<typeof setInterval> | null = null;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onChange = () => void refresh();
    const data = page.data as {
      activeOwner?: { id?: string } | null;
      user?: { activeOwnerId?: string | null } | null;
    };
    primeActiveOwnerId(data.activeOwner?.id ?? data.user?.activeOwnerId ?? null);
    available = timerStorageAvailable() && !!userId && !!activeCardOwnerId();
    void (async () => {
      if (available) await refresh();
      if (live) ready = true;
    })();
    tick = setInterval(() => (now = Date.now()), 15_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(TASK_TIMER_EVENT, onChange);
    return () => {
      live = false;
      if (tick) clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(TASK_TIMER_EVENT, onChange);
    };
  });

  async function start() {
    if (busy) return;
    busy = true;
    say('');
    try {
      const out = await startTimer({ taskId, taskTitle, userId });
      if (out.ok) {
        say(tr('tasks.timer.started', { title: taskTitle }));
      } else if (out.reason === 'other-task') {
        say(tr('tasks.timer.otherRunning', { title: out.taskTitle }));
      } else {
        say(tr('tasks.timer.noStorage'));
      }
      await refresh();
    } finally {
      busy = false;
    }
  }

  function openStop() {
    if (!row) return;
    typed = '';
    sheetError = '';
    sheet = { stopAt: Date.now(), startedAt: row.startedAt };
  }

  function keepRunning() {
    sheet = null;
  }

  async function discard() {
    sheet = null;
    await stopTimer(userId);
    say(tr('tasks.timer.discarded'));
    await refresh();
  }

  async function saveTime() {
    if (!sheet || sheetMinutes === null || busy) return;
    busy = true;
    sheetError = '';
    const minutes = sheetMinutes;
    const startedAt = long ? sheet.stopAt - minutes * 60_000 : sheet.startedAt;
    try {
      const out = await saveTaskTime(taskId, { startedAt, minutes, userId });
      if (out.status === 'error') {
        sheetError = out.message;
        return;
      }
      await stopTimer(userId);
      sheet = null;
      say(
        out.status === 'queued'
          ? tr('tasks.timer.savedQueued', { time: formatHours(minutes) })
          : tr('tasks.timer.saved', { time: formatHours(minutes) })
      );
      if (timeOpen) void loadTime();
      await refresh();
    } catch {
      sheetError = tr('tasks.timer.saveFailed');
    } finally {
      busy = false;
    }
  }

  function done() {
    if (!sheet || sheetMinutes === null || !onDone) return;
    const minutes = sheetMinutes;
    sheet = null;
    onDone(minutes);
  }

  async function loadTime() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      timeState = 'offline';
      return;
    }
    timeState = 'loading';
    const out = await loadTaskTime(taskId);
    if (out.ok) {
      summary = out.summary;
      timeState = 'ok';
    } else {
      timeState = out.offline ? 'offline' : 'error';
    }
  }

  function toggleTime() {
    timeOpen = !timeOpen;
    timeError = '';
    if (timeOpen) void loadTime();
  }

  async function remove(id: string) {
    timeError = '';
    const out = await removeTaskTime(id);
    if (!out.ok) {
      timeError = out.message;
      return;
    }
    say(tr('tasks.timer.removed'));
    await loadTime();
  }
</script>

{#if ready && available && variant === 'strip'}
  {#if mine && row}
    <div
      class="strip"
      data-testid="timer-strip"
      role="group"
      aria-label={tr('tasks.timer.runningAria')}
    >
      <p class="strip-text">
        <span class="dot" aria-hidden="true"></span>{tr('tasks.timer.running', {
          title: taskTitle,
          clock: clockText(row.startedAt, now)
        })}
      </p>
      <button
        type="button"
        class="btn primary"
        aria-label={tr('tasks.timer.stopAria', { title: taskTitle })}
        disabled={busy}
        onclick={openStop}>{tr('tasks.timer.stop')}</button
      >
    </div>
  {/if}
{:else if ready && available}
  <div class="timer" data-testid="task-timer" data-task-id={taskId} data-running={mine}>
    <div class="row">
      {#if mine && row}
        <button
          type="button"
          class="btn primary"
          aria-label={tr('tasks.timer.stopAria', { title: taskTitle })}
          disabled={busy}
          onclick={openStop}>{tr('tasks.timer.stop')}</button
        >
        <span class="clock" data-testid="timer-clock"
          ><span class="dot" aria-hidden="true"></span>{clockText(row.startedAt, now)}</span
        >
      {:else if canStart}
        <button
          type="button"
          class="btn ghost"
          aria-label={tr('tasks.timer.startAria', { title: taskTitle })}
          disabled={busy}
          onclick={start}>{tr('tasks.timer.start')}</button
        >
      {/if}
      <button
        type="button"
        class="btn link"
        aria-expanded={timeOpen}
        aria-controls="task-time-{uid}"
        onclick={toggleTime}>{tr('tasks.timer.timeOnTask')}</button
      >
    </div>
    <p class="status" role="status" aria-live="polite" data-testid="timer-status">{status}</p>
    {#if timeOpen}
      <div class="saved" id="task-time-{uid}" data-testid="task-time">
        {#if timeState === 'loading'}
          <p>{tr('tasks.timer.loading')}</p>
        {:else if timeState === 'offline'}
          <p>{tr('tasks.timer.offline')}</p>
        {:else if timeState === 'error'}
          <p>{tr('tasks.timer.loadFailed')}</p>
        {:else if summary}
          <p class="total" data-testid="task-time-total">
            {summary.totalMinutes > 0
              ? tr('tasks.timer.total', { time: formatHours(summary.totalMinutes) })
              : tr('tasks.timer.none')}
          </p>
          {#if summary.entries.length}
            <ul>
              {#each summary.entries as e (e.id)}
                <li data-testid="task-time-entry">
                  <span class="who">{e.name ?? tr('tasks.timer.you')}</span>
                  <span>{formatHours(e.minutes)}</span>
                  {#if e.startedAt}
                    <span class="when">{formatInstant(e.startedAt, prefs, 'datetime')}</span>
                  {/if}
                  {#if e.canDelete}
                    <button
                      type="button"
                      class="btn ghost small"
                      aria-label={tr('tasks.timer.removeAria', { time: formatHours(e.minutes) })}
                      onclick={() => remove(e.id)}>{tr('tasks.timer.remove')}</button
                    >
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          {#if timeError}<p class="error" role="alert">{timeError}</p>{/if}
        {/if}
      </div>
    {/if}
  </div>
{/if}
{#if ready && available && sheet}
  <Modal open={true} onClose={keepRunning} title={tr('tasks.timer.sheetTitle')}>
    <div class="sheet" data-testid="timer-stop-sheet">
      <p class="job">{taskTitle}</p>
      {#if short}
        <p>{tr('tasks.timer.tooShort')}</p>
        <div class="actions">
          <button type="button" class="btn ghost" onclick={discard}
            >{tr('tasks.timer.discard')}</button
          >
          <button type="button" class="btn primary" onclick={keepRunning}
            >{tr('tasks.timer.keepRunning')}</button
          >
        </div>
      {:else}
        {#if long}
          <p data-testid="timer-real-time">
            {ranFor ? tr('tasks.timer.ranFor', { time: ranFor }) : tr('tasks.timer.clockChanged')}
          </p>
          <label for="timer-minutes-{uid}">{tr('tasks.timer.minutesWorked')}</label>
          <input
            id="timer-minutes-{uid}"
            type="number"
            inputmode="numeric"
            min={MIN_TASK_MINUTES}
            max={MAX_TASK_MINUTES}
            step="1"
            required
            bind:value={typed}
          />
          <p class="hint">
            {typedValid
              ? formatHours(typedMinutes)
              : tr('tasks.done.range', { max: MAX_TASK_MINUTES })}
          </p>
        {:else}
          <p class="minutes" data-testid="timer-minutes">{formatHours(counted)}</p>
        {/if}
        {#if sheetError}<p class="error" role="alert">{sheetError}</p>{/if}
        <div class="actions">
          <button
            type="button"
            class="btn primary"
            disabled={busy || sheetMinutes === null}
            onclick={saveTime}>{tr('tasks.timer.saveTime')}</button
          >
          {#if onDone}
            <button
              type="button"
              class="btn ghost"
              disabled={busy || sheetMinutes === null}
              onclick={done}>{tr('tasks.deck.done')}</button
            >
          {/if}
          <button type="button" class="btn ghost" disabled={busy} onclick={keepRunning}
            >{tr('tasks.timer.keepRunning')}</button
          >
          <button type="button" class="btn ghost" disabled={busy} onclick={discard}
            >{tr('tasks.timer.discard')}</button
          >
        </div>
      {/if}
    </div>
  </Modal>
{/if}

<style>
  .strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    min-width: 0;
  }
  .strip-text {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-weight: 600;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .timer {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .row,
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    min-width: 48px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-input);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary {
    background: var(--color-forest);
    color: var(--color-cream);
    border: 1px solid var(--color-forest);
  }
  .ghost {
    background: var(--color-paper);
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
  }
  .link {
    background: none;
    border: none;
    padding: 0 var(--space-2);
    color: var(--color-forest-deep);
    text-decoration: underline;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn:focus-visible,
  input:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .clock {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--color-forest-deep);
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-rust);
  }
  .status {
    margin: 0;
    color: var(--color-ink-soft);
    overflow-wrap: anywhere;
  }
  .status:empty {
    display: none;
  }
  .saved {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) 0;
    border-top: 1px dashed var(--color-divider-soft);
  }
  .saved p {
    margin: 0;
  }
  .saved ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .saved li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
  }
  .who {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .when,
  .hint {
    color: var(--color-ink-soft);
    font-size: var(--font-size-meta);
  }
  .small {
    padding: 0 var(--space-3);
  }
  .sheet {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .sheet p {
    margin: 0;
  }
  .job {
    color: var(--color-ink-soft);
    overflow-wrap: anywhere;
  }
  .minutes {
    font-size: var(--font-size-card-title);
    font-weight: 600;
  }
  .sheet label {
    font-weight: 600;
  }
  .sheet input {
    width: 7rem;
    min-height: 48px;
    padding: 0 var(--space-2);
    font: inherit;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    color: var(--color-ink);
  }
  .error {
    color: var(--pill-rust-fg);
    font-weight: 600;
  }
</style>
