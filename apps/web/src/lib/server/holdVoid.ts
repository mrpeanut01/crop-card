import { json, type RequestEvent } from '@sveltejs/kit';
import { holdVoidSchema, type HoldVoidInput } from '$lib/animals/holdVoidSchema';
import { requireMutator } from './auth';
import { parseBody } from './animals';
import { isInteractiveOwner } from './interactiveOwner';
import { tryGuardedHoldWrite } from './holdGuard';
import { LOCK_WINDOW_MS } from '$lib/db/recordKinds';
import { DATE_RULE_COPY } from '$lib/animals/holdGuardCopy';
import { t } from '$lib/i18n';

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
        error: t(event.locals?.locale, 'api.err.voidOwnerOnly'),
        code: 'OWNER_ONLY'
      },
      { status: 403 }
    );
  }
  const body = await parseBody(event.request, holdVoidSchema, event.locals?.locale);
  if (!body.ok) return body.response;
  if (!target)
    return json({ error: t(event.locals?.locale, 'api.err.recordNotFound') }, { status: 404 });
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

/** 32G G4-13: until when the owner may void an entry saved at
 *  `createdAtMs` (null when it has no save time and can never be voided). */
export function voidableUntilMs(createdAtMs: number | null): number | null {
  return createdAtMs === null ? null : createdAtMs + LOCK_WINDOW_MS;
}

/** 32G G4-13: the void button shows only for the interactive owner. */
export function canVoidHolds(
  event: Pick<RequestEvent, 'locals'>,
  user: Parameters<typeof isInteractiveOwner>[1] | null
): boolean {
  return user ? isInteractiveOwner(event, user) : false;
}
