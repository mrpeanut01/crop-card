/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import TodayHero from './TodayHero.svelte';
import type { PriorityAction } from '$lib/today/priorityAction';

const action: PriorityAction = {
  kind: 'task',
  title: 'Side-dress the corn',
  toneTag: 'fertility',
  scope: [['Scheduled', 'Thu, Jun 4']],
  ctaHref: '/fertility',
  ctaLabel: 'Open fertility',
  taskId: 't9'
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

describe('TodayHero skip', () => {
  it('asks why and hands the reason to the same skip flow the task cards use', async () => {
    const onSkip = vi.fn();
    render(TodayHero, { action, aiEnabled: false, onSkip });
    await fireEvent.click(screen.getByRole('button', { name: 'Skip, note why' }));
    const box = screen.getByLabelText('Why are you skipping this?');
    expect(document.activeElement).toBe(box);
    await fireEvent.input(box, { target: { value: 'soil too wet' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save skip' }));
    expect(onSkip).toHaveBeenCalledWith('t9', 'soil too wet');
    expect(screen.queryByLabelText('Why are you skipping this?')).toBeNull();
  });

  it("a plain task's Mark done opens the Done sheet and closes the task with the time", async () => {
    const onDone = vi.fn();
    const plain: PriorityAction = {
      ...action,
      ctaHref: '/today',
      ctaLabel: 'Mark done',
      markDone: true
    };
    render(TodayHero, { action: plain, aiEnabled: false, onDone });
    expect(screen.queryByRole('link', { name: /Mark done/ })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /Mark done/ }));
    expect(screen.getByTestId('done-sheet')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Done, 30 min' }));
    expect(onDone).toHaveBeenCalledWith('t9', 30);
  });

  it('a read-only viewer gets no Mark done that just reloads the page', () => {
    render(TodayHero, {
      action: { ...action, ctaHref: '/today', ctaLabel: 'Mark done', markDone: true },
      aiEnabled: false
    });
    expect(screen.queryByText('Mark done')).toBeNull();
  });

  it('read-only viewers get no skip button', () => {
    render(TodayHero, { action, aiEnabled: false });
    expect(screen.queryByRole('button', { name: /Skip/ })).toBeNull();
  });

  it('the all-caught-up copy points at the Week view, not a strip that is gone (#467)', () => {
    render(TodayHero, { action: null, aiEnabled: false });
    expect(screen.getByText(/Pick Week or Month below/)).toBeInTheDocument();
    expect(screen.queryByText(/week below shows/)).toBeNull();
  });

  it('never says all caught up while animal care is on the list (#683)', () => {
    render(TodayHero, { action: null, aiEnabled: false, careDue: 1 });
    expect(screen.getByText('An animal care job is on the list.')).toBeInTheDocument();
    expect(screen.queryByText('All caught up.')).toBeNull();
    expect(screen.queryByText(/Nothing's overdue/)).toBeNull();
  });
});
