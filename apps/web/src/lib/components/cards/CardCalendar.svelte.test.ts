/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import CardView from './CardView.svelte';
import CardPrintSheet from './CardPrintSheet.svelte';
import { sampleSnapshot } from '$lib/cards/build/fixtures';
import { buildMonthCard } from '$lib/cards/build/month';
import { buildWeekCard } from '$lib/cards/build/week';
import type { SnapshotTask } from '$lib/cards/snapshot';

const NOW = Date.parse('2026-06-01T13:00:00Z');
const prefs = { timeZone: 'America/New_York', units: 'us' as const };

function t(id: string, over: Partial<SnapshotTask> = {}): SnapshotTask {
  return {
    id,
    title: `Job ${id}`,
    category: 'other',
    scheduledFor: Date.parse('2026-06-03T14:00:00Z'),
    cropId: null,
    blockId: 'b_bed3',
    equipmentId: null,
    ...over
  };
}

function snap(tasks: SnapshotTask[]) {
  return sampleSnapshot({
    tasks,
    taskWindow: { fromMs: NOW - 14 * 86_400_000, toMs: NOW + 62 * 86_400_000 }
  });
}

describe('Week and Month Cards', () => {
  it('shows an agenda on screen and a grid when printed', () => {
    const card = buildWeekCard(snap([t('a'), t('b', { category: 'spray' })]), '2026-06-01')!;
    const screen = render(CardView, { card, prefs, variant: 'screen', now: NOW });
    expect(screen.getByTestId('card-calendar-agenda').textContent).toContain('Job a');
    expect(screen.queryByTestId('card-calendar-grid')).toBeNull();
    screen.unmount();

    const printed = render(CardView, { card, prefs, variant: 'print', now: NOW });
    const grid = printed.getByTestId('card-calendar-grid');
    expect(grid.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(grid.textContent).toContain('Spray task');
    expect(grid.textContent).toMatch(/See the task for its Spray Card\s*\[1\]/);
    expect(grid.textContent).toContain('https://app.cropcard.io/c/tk_b');
    printed.unmount();
  });

  it('keeps a space before "overdue" and before the assignee', () => {
    const snapshot = snap([
      t('late', { scheduledFor: Date.parse('2026-05-30T14:00:00Z'), assigneeUserId: 'u1' })
    ]);
    snapshot.people = [{ id: 'u1', name: 'Maria Lopez' }];
    const card = buildWeekCard(snapshot, '2026-05-30')!;
    const printed = render(CardView, { card, prefs, variant: 'print', now: NOW });
    const text = printed.getByTestId('card-calendar-grid').textContent ?? '';
    expect(text).toMatch(/Bed 3 · Maria overdue/);
    expect(text).not.toMatch(/\S(?:overdue|·)/);
    printed.unmount();
  });

  it('prints a crowded month on two landscape pages', () => {
    const tasks = Array.from({ length: 6 }, (_, i) => t(`x${i}`));
    const card = buildMonthCard(snap(tasks), '2026-06')!;
    const { container } = render(CardPrintSheet, {
      cards: [card],
      layout: 'index-4x6',
      prefs,
      now: NOW,
      origin: 'https://app.cropcard.io',
      preview: true
    });
    const pages = container.querySelectorAll('.sheet-page');
    expect(pages).toHaveLength(2);
    for (const p of pages) expect(p.getAttribute('data-page-layout')).toBe('letter-landscape');
    expect(pages[0].querySelector('[data-testid="calendar-more"]')?.textContent).toContain(
      '+2 more'
    );
    expect(pages[1].getAttribute('data-page-part')).toBe('list');
    expect(pages[1].textContent).toContain('Job x5');
  });
});
