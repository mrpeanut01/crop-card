/**
 * Phase 32F (F1-1, F1-2, F1-3). Who may give out tasks and the refusals,
 * shared by `POST /api/tasks` and `PATCH /api/tasks/:id`.
 */

import { json } from '@sveltejs/kit';
import { ASK_THE_OWNER } from '$lib/tasks/assignee';
import type { AuthenticatedUser } from './auth';
import { assertAssignableUser, firstUnknownRef } from './foreignRefs';

/** Owners assign, by cookie or an owner API token. A superadmin looking at
 *  the farm through impersonation is not its owner. */
export function canAssignTasks(
  user: Pick<AuthenticatedUser, 'role' | 'impersonating'> | null
): boolean {
  return !!user && user.role === 'owner' && user.impersonating !== true;
}

export function assignRefusal(): Response {
  return json({ error: ASK_THE_OWNER, code: 'OWNER_ONLY', askOwner: true }, { status: 403 });
}

export function taskClosedRefusal(): Response {
  return json(
    { error: 'This job is already closed, so who did it stays as it was.', code: 'TASK_CLOSED' },
    { status: 409 }
  );
}

/** 400 `FOREIGN_REF` when the person is not an active working member of
 *  this farm, which covers another Owner's users and inspectors. */
export function rejectUnassignable(assigneeUserId: string | null | undefined): Response | null {
  if (!assigneeUserId) return null;
  if (!firstUnknownRef(assertAssignableUser('assigneeUserId', assigneeUserId))) return null;
  return json(
    { error: 'That person is not a member of this farm.', code: 'FOREIGN_REF' },
    { status: 400 }
  );
}
