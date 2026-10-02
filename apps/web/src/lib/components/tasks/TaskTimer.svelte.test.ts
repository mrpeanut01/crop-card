/**
 * @vitest-environment jsdom
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import TaskDeckCard from '$lib/components/today/TaskDeckCard.svelte';
import TaskTimer from './TaskTimer.svelte';
import { buildTaskCard } from '$lib/cards/build/task';
import { db } from '$lib/client/dexie';
import { runningTimer, startTimer } from '$lib/client/taskTimer';

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({ page }));

const prefs = { timeZone: 'America/New_York', units: 'us' as const };
const MIN = 60_000;

beforeEach(async () => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  await db().taskTimers.clear();
  await db().pendingSprayRecords.clear();
  sessionStorage.clear();
  sessionStorage.setItem('cropcard.activeOwnerId', 'owner_a');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function deckCard(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  const card = buildTaskCard(
    { id: 't1', title: 'Weed the beans', scheduledFor: now, blockId: 'b1' },
    { asOf: now },
    { now, prefs }
  );
  const onDone = vi.fn(async () => true);
  render(TaskDeckCard, {
    card,
    taskId: 't1',
    status: 'due-today',
    start: null,
    canAct: true,
    queued: false,
    prefs,
    now,
    userId: 'u1',
    onDone,
    onSkip: vi.fn(),
    ...overrides
  });
  return { onDone };
}

describe('TaskTimer on the deck card (D-28)', () => {
  it('Start keeps the timer on the phone and shows Stop', async () => {
    deckCard();
    await fireEvent.click(
      await screen.findByRole('button', { name: 'Start timer: Weed the beans' })
    );
    expect(await screen.findByRole('button', { name: 'Stop timer: Weed the beans' })).toBeVisible();
    expect((await runningTimer('u1'))?.taskId).toBe('t1');
    expect(screen.getByTestId('timer-status')).toHaveTextContent('Timer started');
  });

  it('refuses a second task and names the running one (D-21)', async () => {
    await startTimer({ taskId: 'other', taskTitle: 'Mow the lane', userId: 'u1' });
    deckCard();
    await fireEvent.click(
      await screen.findByRole('button', { name: 'Start timer: Weed the beans' })
    );
    await waitFor(() =>
      expect(screen.getByTestId('timer-status')).toHaveTextContent(
        'A timer is already running for Mow the lane. Stop it first.'
      )
    );
    expect((await runningTimer('u1'))?.taskId).toBe('other');
  });

  it('Stop then Save time posts the minutes and clears the timer', async () => {
    await startTimer({
      taskId: 't1',
      taskTitle: 'Weed the beans',
      userId: 'u1',
      now: Date.now() - 25 * MIN
    });
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ entry: { id: 'e1', minutes: 25 } }), { status: 201 })
    );
    vi.stubGlobal('fetch', fetchFn);
    deckCard();
    await fireEvent.click(
      await screen.findByRole('button', { name: 'Stop timer: Weed the beans' })
    );
    const sheet = screen.getByTestId('timer-stop-sheet');
    expect(sheet).toHaveTextContent('25 min');
    await fireEvent.click(within(sheet).getByRole('button', { name: 'Save time' }));
    await waitFor(() =>
      expect(screen.getByTestId('timer-status')).toHaveTextContent('Saved 25 min.')
    );
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/tasks/t1/time');
    expect(JSON.parse(String(init.body)).minutes).toBe(25);
    expect(JSON.parse(String(init.body)).userId).toBe('u1');
    expect(await runningTimer('u1')).toBeNull();
  });

  it('a save with no signal queues the person who worked, so a later drain credits them', async () => {
    await startTimer({
      taskId: 't1',
      taskTitle: 'Weed the beans',
      userId: 'u1',
      now: Date.now() - 45 * MIN
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    deckCard();
    await fireEvent.click(
      await screen.findByRole('button', { name: 'Stop timer: Weed the beans' })
    );
    const sheet = screen.getByTestId('timer-stop-sheet');
    await fireEvent.click(within(sheet).getByRole('button', { name: 'Save time' }));
    await waitFor(() =>
      expect(screen.getByTestId('timer-status')).toHaveTextContent('Saved 45 min on this phone')
    );
    const [row] = await db().pendingSprayRecords.toArray();
    expect(row.kind).toBe('time-entry');
    expect(row.payload).toMatchObject({ taskId: 't1', minutes: 45, userId: 'u1' });
  });

  it('under 30 seconds offers only Discard and Keep running', async () => {
    await startTimer({ taskId: 't1', taskTitle: 'Weed the beans', userId: 'u1' });
    deckCard();
    await fireEvent.click(
      await screen.findByRole('button', { name: 'Stop timer: Weed the beans' })
    );
    const sheet = screen.getByTestId('timer-stop-sheet');
    expect(sheet).toHaveTextContent('Less than a minute. Nothing to save.');
    expect(within(sheet).queryByRole('button', { name: 'Save time' })).toBeNull();
    await fireEvent.click(within(sheet).getByRole('button', { name: 'Discard' }));
    await waitFor(async () => expect(await runningTimer('u1')).toBeNull());
  });

  it('past 12 hours asks for the real time before saving (D-24)', async () => {
    const started = Date.now() - 40 * 60 * MIN;
    await startTimer({ taskId: 't1', taskTitle: 'Weed the beans', userId: 'u1', now: started });
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ entry: { id: 'e1', minutes: 90 } }), { status: 201 })
    );
    vi.stubGlobal('fetch', fetchFn);
    deckCard();
    await fireEvent.click(
      await screen.findByRole('button', { name: 'Stop timer: Weed the beans' })
    );
    const sheet = screen.getByTestId('timer-stop-sheet');
    expect(sheet).toHaveTextContent('This timer ran for 40 h. How long did you actually work?');
    const save = within(sheet).getByRole('button', { name: 'Save time' });
    expect(save).toBeDisabled();
    await fireEvent.input(within(sheet).getByLabelText('Minutes worked'), {
      target: { value: '90' }
    });
    await fireEvent.click(save);
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    const body = JSON.parse(
      String((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body)
    );
    expect(body.minutes).toBe(90);
    expect(body.startedAt).toBeGreaterThan(started);
  });

  it('Stop then Done opens the Done sheet with the minutes and clears the timer once saved', async () => {
    await startTimer({
      taskId: 't1',
      taskTitle: 'Weed the beans',
      userId: 'u1',
      now: Date.now() - 45 * MIN
    });
    const { onDone } = deckCard();
    await fireEvent.click(
      await screen.findByRole('button', { name: 'Stop timer: Weed the beans' })
    );
    await fireEvent.click(
      within(screen.getByTestId('timer-stop-sheet')).getByRole('button', { name: 'Done' })
    );
    const done = await screen.findByTestId('done-sheet');
    expect(within(done).getByLabelText('Minutes')).toHaveValue(45);
    await fireEvent.click(within(done).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('t1', 45));
    await waitFor(async () => expect(await runningTimer('u1')).toBeNull());
  });

  it("the card's own Done fills the running minutes in, and a failed close keeps the timer", async () => {
    await startTimer({
      taskId: 't1',
      taskTitle: 'Weed the beans',
      userId: 'u1',
      now: Date.now() - 20 * MIN
    });
    const onDone = vi.fn(async () => false);
    deckCard({ onDone });
    await screen.findByRole('button', { name: 'Stop timer: Weed the beans' });
    await fireEvent.click(screen.getByRole('button', { name: 'Done: Weed the beans' }));
    const done = await screen.findByTestId('done-sheet');
    expect(within(done).getByLabelText('Minutes')).toHaveValue(20);
    await fireEvent.click(within(done).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('t1', 20));
    expect((await runningTimer('u1'))?.taskId).toBe('t1');
  });

  it('no Start for inspectors, closed tasks or with no Owner', async () => {
    deckCard({ canAct: false });
    expect(screen.queryByRole('button', { name: /Start timer/ })).toBeNull();
    sessionStorage.clear();
    render(TaskTimer, { taskId: 't2', taskTitle: 'Other', userId: 'u1', canAct: true, open: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: /Start timer: Other/ })).toBeNull();
  });

  it('a timer on a closed task still offers Stop (D-22)', async () => {
    await startTimer({ taskId: 't9', taskTitle: 'Closed job', userId: 'u1' });
    render(TaskTimer, {
      taskId: 't9',
      taskTitle: 'Closed job',
      userId: 'u1',
      canAct: true,
      open: false
    });
    expect(await screen.findByRole('button', { name: 'Stop timer: Closed job' })).toBeVisible();
  });

  it('Time on this task lists saved time and removes your own', async () => {
    const summary = {
      totalMinutes: 50,
      entries: [
        {
          id: 'e1',
          userId: 'u1',
          startedAt: Date.now() - 60 * MIN,
          minutes: 20,
          source: 'timer',
          note: null,
          createdAt: Date.now(),
          canDelete: true
        }
      ]
    };
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : new Response(JSON.stringify(summary), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchFn);
    render(TaskTimer, { taskId: 't1', taskTitle: 'Weed', userId: 'u1', canAct: true, open: true });
    await fireEvent.click(await screen.findByRole('button', { name: 'Time on this task' }));
    expect(await screen.findByTestId('task-time-total')).toHaveTextContent(
      '50 min saved on this task.'
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Remove 20 min' }));
    await waitFor(() =>
      expect(fetchFn).toHaveBeenCalledWith('/api/tasks/time/e1', { method: 'DELETE' })
    );
  });
});
