// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { owners, superadminAudit, users } from '$lib/db/schema';
import { feedbackPeople, getFeedback, listFeedback, listFeedbackForUser } from '$lib/db/feedback';
import { FEEDBACK_HOURLY_LIMIT } from '$lib/feedback/model';
import { sendFeedbackToGithub, submitFeedback, triageFeedback } from './feedback';

function seedUser(superadmin = false): string {
  const id = `fb-${randomUUID()}`;
  db.insert(users)
    .values({ id, email: `${id}@feedback.test`, isSuperadmin: superadmin })
    .run();
  return id;
}

function auditFor(targetId: string) {
  return db.select().from(superadminAudit).where(eq(superadminAudit.targetId, targetId)).all();
}

describe('submitFeedback', () => {
  it('stores the note with path-only context', () => {
    const userId = seedUser();
    const r = submitFeedback(
      { id: userId, activeOwnerId: 'owner-x', role: 'helper' },
      { kind: 'bug', message: 'Map is blank', pagePath: '/plan?block=b1&token=abc' },
      'Mozilla/5.0 test'
    );
    expect(r.ok).toBe(true);
    const row = getFeedback((r as { id: string }).id)!;
    expect(row).toMatchObject({
      kind: 'bug',
      message: 'Map is blank',
      ownerId: 'owner-x',
      userId,
      role: 'helper',
      pagePath: '/plan',
      userAgent: 'Mozilla/5.0 test',
      status: 'new',
      githubIssueUrl: null
    });
    expect(row.appVersion).toBeTruthy();
  });

  it('accepts a person with no farm yet', () => {
    const userId = seedUser();
    const r = submitFeedback(
      { id: userId, activeOwnerId: null, role: 'owner' },
      { kind: 'idea', message: 'Onboarding could ask about goats' },
      null
    );
    const row = getFeedback((r as { id: string }).id)!;
    expect(row.ownerId).toBeNull();
    expect(row.role).toBeNull();
    expect(row.pagePath).toBeNull();
  });

  it('limits each person to a handful an hour', () => {
    const userId = seedUser();
    const who = { id: userId, activeOwnerId: null, role: 'owner' as const };
    const now = Date.now();
    for (let i = 0; i < FEEDBACK_HOURLY_LIMIT; i++) {
      expect(submitFeedback(who, { kind: 'other', message: `note ${i}` }, null, now).ok).toBe(true);
    }
    expect(submitFeedback(who, { kind: 'other', message: 'one more' }, null, now)).toEqual({
      ok: false,
      reason: 'rate-limited'
    });
    expect(
      submitFeedback(who, { kind: 'other', message: 'later' }, null, now + 61 * 60 * 1000).ok
    ).toBe(true);
    expect(listFeedbackForUser(userId)).toHaveLength(FEEDBACK_HOURLY_LIMIT + 1);
  });
});

describe('triageFeedback', () => {
  it('changes status and notes and audits the change', () => {
    const userId = seedUser();
    const admin = seedUser(true);
    const r = submitFeedback(
      { id: userId, activeOwnerId: 'owner-y', role: 'owner' },
      { kind: 'bug', message: 'Broken' },
      null
    ) as { id: string };
    const after = triageFeedback(
      r.id,
      { status: 'triaged', adminNotes: '  repro on phone ' },
      admin
    )!;
    expect(after.status).toBe('triaged');
    expect(after.adminNotes).toBe('repro on phone');
    const audit = auditFor(r.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'feedback_triage',
      ownerId: 'owner-y',
      targetTable: 'feedback_submissions',
      superadminUserId: admin
    });
    expect(JSON.parse(audit[0].payloadJson!)).toEqual({
      from: 'new',
      to: 'triaged',
      notesChanged: true
    });
    expect(listFeedback({ status: 'triaged' }).some((f) => f.id === r.id)).toBe(true);
    expect(listFeedback({ status: 'new' }).some((f) => f.id === r.id)).toBe(false);
  });

  it('returns null for an unknown id', () => {
    expect(
      triageFeedback('fb_nope', { status: 'done', adminNotes: '' }, seedUser(true))
    ).toBeNull();
  });
});

describe('sendFeedbackToGithub', () => {
  const config = { token: 'tok', repo: 'me/crop-card' };

  it('stores the issue URL, audits it and refuses a second send', async () => {
    const userId = seedUser();
    const admin = seedUser(true);
    const r = submitFeedback(
      { id: userId, activeOwnerId: null, role: 'owner' },
      { kind: 'bug', message: 'Broken' },
      null
    ) as { id: string };
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ html_url: 'https://github.com/me/crop-card/issues/9' }), {
          status: 201
        })
    );
    const sent = await sendFeedbackToGithub(r.id, { title: 'Bug: Broken', body: 'Broken' }, admin, {
      config,
      fetcher: fetcher as never
    });
    expect(sent.ok).toBe(true);
    expect(getFeedback(r.id)!.githubIssueUrl).toBe('https://github.com/me/crop-card/issues/9');
    expect(auditFor(r.id).map((a) => a.action)).toEqual(['feedback_github']);
    const labels = JSON.parse(
      String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body)
    ).labels;
    expect(labels).toEqual(['bug', 'feedback']);

    const again = await sendFeedbackToGithub(r.id, { title: 'x', body: 'y' }, admin, {
      config,
      fetcher: fetcher as never
    });
    expect(again).toMatchObject({ ok: false, reason: 'already-sent' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('changes nothing when GitHub is not configured or fails', async () => {
    const userId = seedUser();
    const admin = seedUser(true);
    const r = submitFeedback(
      { id: userId, activeOwnerId: null, role: 'owner' },
      { kind: 'idea', message: 'Idea' },
      null
    ) as { id: string };
    const off = await sendFeedbackToGithub(r.id, { title: 'Idea', body: 'Idea' }, admin, {
      config: null
    });
    expect(off).toEqual({ ok: false, reason: 'not-configured' });
    const failing = await sendFeedbackToGithub(r.id, { title: 'Idea', body: 'Idea' }, admin, {
      config,
      fetcher: (async () => new Response('', { status: 500 })) as never
    });
    expect(failing).toMatchObject({ ok: false, reason: 'rejected' });
    expect(getFeedback(r.id)!.githubIssueUrl).toBeNull();
    expect(auditFor(r.id)).toHaveLength(0);
  });
});

describe('sendFeedbackToGithub race (#466 review)', () => {
  const config = { token: 'tok', repo: 'me/crop-card' };

  it('refuses a second send while the first is still in flight, so one note makes one issue', async () => {
    const admin = seedUser(true);
    const r = submitFeedback(
      { id: seedUser(), activeOwnerId: null, role: 'owner' },
      { kind: 'bug', message: 'Double send' },
      null
    ) as { id: string };
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const fetcher = vi.fn(async () => {
      await gate;
      return new Response(
        JSON.stringify({ html_url: 'https://github.com/me/crop-card/issues/12' }),
        {
          status: 201
        }
      );
    });
    const first = sendFeedbackToGithub(r.id, { title: 'a', body: 'b' }, admin, {
      config,
      fetcher: fetcher as never
    });
    const second = await sendFeedbackToGithub(r.id, { title: 'a', body: 'b' }, admin, {
      config,
      fetcher: fetcher as never
    });
    expect(second).toEqual({ ok: false, reason: 'in-flight' });
    release();
    expect(await first).toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(auditFor(r.id)).toHaveLength(1);
  });
});

describe('feedbackPeople (triage shows who sent it)', () => {
  it('names the farm and the sender instead of raw ids', () => {
    const userId = seedUser();
    const ownerId = `fb-farm-${randomUUID()}`;
    db.insert(owners)
      .values({ id: ownerId, name: 'Hilltop Acres', slug: ownerId, billingStatus: 'active' })
      .run();
    const { farms, people } = feedbackPeople([
      { ownerId, userId },
      { ownerId: null, userId: null }
    ]);
    expect(farms[ownerId]).toEqual({ name: 'Hilltop Acres', slug: ownerId });
    expect(people[userId].email).toBe(`${userId}@feedback.test`);
    expect(feedbackPeople([])).toEqual({ farms: {}, people: {} });
  });
});
