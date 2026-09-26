/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
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
    expect(onDone).toHaveBeenCalledWith('t1');
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
    expect(onDone).toHaveBeenCalledWith('p1');
  });

  it('a rejected replay points at Pending records', () => {
    setup({ rejected: true });
    expect(screen.getByRole('link', { name: /Could not save/ })).toHaveAttribute(
      'href',
      '/records/pending'
    );
  });
});
