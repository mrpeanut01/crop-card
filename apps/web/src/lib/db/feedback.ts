/**
 * In-app feedback (#466). `feedback_submissions` is a deliberately global
 * table: the superadmin triage queue spans every farm, and a signed-in user
 * with no farm yet can still write. `owner_id` / `user_id` are context only.
 */

import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, gte, inArray } from 'drizzle-orm';
import { db } from './client';
import { feedbackSubmissions, owners, users } from './schema';
import { unscopedQueryNote } from './tenant';
import type { FeedbackKind, FeedbackStatus } from '$lib/feedback/model';
import { realNow } from '$lib/server/clock';

export interface FeedbackRow {
  id: string;
  kind: FeedbackKind;
  message: string;
  ownerId: string | null;
  userId: string | null;
  role: string | null;
  pagePath: string | null;
  appVersion: string | null;
  userAgent: string | null;
  status: FeedbackStatus;
  adminNotes: string | null;
  githubIssueUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

type Raw = typeof feedbackSubmissions.$inferSelect;

function toRow(r: Raw): FeedbackRow {
  return {
    id: r.id,
    kind: r.kind,
    message: r.message,
    ownerId: r.ownerId,
    userId: r.userId,
    role: r.role,
    pagePath: r.pagePath,
    appVersion: r.appVersion,
    userAgent: r.userAgent,
    status: r.status,
    adminNotes: r.adminNotes,
    githubIssueUrl: r.githubIssueUrl,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime()
  };
}

export interface NewFeedback {
  kind: FeedbackKind;
  message: string;
  ownerId: string | null;
  userId: string;
  role: string | null;
  pagePath: string | null;
  appVersion: string | null;
  userAgent: string | null;
  now?: number;
}

export function insertFeedback(input: NewFeedback): FeedbackRow {
  unscopedQueryNote('feedback_submissions is a global triage queue; owner_id is context only');
  const now = new Date(input.now ?? realNow());
  const id = `fb_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  db.insert(feedbackSubmissions)
    .values({
      id,
      kind: input.kind,
      message: input.message,
      ownerId: input.ownerId,
      userId: input.userId,
      role: input.role,
      pagePath: input.pagePath,
      appVersion: input.appVersion,
      userAgent: input.userAgent,
      status: 'new',
      createdAt: now,
      updatedAt: now
    })
    .run();
  return getFeedback(id)!;
}

/** Rows this user sent since `sinceMs`; backs the per-user rate limit. */
export function countFeedbackSince(userId: string, sinceMs: number): number {
  unscopedQueryNote('per-user feedback rate limit reads the global queue by user_id');
  const row = db
    .select({ n: count() })
    .from(feedbackSubmissions)
    .where(
      and(
        eq(feedbackSubmissions.userId, userId),
        gte(feedbackSubmissions.createdAt, new Date(sinceMs))
      )
    )
    .get();
  return row?.n ?? 0;
}

export function getFeedback(id: string): FeedbackRow | null {
  unscopedQueryNote('superadmin triage');
  const r = db.select().from(feedbackSubmissions).where(eq(feedbackSubmissions.id, id)).get();
  return r ? toRow(r) : null;
}

export function listFeedback(opts: { status?: FeedbackStatus | null; limit?: number } = {}) {
  unscopedQueryNote('superadmin triage');
  const q = db.select().from(feedbackSubmissions);
  const rows = (opts.status ? q.where(eq(feedbackSubmissions.status, opts.status)) : q)
    .orderBy(desc(feedbackSubmissions.createdAt))
    .limit(opts.limit ?? 200)
    .all();
  return rows.map(toRow);
}

export function feedbackStatusCounts(): Record<FeedbackStatus, number> {
  unscopedQueryNote('superadmin triage');
  const out: Record<FeedbackStatus, number> = {
    new: 0,
    triaged: 0,
    'in-progress': 0,
    done: 0,
    'wont-fix': 0
  };
  const rows = db
    .select({ status: feedbackSubmissions.status, n: count() })
    .from(feedbackSubmissions)
    .groupBy(feedbackSubmissions.status)
    .all();
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export function updateFeedbackTriage(
  id: string,
  patch: { status: FeedbackStatus; adminNotes: string | null },
  now = realNow()
): FeedbackRow | null {
  unscopedQueryNote('superadmin triage');
  db.update(feedbackSubmissions)
    .set({ status: patch.status, adminNotes: patch.adminNotes, updatedAt: new Date(now) })
    .where(eq(feedbackSubmissions.id, id))
    .run();
  return getFeedback(id);
}

export function setFeedbackGithubUrl(id: string, url: string, now = realNow()): void {
  unscopedQueryNote('superadmin triage');
  db.update(feedbackSubmissions)
    .set({ githubIssueUrl: url, updatedAt: new Date(now) })
    .where(eq(feedbackSubmissions.id, id))
    .run();
}

/** The user's own submissions, for their GDPR export. */
export function listFeedbackForUser(userId: string) {
  unscopedQueryNote("GDPR export includes the user's own feedback rows by user_id");
  return db
    .select()
    .from(feedbackSubmissions)
    .where(eq(feedbackSubmissions.userId, userId))
    .orderBy(desc(feedbackSubmissions.createdAt))
    .all()
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      message: r.message,
      pagePath: r.pagePath,
      status: r.status,
      createdAt: r.createdAt.toISOString()
    }));
}

/** Farm names and sign-in identities for the triage cards, so a superadmin
 *  can see who to follow up with without looking up raw ids. */
export function feedbackPeople(rows: ReadonlyArray<Pick<FeedbackRow, 'ownerId' | 'userId'>>): {
  farms: Record<string, { name: string; slug: string }>;
  people: Record<string, { email: string | null; phone: string | null }>;
} {
  unscopedQueryNote('superadmin triage names the farm and person behind each note');
  const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter((v): v is string => !!v))];
  const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
  const farms: Record<string, { name: string; slug: string }> = {};
  const people: Record<string, { email: string | null; phone: string | null }> = {};
  if (ownerIds.length > 0) {
    for (const o of db
      .select({ id: owners.id, name: owners.name, slug: owners.slug })
      .from(owners)
      .where(inArray(owners.id, ownerIds))
      .all()) {
      farms[o.id] = { name: o.name, slug: o.slug };
    }
  }
  if (userIds.length > 0) {
    for (const u of db
      .select({ id: users.id, email: users.email, phone: users.phone })
      .from(users)
      .where(inArray(users.id, userIds))
      .all()) {
      people[u.id] = { email: u.email, phone: u.phone };
    }
  }
  return { farms, people };
}
