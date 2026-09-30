import { describe, expect, it } from 'vitest';
import { digestAdvice, DIGEST_PRINT_HREF } from './todayCard';
import { todayDigestInput } from './todayInput';
import type { TodayAdviceContext } from '$lib/today/advice';
import { TODAY_ADVICE_PROVIDERS } from '$lib/server/todayAdvice.server';

const DAY = 86_400_000;
const MONDAY_NOON = Date.parse('2026-09-28T16:00:00Z');
const at = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);

function ctx(nowMs: number, isOwner: boolean, viewerId = 'owner'): TodayAdviceContext {
  const blockNameById = new Map([['b1', 'Bed 1']]);
  return {
    nowMs,
    seasonYear: 2026,
    farmLatLon: null,
    plantings: [],
    timeZone: 'America/New_York',
    isOwner,
    digest: todayDigestInput({
      openPrimaries: [
        { id: 't1', title: 'Weed bed 1', scheduledFor: at('2026-09-29'), blockId: 'b1' },
        {
          id: 't2',
          title: 'Liberty 29 oz per acre',
          scheduledFor: at('2026-09-30'),
          category: 'spray',
          assigneeUserId: 'maria',
          assignee: { id: 'maria', name: 'Maria' }
        },
        { id: 't3', title: 'Late job', scheduledFor: at('2026-09-20') }
      ],
      careOpen: [{ id: 'c1', title: 'Deworm goats', scheduledFor: at('2026-10-01') }],
      lowStockCount: 2,
      blockNameById,
      viewerId,
      isOwner,
      viewerTimeZone: 'America/New_York'
    })
  };
}

describe('digestAdvice (F4-8)', () => {
  it('is registered on the /today advice hook', () => {
    expect(TODAY_ADVICE_PROVIDERS).toContain(digestAdvice);
  });

  it('shows nothing on any other day', async () => {
    for (let i = 1; i < 7; i++) {
      expect(await digestAdvice(ctx(MONDAY_NOON + i * DAY, true))).toEqual([]);
    }
  });

  it('shows nothing without loader input', async () => {
    expect(await digestAdvice({ ...ctx(MONDAY_NOON, true), digest: undefined })).toEqual([]);
  });

  it("uses the viewer's zone: late Sunday in New York is already Monday in UTC", async () => {
    const sundayNight = Date.parse('2026-09-28T02:00:00Z');
    expect(await digestAdvice(ctx(sundayNight, true))).toEqual([]);
  });

  it('gives the owner counts, care titles, low stock and the money link, with no dollar amount', async () => {
    const [card] = await digestAdvice(ctx(MONDAY_NOON, true));
    expect(card).toMatchObject({ kind: 'digest', id: 'digest:2026-09-28', provenance: 'data' });
    expect(card.lines).toEqual([
      '2 tasks due this week, 1 overdue.',
      'Maria: 1, Not assigned: 1.',
      'Animal care: Deworm goats.',
      '2 items are running low.'
    ]);
    expect(card.actions.map((a) => a.kind === 'link' && a.href)).toEqual([
      DIGEST_PRINT_HREF,
      '/finance'
    ]);
    expect(JSON.stringify(card)).not.toMatch(/\$\d|oz per acre/);
  });

  it('gives a helper their own count and no money link', async () => {
    const [card] = await digestAdvice(ctx(MONDAY_NOON, false, 'maria'));
    expect(card.lines[0]).toBe('1 task for you this week.');
    expect(card.lines).toContain('1 more task is not assigned to anyone.');
    expect(card.actions.some((a) => a.kind === 'link' && a.href === '/finance')).toBe(false);
  });
});
