/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
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

  it('read-only viewers get no skip button', () => {
    render(TodayHero, { action, aiEnabled: false });
    expect(screen.queryByRole('button', { name: /Skip/ })).toBeNull();
  });
});
