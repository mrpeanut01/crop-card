import type { AuthenticatedUser } from './auth';
import { writeAuditRow } from './superadmin';
import { createGithubIssue, type GithubIssueResult } from './githubFeedback';
import {
  countFeedbackSince,
  getFeedback,
  insertFeedback,
  setFeedbackGithubUrl,
  updateFeedbackTriage,
  type FeedbackRow
} from '$lib/db/feedback';
import {
  FEEDBACK_HOURLY_LIMIT,
  FEEDBACK_USER_AGENT_MAX,
  sanitizeFeedbackPath,
  type FeedbackStatus,
  type FeedbackSubmitInput
} from '$lib/feedback/model';
import { db } from '$lib/db/client';

export function appVersion(): string {
  return process.env.BUILD_SHA || 'dev';
}

export type SubmitResult = { ok: true; id: string } | { ok: false; reason: 'rate-limited' };

export function submitFeedback(
  user: Pick<AuthenticatedUser, 'id' | 'activeOwnerId' | 'role'>,
  input: FeedbackSubmitInput,
  userAgent: string | null,
  now = Date.now()
): SubmitResult {
  if (countFeedbackSince(user.id, now - 60 * 60 * 1000) >= FEEDBACK_HOURLY_LIMIT) {
    return { ok: false, reason: 'rate-limited' };
  }
  const row = insertFeedback({
    kind: input.kind,
    message: input.message,
    ownerId: user.activeOwnerId ?? null,
    userId: user.id,
    role: user.activeOwnerId ? user.role : null,
    pagePath: sanitizeFeedbackPath(input.pagePath),
    appVersion: appVersion(),
    userAgent: userAgent ? userAgent.slice(0, FEEDBACK_USER_AGENT_MAX) : null,
    now
  });
  return { ok: true, id: row.id };
}

export function triageFeedback(
  id: string,
  patch: { status: FeedbackStatus; adminNotes: string },
  superadminUserId: string
): FeedbackRow | null {
  const before = getFeedback(id);
  if (!before) return null;
  const notes = patch.adminNotes.trim() === '' ? null : patch.adminNotes.trim();
  return db.transaction(() => {
    const after = updateFeedbackTriage(id, { status: patch.status, adminNotes: notes });
    writeAuditRow({
      superadminUserId,
      action: 'feedback_triage',
      ownerId: before.ownerId,
      targetTable: 'feedback_submissions',
      targetId: id,
      payload: {
        from: before.status,
        to: patch.status,
        notesChanged: (before.adminNotes ?? null) !== notes
      }
    });
    return after;
  });
}

export type SendResult =
  | GithubIssueResult
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'already-sent'; url: string }
  | { ok: false; reason: 'in-flight' };

const sendsInFlight = new Set<string>();

export async function sendFeedbackToGithub(
  id: string,
  issue: { title: string; body: string },
  superadminUserId: string,
  opts: Parameters<typeof createGithubIssue>[1] = {}
): Promise<SendResult> {
  const row = getFeedback(id);
  if (!row) return { ok: false, reason: 'not-found' };
  if (row.githubIssueUrl) return { ok: false, reason: 'already-sent', url: row.githubIssueUrl };
  if (sendsInFlight.has(id)) return { ok: false, reason: 'in-flight' };
  sendsInFlight.add(id);
  const labels = row.kind === 'bug' ? ['bug', 'feedback'] : ['feedback'];
  let result: GithubIssueResult;
  try {
    result = await createGithubIssue(issue, { labels, ...opts });
  } finally {
    sendsInFlight.delete(id);
  }
  if (result.ok) {
    db.transaction(() => {
      setFeedbackGithubUrl(id, result.url);
      writeAuditRow({
        superadminUserId,
        action: 'feedback_github',
        ownerId: row.ownerId,
        targetTable: 'feedback_submissions',
        targetId: id,
        payload: { url: result.url }
      });
    });
  }
  return result;
}
