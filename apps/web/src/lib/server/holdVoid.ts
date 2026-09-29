import { json, type RequestEvent } from '@sveltejs/kit';
import { holdVoidSchema, type HoldVoidInput } from '$lib/animals/holdVoidSchema';
import { requireMutator } from './auth';
import { parseBody } from './animals';
import { isInteractiveOwner } from './interactiveOwner';
import { tryGuardedHoldWrite } from './holdGuard';
import { LOCK_WINDOW_MS } from '$lib/db/recordKinds';
import { DATE_RULE_COPY } from '$lib/animals/holdGuardCopy';

/**
 * C-35 §5: the one way to shorten a hold. Only the owner, signed in on
 * their own account, can void an entry, and only within 48 hours of when it
 * was entered; a prohibited drug or a hold with no end is never voidable.
 * The guard answers the diff first and records the correction once the
 * owner confirms it.
 */
export async function voidRecord(
  event: RequestEvent,
  /** The record, with its server-set save time (null when it has none,
   *  such as an application saved before C-35: it can never be voided). */
  target: { kind: string; id: string; createdAtMs: number | null } | null,
  apply: (input: HoldVoidInput, by: string) => unknown
): Promise<Response> {
  const user = requireMutator(event);
  if (!isInteractiveOwner(event, user)) {
    return json(
      {
        error: 'Only the owner, signed in on their own account, can void an entry.',
        code: 'OWNER_ONLY'
      },
      { status: 403 }
    );
  }
  const body = await parseBody(event.request, holdVoidSchema);
  if (!body.ok) return body.response;
  if (!target) return json({ error: 'Record not found.' }, { status: 404 });
  if (target.createdAtMs === null || !(Date.now() - target.createdAtMs <= LOCK_WINDOW_MS)) {
    return json({ error: DATE_RULE_COPY.VOID_TOO_LATE, code: 'VOID_TOO_LATE' }, { status: 409 });
  }
  const guarded = await tryGuardedHoldWrite(event, user, () => apply(body.data, user.id), {
    void: {
      recordKind: target.kind,
      recordId: target.id,
      createdAtMs: target.createdAtMs,
      reason: body.data.reason,
      confirmShorten: body.data.confirmShorten ?? null
    }
  });
  if (!guarded.ok) return guarded.response;
  return json({ voided: target.id, kind: target.kind });
}
