/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import PhotoMarks from './PhotoMarks.svelte';
import type { PhotoMark } from '$lib/journal/model';

const observers: FakeResizeObserver[] = [];

class FakeResizeObserver {
  target: Element | null = null;
  constructor(private cb: ResizeObserverCallback) {
    observers.push(this);
  }
  observe(el: Element) {
    this.target = el;
  }
  resize(width: number, height: number) {
    this.cb(
      [{ target: this.target, contentRect: { width, height } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
    flushSync();
  }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver);

afterEach(() => {
  observers.length = 0;
});

const MARKS: PhotoMark[] = [
  { kind: 'cut', x: 0.5, y: 0.25, label: 'Cut here' },
  { kind: 'harvest', x: 0.1, y: 0.5, w: 0.2, h: 0.4, label: 'Harvest these' },
  { kind: 'leave', x: 0, y: 1, label: 'Leave this' }
];

function centres(): Array<[string, string]> {
  return screen
    .getAllByTestId('photo-mark')
    .map((b) => [(b as HTMLElement).style.left, (b as HTMLElement).style.top]);
}

describe('PhotoMarks', () => {
  it('places marks on the rendered image and follows it when it resizes', () => {
    render(PhotoMarks, { src: '/x.jpg', marks: MARKS, steps: ['One.', 'Two.', 'Three.'] });
    expect(screen.queryAllByTestId('photo-mark')).toHaveLength(0);
    observers[0].resize(400, 300);
    expect(centres()).toEqual([
      ['200px', '75px'],
      ['80px', '210px'],
      ['0px', '300px']
    ]);
    observers[0].resize(200, 150);
    expect(centres()).toEqual([
      ['100px', '37.5px'],
      ['40px', '105px'],
      ['0px', '150px']
    ]);
    const svg = document.querySelector('svg.overlay')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 150');
    const rect = svg.querySelector('rect')!;
    expect([rect.getAttribute('x'), rect.getAttribute('width')]).toEqual(['20', '40']);
  });

  it('numbers each mark, names it for screen readers and lists the legend and steps', () => {
    render(PhotoMarks, { src: '/x.jpg', marks: MARKS, steps: ['One.', 'Two.'] });
    observers[0].resize(400, 300);
    const buttons = screen.getAllByTestId('photo-mark');
    expect(buttons.map((b) => b.textContent)).toEqual(['1', '2', '3']);
    expect(buttons[0].getAttribute('aria-label')).toBe('Mark 1: Cut, Cut here');
    expect(buttons[0].getAttribute('aria-describedby')).toBe('photo-mark-legend-1');
    const legend = screen.getByTestId('photo-marks-legend');
    expect(legend.querySelectorAll('li')).toHaveLength(3);
    expect(legend.textContent).toContain('Harvest');
    expect(legend.textContent).toContain('Leave this');
    expect(screen.getByTestId('photo-marks-steps').querySelectorAll('li')).toHaveLength(2);
  });

  it('each mark button toggles its legend row (the e2e spec measures 48 px)', async () => {
    render(PhotoMarks, { src: '/x.jpg', marks: MARKS });
    observers[0].resize(400, 300);
    const [first] = screen.getAllByTestId('photo-mark');
    expect(first.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(first);
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('photo-mark-legend-1')!.classList.contains('on')).toBe(true);
    await fireEvent.click(first);
    expect(first.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('photo-marks-steps')).toBeNull();
  });
});

describe('PhotoMarks problem marks (#869, FU869-1)', () => {
  const WITH_PROBLEM: PhotoMark[] = [
    { kind: 'cut', x: 0.5, y: 0.25, label: 'Cut here' },
    { kind: 'problem', x: 0.4, y: 0.6, label: 'Yellow lower leaves' },
    { kind: 'problem', x: 0.1, y: 0.1, w: 0.3, h: 0.2, label: 'Spots on leaves' }
  ];

  it('draws problem marks as diamonds and dashed boxes, named and keyed in the legend', () => {
    render(PhotoMarks, { src: '/x.jpg', marks: WITH_PROBLEM, problemTips: [] });
    observers[0].resize(400, 300);
    const buttons = screen.getAllByTestId('photo-mark');
    expect(buttons.map((b) => b.getAttribute('data-shape'))).toEqual([
      'circle',
      'diamond',
      'diamond'
    ]);
    expect(buttons[1].getAttribute('aria-label')).toBe('Mark 2: Problem, Yellow lower leaves');
    const svg = document.querySelector('svg.overlay')!;
    expect(svg.querySelectorAll('polygon')).toHaveLength(1);
    expect(svg.querySelector('rect')!.classList.contains('dashed')).toBe(true);
    expect(svg.querySelectorAll('circle')).toHaveLength(1);
    const rows = screen.getByTestId('photo-marks-legend').querySelectorAll('li');
    expect(rows[1].getAttribute('data-shape')).toBe('diamond');
    expect(rows[1].textContent).toContain('Problem');
    expect(screen.getByTestId('photo-marks-key-problem').textContent).toContain(
      'Diamonds and dashed boxes: something that looks wrong.'
    );
  });

  it("shows the crop's Care Guide problem tips beside a problem mark", () => {
    render(PhotoMarks, {
      src: '/x.jpg',
      marks: WITH_PROBLEM,
      problemTips: ['Thin, spindly growth: not enough light.', '  ']
    });
    const tips = screen.getByTestId('photo-marks-problem-tips');
    expect(tips.querySelectorAll('li')).toHaveLength(1);
    expect(tips.textContent).toContain('Common problems');
    expect(tips.textContent).toContain('Thin, spindly growth: not enough light.');
    expect(screen.queryByTestId('photo-marks-extension')).toBeNull();
  });

  it('shows only the extension office line when the crop has no sourced tips', () => {
    render(PhotoMarks, { src: '/x.jpg', marks: WITH_PROBLEM });
    expect(screen.getByTestId('photo-marks-extension').textContent).toBe(
      'Not sure what this is? Your county extension office can help.'
    );
    expect(screen.queryByTestId('photo-marks-problem-tips')).toBeNull();
  });

  it('shows no key, tips or extension line without a problem mark', () => {
    render(PhotoMarks, { src: '/x.jpg', marks: MARKS, problemTips: ['A tip.'] });
    expect(screen.queryByTestId('photo-marks-key')).toBeNull();
    expect(screen.queryByTestId('photo-marks-problem-tips')).toBeNull();
    expect(screen.queryByTestId('photo-marks-extension')).toBeNull();
  });
});
