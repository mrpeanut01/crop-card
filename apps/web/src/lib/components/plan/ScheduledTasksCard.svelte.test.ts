/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ScheduledTasksCard from './ScheduledTasksCard.svelte';

describe('ScheduledTasksCard (#122)', () => {
  it('hides the + Task button when no handler is wired', () => {
    render(ScheduledTasksCard, { rows: [] });
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
  });

  it('renders + Task and fires onAddTask', async () => {
    const onAddTask = vi.fn();
    render(ScheduledTasksCard, { rows: [], onAddTask });
    await fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(onAddTask).toHaveBeenCalledTimes(1);
  });

  it('lists task rows', () => {
    render(ScheduledTasksCard, {
      rows: [
        {
          id: 't1',
          dateLabel: 'Jun 3',
          title: 'Side-dress N',
          source: 'Manual',
          status: 'scheduled'
        }
      ]
    });
    expect(screen.getByText('Side-dress N')).toBeInTheDocument();
    expect(screen.queryByText('Nothing scheduled in this window.')).toBeNull();
  });
});
