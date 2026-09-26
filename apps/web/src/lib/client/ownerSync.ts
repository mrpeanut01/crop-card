/**
 * Cross-tab active-Owner coordination for the offline queue (Invariant 6,
 * client side).
 *
 * The session cookie is shared by every tab, but each tab primes its own
 * `sessionStorage` owner id once on mount. After a switch in another tab,
 * this tab's id is stale while its requests carry the new Owner's cookie.
 * Three layers keep queued rows on the right farm:
 *
 * 1. `drainQueue` asks the server which Owner the cookie resolves to
 *    (`fetchServerActiveOwner`) and refuses to drain on a mismatch.
 * 2. Every replay POST carries `EXPECTED_OWNER_HEADER`; `hooks.server.ts`
 *    answers 409 `OWNER_MISMATCH` without running the endpoint when it
 *    disagrees, which closes the race between the check and the POST.
 * 3. Tabs announce their Owner over a BroadcastChannel (localStorage
 *    `storage` event as fallback) and re-check on focus, so a stale tab can
 *    tell the operator to reload.
 *
 * Import-free on purpose: `hooks.server.ts` reads the header constants.
 */

export const EXPECTED_OWNER_HEADER = 'x-cropcard-expected-owner';
export const OWNER_MISMATCH_CODE = 'OWNER_MISMATCH';
export const ACTIVE_OWNER_ENDPOINT = '/api/session/active-owner';

const RESPONSE_OWNER_HEADER = 'x-cropcard-owner';
const CHANNEL_NAME = 'cropcard-owner';
const STORAGE_KEY = 'cropcard.ownerAnnounce';

export type ExpectedOwnerDecision = 'allow' | 'mismatch';

/** Server-side: a request that names an expected Owner must match the
 *  session's. Requests without the header are unaffected. */
export function expectedOwnerDecision(
  expected: string | null | undefined,
  activeOwnerId: string
): ExpectedOwnerDecision {
  if (expected === null || expected === undefined) return 'allow';
  return expected === activeOwnerId ? 'allow' : 'mismatch';
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The Owner the server resolves this browser's session to, or null when it
 *  can't be confirmed (offline, signed out, partial session, bad body). */
export async function fetchServerActiveOwner(fetchImpl: FetchLike = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(ACTIVE_OWNER_ENDPOINT, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'application/json' }
    });
    if (!res.ok) return null;
    const fromHeader = res.headers?.get(RESPONSE_OWNER_HEADER) ?? null;
    const body = (await res.json().catch(() => null)) as { activeOwnerId?: unknown } | null;
    const fromBody = typeof body?.activeOwnerId === 'string' ? body.activeOwnerId : null;
    if (fromHeader && fromBody && fromHeader !== fromBody) return null;
    return fromHeader ?? fromBody;
  } catch {
    return null;
  }
}

export type SubmitFailure = 'owner-mismatch' | 'rejected' | 'retry';

/** Statuses the server returns for a payload that will never succeed as-is:
 *  validation and foreign-ref rejections (400), missing referents (404),
 *  conflicts (409), gone (410), too large (413) and kernel or
 *  SEASON_CLOSED refusals (422). 401/402/403/408/429 and 5xx can clear up
 *  on their own (sign in again, billing restored, role changed, back-off). */
const DEFINITIVE_STATUSES: ReadonlySet<number> = new Set([400, 404, 409, 410, 413, 422]);

export function classifySubmitFailure(status: number, body: string): SubmitFailure {
  if (status === 409 && body.includes(OWNER_MISMATCH_CODE)) return 'owner-mismatch';
  return DEFINITIVE_STATUSES.has(status) ? 'rejected' : 'retry';
}

/** A tab is stale once it has seen evidence that the session now points at
 *  a different Owner than the one it rendered for. */
export function isStaleOwner(
  tabOwnerId: string | null | undefined,
  observedOwnerId: string | null | undefined
): boolean {
  if (!tabOwnerId || !observedOwnerId) return false;
  return tabOwnerId !== observedOwnerId;
}

interface OwnerAnnouncement {
  ownerId: string;
  at: number;
}

function parseAnnouncement(raw: unknown): OwnerAnnouncement | null {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.ownerId !== 'string' || d.ownerId.length === 0) return null;
  return { ownerId: d.ownerId, at: typeof d.at === 'number' ? d.at : 0 };
}

function openChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

/** Tell other tabs which Owner this tab's session now resolves to. Called
 *  when a tab renders for an Owner (mount or client-side Owner change). */
export function announceOwnerToTabs(ownerId: string | null | undefined): void {
  if (typeof window === 'undefined' || !ownerId) return;
  const message: OwnerAnnouncement = { ownerId, at: Date.now() };
  const channel = openChannel();
  if (channel) {
    try {
      channel.postMessage(message);
    } catch {
      /* fall through to storage */
    }
    channel.close();
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(message));
  } catch {
    /* private mode → BroadcastChannel (if any) is all we have */
  }
}

/**
 * Watch for evidence that the session moved to another Owner: announcements
 * from other tabs, and a server re-check whenever this tab becomes visible.
 * `onOwnerObserved` receives each observed Owner id; the caller compares it
 * with `isStaleOwner`. Returns a cleanup function.
 */
export function watchOwnerSwitches(
  onOwnerObserved: (ownerId: string) => void,
  fetchImpl: FetchLike = fetch
): () => void {
  if (typeof window === 'undefined') return () => {};
  const channel = openChannel();
  const onChannel = (e: MessageEvent) => {
    const msg = parseAnnouncement(e.data);
    if (msg) onOwnerObserved(msg.ownerId);
  };
  channel?.addEventListener('message', onChannel);

  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    const msg = parseAnnouncement(e.newValue);
    if (msg) onOwnerObserved(msg.ownerId);
  };
  window.addEventListener('storage', onStorage);

  const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    fetchServerActiveOwner(fetchImpl)
      .then((owner) => {
        if (owner) onOwnerObserved(owner);
      })
      .catch(() => undefined);
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    channel?.removeEventListener('message', onChannel);
    channel?.close();
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
