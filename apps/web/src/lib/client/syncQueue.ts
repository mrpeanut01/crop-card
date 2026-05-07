/**
 * Offline write-behind sync queue (NFR-02).
 *
 * Spray records confirmed while offline (or that fail to POST due to
 * transient network errors) are stashed in IndexedDB. On reconnect, the
 * queue drains by POSTing each pending payload to the same /api/spray/record
 * endpoint a normal client would call — server still re-runs the kernel, so
 * a record that was kernel-OK at queue time but is no longer (e.g., rules
 * changed) is rejected and stays flagged for the operator's review.
 */

import { db, type PendingSprayRecord } from './dexie';

export interface DrainResult {
  succeeded: string[];
  failed: { id: string; error: string }[];
}

function uuid(): string {
  return (
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
}

export async function enqueueSprayRecord(payload: unknown): Promise<string> {
  const id = uuid();
  await db().pendingSprayRecords.put({
    id,
    occurredAt:
      payload && typeof payload === 'object' && 'occurredAt' in payload
        ? (payload as { occurredAt: number }).occurredAt
        : Date.now(),
    payload,
    attempts: 0,
    createdAt: Date.now()
  });
  return id;
}

export async function pendingCount(): Promise<number> {
  return db().pendingSprayRecords.count();
}

export async function listPending(): Promise<PendingSprayRecord[]> {
  return db().pendingSprayRecords.orderBy('createdAt').toArray();
}

/**
 * Submit one pending record. Returns the server response if the POST
 * succeeded; throws if the network failed or the server returned non-2xx.
 */
async function submitOne(rec: PendingSprayRecord): Promise<unknown> {
  const res = await fetch('/api/spray/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rec.payload),
    credentials: 'include'
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 240)}`);
  }
  return res.json();
}

export async function drainQueue(): Promise<DrainResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { succeeded: [], failed: [] };
  }
  const pending = await listPending();
  const succeeded: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const rec of pending) {
    try {
      await submitOne(rec);
      await db().pendingSprayRecords.delete(rec.id);
      succeeded.push(rec.id);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await db().pendingSprayRecords.update(rec.id, {
        attempts: rec.attempts + 1,
        lastErrorAt: Date.now(),
        lastError: errMsg
      });
      failed.push({ id: rec.id, error: errMsg });
    }
  }
  return { succeeded, failed };
}

/** Auto-drain on reconnect. Call once during app init. */
export function watchOnline(): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => {
    drainQueue().catch(() => {
      // swallow; UI surfaces failures via listPending()
    });
  };
  window.addEventListener('online', handler);
  // Also try immediately, in case there's pending from a previous tab.
  handler();
  return () => window.removeEventListener('online', handler);
}
