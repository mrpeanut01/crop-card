/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import TaskDeckCard from './TaskDeckCard.svelte';
import { buildTaskCard } from '$lib/cards/build/task';
import { taskStart } from '$lib/tasks/start';

const prefs = { timeZone: 'America/New_York', units: 'us' as const };
const now = Date.parse('2026-06-04T16:00:00Z');
const task = {
  id: 't1',
  title: 'Spray the kale',
  category: 'spray' as const,
  scheduledFor: Date.parse('2026-06-02T14:00:00Z'),
  blockId: 'b1'
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

function setup(overrides: Record<string, unknown> = {}) {
  const onDone = vi.fn();
  const onSkip = vi.fn();
  const queued = (overrides.queued as boolean | undefined) ?? false;
  const card = buildTaskCard(
    task,
    { asOf: now, where: 'Kale · Bed 2', queued: queued ? 'complete' : null },
    { now, prefs }
  );
  const utils = render(TaskDeckCard, {
    card,
    taskId: 't1',
    status: card.status!.id as never,
    start: taskStart(task),
    canAct: true,
    queued,
    prefs,
    now,
    onDone,
    onSkip,
    ...overrides
  });
  return { ...utils, onDone, onSkip };
}

describe('TaskDeckCard', () => {
  it('a compact card with a derived status pill and the Start, Done, Skip actions', async () => {
    const { container, onDone } = setup();
    const article = container.querySelector('article')!;
    expect(article.dataset.variant).toBe('compact');
    expect(article.dataset.cardKind).toBe('task');
    expect(container.querySelector('[data-card-status="late"]')).toHaveTextContent('Late');
    expect(screen.getByRole('link', { name: 'Start spraying: Spray the kale' })).toHaveAttribute(
      'href',
      '/spray?task=t1&block=b1'
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Done: Spray the kale' }));
    expect(onDone).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Done, skip time' }));
    expect(onDone).toHaveBeenCalledWith('t1', undefined);
  });

  it('Done opens the time sheet; one chip completes it with that time (F1-12)', async () => {
    const { onDone } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Done: Spray the kale' }));
    const sheet = screen.getByTestId('done-sheet');
    for (const label of ['15 m', '30 m', '1 h', '2 h', 'Other'])
      expect(within(sheet).getByText(label, { selector: 'button' })).toBeInTheDocument();
    await fireEvent.click(within(sheet).getByRole('button', { name: 'Done, 30 min' }));
    expect(onDone).toHaveBeenCalledWith('t1', 30);
  });

  it('Other takes whole minutes and shows them as hours', async () => {
    const { onDone } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Done: Spray the kale' }));
    const sheet = screen.getByTestId('done-sheet');
    await fireEvent.click(within(sheet).getByRole('button', { name: 'Other' }));
    const input = within(sheet).getByLabelText('Minutes');
    const save = within(sheet).getByRole('button', { name: 'Save' });
    await fireEvent.input(input, { target: { value: '900' } });
    expect(save).toBeDisabled();
    await fireEvent.input(input, { target: { value: '90' } });
    expect(sheet).toHaveTextContent('1.5 h');
    await fireEvent.click(save);
    expect(onDone).toHaveBeenCalledWith('t1', 90);
  });

  it('only owners get the Assign button', () => {
    setup();
    expect(screen.queryByRole('button', { name: /^Assign/ })).toBeNull();
    setup({ canAssign: true, assigneeUserId: 'u1' });
    expect(screen.getByRole('button', { name: 'Assign: Spray the kale' })).toHaveTextContent(
      'Reassign'
    );
  });

  it('keeps the notes, the equipment and the skip reason on the deck card', () => {
    const card = buildTaskCard(
      {
        ...task,
        body: 'Triple rinse the tank first',
        abortedAt: now - 60_000,
        abortReason: 'Too wet to walk the rows'
      },
      { asOf: now, where: 'Kale · Bed 2', equipmentLabel: 'Backpack sprayer' },
      { now, prefs }
    );
    const { container } = setup({
      card,
      status: 'skipped',
      linked: [
        {
          id: 'pre1',
          title: 'Check the nozzles',
          kind: 'pre-task',
          status: 'planned',
          queued: false,
          due: 'Tue, Jun 2',
          body: 'Swap the worn tip'
        }
      ]
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Triple rinse the tank first');
    expect(text).toContain('Backpack sprayer');
    expect(text).toContain('Too wet to walk the rows');
    expect(text).toContain('Kale · Bed 2');
    expect(text).toContain('Swap the worn tip');
    expect(text).toContain('Tue, Jun 2');
  });

  it('a task on a planting links to its Planting Card, care guide and photo help', () => {
    const card = buildTaskCard(
      { ...task, cropId: 'p_kale' },
      { asOf: now, where: 'Kale · Bed 2' },
      { now, prefs }
    );
    setup({ card, canAct: false });
    expect(
      screen.getByRole('link', { name: 'Planting card, care and photo help' })
    ).toHaveAttribute('href', '/cards/planting/pl_p_kale');
  });

  it('a task with no planting shows no Planting Card link', () => {
    setup();
    expect(screen.queryByRole('link', { name: /Planting card/ })).toBeNull();
  });

  it('Skip asks why, then saves the reason', async () => {
    const { onSkip } = setup();
    const skip = screen.getByRole('button', { name: 'Skip: Spray the kale' });
    expect(skip).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.click(skip);
    const box = screen.getByLabelText('Why are you skipping this?');
    await fireEvent.input(box, { target: { value: '  too windy ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save skip' }));
    expect(onSkip).toHaveBeenCalledWith('t1', 'too windy');
  });

  it('a queued Done reads done, shows the offline badge and offers no more actions', () => {
    const { container } = setup({ queued: true, status: 'done' });
    expect(screen.getByText('Will save when online')).toBeInTheDocument();
    expect(container.querySelector('[data-card-status="done"]')).toHaveTextContent('Done');
    expect(screen.queryByRole('button', { name: /Done:/ })).toBeNull();
  });

  it('read-only viewers see the card without actions', () => {
    setup({ canAct: false });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link', { name: /Start/ })).toBeNull();
  });

  it('prep and follow-up lines carry their own status and Done', async () => {
    const { onDone } = setup({
      linked: [
        { id: 'p1', title: 'Check nozzles', kind: 'pre-task', status: 'due-today', queued: false },
        { id: 'p2', title: 'Rinse tank', kind: 'post-task', status: 'done', queued: true }
      ]
    });
    const list = screen.getByRole('list', { name: /Get ready and follow-up/ });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Get ready');
    expect(items[0]).toHaveTextContent('Due today');
    expect(items[1]).toHaveTextContent('Follow-up');
    expect(within(items[1]).getByText('Will save when online')).toBeInTheDocument();
    expect(within(items[1]).queryByRole('button')).toBeNull();
    await fireEvent.click(within(items[0]).getByRole('button', { name: 'Done: Check nozzles' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Done, 1 h' }));
    expect(onDone).toHaveBeenCalledWith('p1', 60);
  });

  it('a rejected replay points at Pending records', () => {
    setup({ rejected: true });
    expect(screen.getByRole('link', { name: /Could not save/ })).toHaveAttribute(
      'href',
      '/records/pending'
    );
  });
});
