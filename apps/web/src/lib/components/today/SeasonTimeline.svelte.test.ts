/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import SeasonTimeline from './SeasonTimeline.svelte';
import type { SeasonTimeline as Timeline } from '$lib/today/seasonTimeline';

class FakeResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(el: Element) {
    this.cb(
      [{ target: el, contentRect: el.getBoundingClientRect() } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver);

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day).getTime();

const timeline: Timeline = {
  year: 2026,
  prepStartMs: d(2025, 8, 25),
  nextPrepMs: d(2026, 8, 25),
  fromMs: d(2025, 8, 25),
  toMs: d(2026, 10, 20),
  band: { startMs: d(2026, 4, 15), endMs: d(2026, 10, 20), source: 'frost' },
  rows: [
    {
      plantingId: 'p1',
      name: 'Tomato',
      blockId: 'b1',
      blockName: 'North bed',
      plantingDate: d(2026, 5, 10),
      spans: [
        {
          kind: 'grow',
          startMs: d(2026, 5, 10),
          endMs: d(2026, 9, 1),
          recorded: true,
          label: 'Growing'
        },
        {
          kind: 'spray',
          startMs: d(2026, 6, 1),
          endMs: d(2026, 6, 1),
          recorded: true,
          label: 'Spray'
        },
        {
          kind: 'harvest',
          startMs: d(2026, 8, 1),
          endMs: d(2026, 9, 1),
          recorded: false,
          label: 'Harvest window',
          suggestion: 0
        }
      ]
    }
  ]
};

describe('SeasonTimeline', () => {
  it('draws a band and one row per planting, solid for done and dashed for planned', async () => {
    const onOpenRow = vi.fn();
    const { container } = render(SeasonTimeline, {
      year: 2026,
      years: [2027, 2026, 2025],
      timeline,
      now: d(2026, 7, 1),
      onSelectYear: vi.fn(),
      onOpenRow
    });
    expect(screen.getByRole('heading', { name: 'Season 2026' })).toBeInTheDocument();
    expect(screen.getByText('Growing season')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tomato' })).toHaveAttribute(
      'href',
      expect.stringContaining('p1')
    );
    const bars = container.querySelectorAll('[data-planting-id="p1"] .bar');
    expect(bars).toHaveLength(3);
    expect([...bars].map((b) => b.classList.contains('planned'))).toEqual([false, false, true]);
    await fireEvent.click(screen.getByRole('button', { name: /Tomato on North bed/ }));
    expect(onOpenRow).toHaveBeenCalledWith(0);
  });

  it('switches seasons from the dropdown and the arrows', async () => {
    const onSelectYear = vi.fn();
    render(SeasonTimeline, {
      year: 2027,
      years: [2027, 2026],
      timeline: { ...timeline, year: 2027, rows: [] },
      now: d(2026, 7, 1),
      onSelectYear,
      onOpenRow: vi.fn()
    });
    expect(screen.getByTestId('season-empty')).toHaveTextContent('Nothing is planted or planned');
    expect(screen.getByRole('button', { name: 'Later season' })).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Earlier season' }));
    expect(onSelectYear).toHaveBeenLastCalledWith(2026);
    await fireEvent.change(screen.getByLabelText('Season'), { target: { value: '2026' } });
    expect(onSelectYear).toHaveBeenLastCalledWith(2026);
  });

  it('labels only every few months at phone width, never off the right edge (#467)', async () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(290);
    const { container } = render(SeasonTimeline, {
      year: 2026,
      years: [2026],
      timeline,
      now: d(2026, 7, 1),
      onSelectYear: vi.fn(),
      onOpenRow: vi.fn()
    });
    await Promise.resolve();
    const ticks = [...container.querySelectorAll<HTMLElement>('.tick')];
    const labelled = ticks.filter((t) => t.textContent!.trim() !== '');
    expect(ticks.length).toBeGreaterThan(10);
    expect(labelled.length).toBeLessThanOrEqual(Math.floor(290 / 44));
    for (const t of labelled) expect(parseFloat(t.style.left)).toBeLessThanOrEqual(92);
    spy.mockRestore();
  });

  it('shows a block field-work row with no planting link and no undated note (#467)', () => {
    render(SeasonTimeline, {
      year: 2026,
      years: [2026],
      timeline: {
        ...timeline,
        rows: [
          {
            plantingId: 'block:b2',
            blockWork: true,
            name: 'Field work',
            blockId: 'b2',
            blockName: 'Fallow field',
            plantingDate: null,
            spans: [
              {
                kind: 'till',
                startMs: d(2026, 4, 1),
                endMs: d(2026, 4, 1),
                recorded: true,
                label: 'Till'
              }
            ]
          }
        ]
      },
      now: d(2026, 7, 1),
      onSelectYear: vi.fn(),
      onOpenRow: vi.fn()
    });
    expect(screen.getByText('Field work')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Field work' })).toBeNull();
    expect(screen.queryByText('No planting date yet')).toBeNull();
    expect(screen.getByRole('button', { name: /Field work on Fallow field/ })).toBeInTheDocument();
  });
});
