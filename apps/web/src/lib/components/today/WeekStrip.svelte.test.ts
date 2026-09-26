/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import WeekStrip from './WeekStrip.svelte';

const todayStartMs = Date.UTC(2026, 8, 25);

describe('WeekStrip', () => {
  it('labels the first day and each 1st of the month with the month', async () => {
    const { container } = render(WeekStrip, { todayStartMs, items: {} });
    await fireEvent.click(screen.getByRole('tab', { name: 'Season' }));
    const months = [...container.querySelectorAll('.month')].map((el) => el.textContent);
    expect(months).toEqual(['Sep', 'Oct', 'Nov', 'Dec']);
    expect(screen.getByText('Sep 25 – Dec 17')).toBeInTheDocument();
  });

  it('shows the date range in the heading for the month view', async () => {
    render(WeekStrip, { todayStartMs, items: {} });
    await fireEvent.click(screen.getByRole('tab', { name: 'Month' }));
    expect(screen.getByText('Sep 25 – Oct 22')).toBeInTheDocument();
  });
});
