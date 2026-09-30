import { json } from '@sveltejs/kit';
import type { ZodError } from 'zod';
import type { AuthenticatedUser } from '$lib/server/auth';

/** Five minutes of clock skew between a phone and the server. */
export const FUTURE_SKEW_MS = 5 * 60 * 1000;
/** Watering and gauge logs older than a year are refused as typos. */
export const MAX_BACKDATE_MS = 366 * 24 * 60 * 60 * 1000;

export function invalid(err: ZodError): Response {
  return json(
    {
      error: err.issues[0]?.message ?? 'invalid request',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    },
    { status: 400 }
  );
}

export async function readJson(
  request: Request
): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

/** Null when `ms` is a sensible past moment, else the refusal. */
export function checkWhen(ms: number, now: number, what: string): Response | null {
  if (ms > now + FUTURE_SKEW_MS) {
    return json(
      { error: `The ${what} time is in the future.`, code: 'IN_THE_FUTURE' },
      { status: 400 }
    );
  }
  if (ms < now - MAX_BACKDATE_MS) {
    return json(
      { error: `The ${what} time is more than a year ago.`, code: 'TOO_OLD' },
      { status: 400 }
    );
  }
  return null;
}

/** E4-13: the owner, or the member who logged it. Inspectors never. */
export function canRemoveLog(user: AuthenticatedUser, loggedBy: string | null): boolean {
  if (user.role === 'inspector') return false;
  if (user.role === 'owner') return true;
  return loggedBy !== null && loggedBy === user.id;
}
