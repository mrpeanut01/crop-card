/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import CalendarGrid from './CalendarGrid.svelte';
import { calendarGrid } from '$lib/today/views';
import type { CalendarChip } from '$lib/today/calendar';
import type { DayWeather } from '$lib/today/weatherSummary';

const chip: CalendarChip = {
  type: 'task',
  key: 't:1',
  taskId: '1',
  kind: 'spray',
  title: 'Spray the squash',
  blockId: 'b1',
  status: 'late',
  queued: false,
  extra: 0
};
const suggestion: CalendarChip = {
  type: 'suggestion',
  key: 's:0',
  index: 0,
  kind: 'harvest',
  title: 'Harvest window opens',
  blockId: 'b1'
};
const rain: DayWeather = {
  date: '2026-09-30',
  sky: 'rain',
  highF: 64,
  lowF: 51,
  popPct: 70,
  shortForecast: 'Rain likely',
  overnightOnly: false
};
const dry: DayWeather = { ...rain, date: '2026-10-01', sky: 'clear', popPct: 10 };

function props(view: 'week' | 'month') {
  return {
    view,
    anchor: '2026-09-29',
    grid: calendarGrid(view, '2026-09-29', 0),
    todayYmd: '2026-09-29',
    cells: { '2026-09-29': [chip], '2026-10-01': [suggestion] },
    weather: { '2026-09-30': rain, '2026-10-01': dry },
    blockNames: { b1: 'North bed' },
    onPage: vi.fn(),
    onOpenChip: vi.fn(),
    onOpenDay: vi.fn()
  };
}

describe('CalendarGrid week', () => {
  it('shows chips with kind, block and status, and opens a chip', async () => {
    const p = props('week');
    render(CalendarGrid, { props: p });
    expect(screen.getByRole('heading', { name: 'Week of Sep 27' })).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Spray the squash, North bed, Late' });
    expect(btn).toHaveTextContent('Spray · North bed · Late');
    await fireEvent.click(btn);
    expect(p.onOpenChip).toHaveBeenCalledWith('2026-09-29', chip);
    expect(
      screen.getByRole('button', {
        name: 'Harvest window opens, North bed, suggested by your crop calendar'
      })
    ).toHaveAttribute('data-chip', 'suggestion');
  });

  it('shows forecast icons with rain only when it is likely', () => {
    const { container } = render(CalendarGrid, { props: props('week') });
    const wet = container.querySelector('[data-day="2026-09-30"] .wx');
    const sunny = container.querySelector('[data-day="2026-10-01"] .wx');
    expect(wet?.textContent).toContain('70%');
    expect(sunny?.textContent).not.toContain('%');
    expect(container.querySelector('[data-day="2026-10-03"] .wx')).toBeNull();
  });

  it('pages by week and returns to today', async () => {
    const p = props('week');
    render(CalendarGrid, {
      props: { ...p, anchor: '2026-10-06', grid: calendarGrid('week', '2026-10-06', 0) }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(p.onPage).toHaveBeenLastCalledWith('2026-09-29');
    await fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(p.onPage).toHaveBeenLastCalledWith('2026-10-13');
    await fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(p.onPage).toHaveBeenLastCalledWith(null);
  });
});

describe('CalendarGrid month', () => {
  it('lays out whole weeks and opens a day', async () => {
    const p = props('month');
    const { container } = render(CalendarGrid, { props: p });
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
    expect(container.querySelectorAll('.mcell')).toHaveLength(35);
    const day = container.querySelector('[data-day="2026-09-29"]') as HTMLElement;
    expect(day.querySelector('.mchip')?.textContent).toContain('Spray the squash');
    await fireEvent.click(day);
    expect(p.onOpenDay).toHaveBeenCalledWith('2026-09-29');
    await fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(p.onPage).toHaveBeenLastCalledWith('2026-10-01');
  });
});
