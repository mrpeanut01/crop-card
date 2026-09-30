import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { digestMondayYmd, inAudience, isDigestSendWindow, weeklyDigestAlerts } from './triggers';
import { selectRecipients } from './dispatch';
import { selectEmailRecipients } from './emailAlerts';
import { buildWeeklyDigest } from '$lib/digest/weekly';
import { DEFAULT_PUSH_PREFS } from '$lib/push/prefs';
import type { PushSubscriptionRecord } from '$lib/db/pushSubscriptions';

describe('digest send window (F4-2)', () => {
  it('opens Monday 10:00 UTC and closes at the end of Tuesday UTC', () => {
    expect(isDigestSendWindow(Date.parse('2026-09-28T09:59:59Z'))).toBe(false);
    expect(isDigestSendWindow(Date.parse('2026-09-28T10:00:00Z'))).toBe(true);
    expect(isDigestSendWindow(Date.parse('2026-09-28T20:30:00Z'))).toBe(true);
    expect(isDigestSendWindow(Date.parse('2026-09-29T23:59:59Z'))).toBe(true);
    expect(isDigestSendWindow(Date.parse('2026-09-30T00:00:00Z'))).toBe(false);
    expect(isDigestSendWindow(Date.parse('2026-10-01T10:00:00Z'))).toBe(false);
    expect(isDigestSendWindow(Date.parse('2026-09-27T10:00:00Z'))).toBe(false);
  });

  it('names the Monday of the send', () => {
    expect(digestMondayYmd(Date.parse('2026-09-28T10:00:00Z'))).toBe('2026-09-28');
    expect(digestMondayYmd(Date.parse('2026-09-29T23:00:00Z'))).toBe('2026-09-28');
  });

  it('every in-window instant maps to a Monday no more than two days back', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_000_000_000_000 }), (ms) => {
        if (!isDigestSendWindow(ms)) return;
        const monday = digestMondayYmd(ms);
        expect(new Date(`${monday}T00:00:00Z`).getUTCDay()).toBe(1);
        expect(ms - Date.parse(`${monday}T00:00:00Z`)).toBeLessThan(2 * 86_400_000);
      })
    );
  });
});

describe("the 'only' audience (F4-4)", () => {
  const digest = buildWeeklyDigest({
    viewerId: 'maria',
    isOwner: false,
    weekStartYmd: '2026-09-28',
    timeZone: 'UTC',
    nowMs: Date.parse('2026-09-28T12:00:00Z'),
    openTasks: [],
    lowStockCount: 0
  });
  const [alert] = weeklyDigestAlerts([{ userId: 'maria', digest }]);

  it('makes one unbatched alert per person keyed on user and Monday', () => {
    expect(alert).toMatchObject({
      kind: 'weekly-digest',
      subjectId: 'maria:2026-09-28',
      url: '/today',
      audience: { kind: 'only', userIds: ['maria'] }
    });
    expect(alert.batchKey).toBeUndefined();
  });

  it('never adds owners', () => {
    expect(inAudience(alert.audience, 'boss', 'owner')).toBe(false);
    expect(inAudience(alert.audience, 'maria', 'helper')).toBe(true);
    expect(inAudience({ kind: 'owners-and', userIds: [] }, 'boss', 'owner')).toBe(true);
  });

  const members = [
    { userId: 'boss', roleWithinOwner: 'owner', status: 'active' },
    { userId: 'maria', roleWithinOwner: 'helper', status: 'active' },
    { userId: 'insp', roleWithinOwner: 'inspector', status: 'active' }
  ];
  const sub = (userId: string, on: boolean): PushSubscriptionRecord =>
    ({
      id: `s-${userId}`,
      userId,
      endpoint: `https://push.example/${userId}`,
      p256dh: 'x',
      auth: 'y',
      prefs: { ...DEFAULT_PUSH_PREFS, 'weekly-digest': on },
      failureCount: 0,
      createdAt: 0
    }) as unknown as PushSubscriptionRecord;

  it('push goes only to that person, and only with the kind on', () => {
    const subs = [sub('boss', true), sub('maria', true), sub('insp', true)];
    expect(selectRecipients(subs, members, alert).map((s) => s.userId)).toEqual(['maria']);
    expect(selectRecipients([sub('maria', false)], members, alert)).toEqual([]);
  });

  it('email goes only to that person with a digest consent', () => {
    const emails = new Map([
      ['boss', 'boss@x.test'],
      ['maria', 'maria@x.test']
    ]);
    const out = selectEmailRecipients({
      members,
      emails,
      consents: [
        { userId: 'boss', category: 'weekly-digest' },
        { userId: 'maria', category: 'weekly-digest' }
      ],
      isSuppressed: () => false,
      alert
    });
    expect(out).toEqual([{ userId: 'maria', email: 'maria@x.test' }]);
    expect(
      selectEmailRecipients({
        members,
        emails,
        consents: [{ userId: 'maria', category: 'frost-tonight' }],
        isSuppressed: () => false,
        alert
      })
    ).toEqual([]);
  });
});
