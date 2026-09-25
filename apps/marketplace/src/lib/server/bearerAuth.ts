import type { AppCredential } from './appCreds';

export interface BearerDeps {
  lookup: (plaintext: string) => AppCredential | null;
  touch: (id: string) => void;
}

export type BearerResult =
  | { kind: 'none' }
  | { kind: 'ok'; cred: AppCredential }
  | { kind: 'reject'; response: Response };

export function bearerRejection(): Response {
  return new Response(JSON.stringify({ error: 'invalid or revoked Bearer token' }), {
    status: 401,
    headers: { 'content-type': 'application/json' }
  });
}

/**
 * Any lookup failure (including a DB error) is a 401 with a fixed body so
 * internals never leak to the caller (#233). The touch is best-effort.
 */
export function resolveBearer(authHeader: string | null, deps: BearerDeps): BearerResult {
  if (!authHeader?.toLowerCase().startsWith('bearer ')) return { kind: 'none' };
  const token = authHeader.slice(7).trim();
  let cred: AppCredential | null;
  try {
    cred = deps.lookup(token);
  } catch {
    return { kind: 'reject', response: bearerRejection() };
  }
  if (!cred) return { kind: 'reject', response: bearerRejection() };
  try {
    deps.touch(cred.id);
  } catch {
    // best-effort
  }
  return { kind: 'ok', cred };
}
