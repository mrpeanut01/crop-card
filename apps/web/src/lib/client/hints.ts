/**
 * First-use hint state on the client. The server list (`/api/me/hints`) is
 * the source of truth; a dismissal also lands in localStorage so it sticks
 * when the POST fails offline, and is flushed on the next successful call.
 */

import type { HintKey } from '$lib/hints';

const PENDING_KEY = 'cropcard.hints.pending';

function readPending(): string[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function writePending(keys: string[]): void {
  try {
    if (keys.length) localStorage.setItem(PENDING_KEY, JSON.stringify(keys));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage blocked: the server call is the record */
  }
}

/** Seen on the server or dismissed locally and not yet synced. */
export function isHintSeen(key: HintKey, serverSeen: readonly string[]): boolean {
  return serverSeen.includes(key) || readPending().includes(key);
}

export async function markHintSeen(key: HintKey, fetcher: typeof fetch = fetch): Promise<boolean> {
  const keys = [...new Set([...readPending(), key])];
  writePending(keys);
  try {
    const res = await fetcher('/api/me/hints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys })
    });
    if (res.ok) writePending([]);
    return res.ok;
  } catch {
    return false;
  }
}
