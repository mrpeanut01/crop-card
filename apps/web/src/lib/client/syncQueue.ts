/**
 * Offline write-behind sync queue (NFR-02).
 *
 * Spray records confirmed while offline (or that fail to POST due to
 * transient network errors) are stashed in IndexedDB. On reconnect, the
 * queue drains by POSTing each pending payload to the same
 * /api/spray/record endpoint a normal client would call — server still
 * re-runs the kernel, so a record that was kernel-OK at queue time but is
 * no longer (e.g., rules changed) is rejected and stays flagged for the
 * operator's review.
 *
 * Phase 18h (multi-tenant): every pending record carries an `ownerId`. The
 * queue drains ONLY rows matching the current active Owner so a helper
 * switching tenants can't accidentally submit Farm A's offline records
 * against Farm B's session. The cross-tenant pending count surfaces as a
 * "N pending for other farm" badge instead of disappearing silently.
 */

import { db, type PendingSprayRecord } from './dexie';

export interface DrainResult {
  succeeded: string[];
  failed: { id: string; error: string }[];
  skippedOtherOwner: number;
}

function uuid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function currentOwnerId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem('cropcard.activeOwnerId');
  } catch {
    return null;
  }
}

export async function enqueueSprayRecord(payload: unknown): Promise<string> {
  const id = uuid();
  const ownerId = currentOwnerId() ?? 'owner_home_farm';
  await db().pendingSprayRecords.put({
    id,
    ownerId,
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

/** Total pending count across all tenants. The layout badge uses this so
 *  the helper sees the full picture; drainQueue only submits the active
 *  tenant's rows. */
export async function pendingCount(): Promise<number> {
  return db().pendingSprayRecords.count();
}

/** Pending count for the active Owner only. */
export async function pendingCountForActiveOwner(): Promise<number> {
  const ownerId = currentOwnerId();
  if (!ownerId) return 0;
  return db().pendingSprayRecords.where('ownerId').equals(ownerId).count();
}

/** Pending count for any Owner OTHER than the current — drives the
 *  "queued at <other farm>" hint on the layout banner. */
export async function pendingCountForOtherOwners(): Promise<number> {
  const ownerId = currentOwnerId();
  if (!ownerId) return 0;
  return db().pendingSprayRecords.where('ownerId').notEqual(ownerId).count();
}

export async function listPending(): Promise<PendingSprayRecord[]> {
  return db().pendingSprayRecords.orderBy('createdAt').toArray();
}

export async function listPendingForActiveOwner(): Promise<PendingSprayRecord[]> {
  const ownerId = currentOwnerId();
  if (!ownerId) return [];
  const all = await db().pendingSprayRecords.where('ownerId').equals(ownerId).toArray();
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function discardPendingForActiveOwner(id: string): Promise<boolean> {
  const ownerId = currentOwnerId();
  if (!ownerId) return false;
  const target = await db().pendingSprayRecords.get(id);
  if (!target || target.ownerId !== ownerId) return false;
  await db().pendingSprayRecords.delete(id);
  return true;
}

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
    return { succeeded: [], failed: [], skippedOtherOwner: 0 };
  }
  const ownerId = currentOwnerId();
  const allPending = await listPending();
  const succeeded: string[] = [];
  const failed: { id: string; error: string }[] = [];
  let skippedOtherOwner = 0;
  for (const rec of allPending) {
    if (ownerId && rec.ownerId !== ownerId) {
      skippedOtherOwner++;
      continue;
    }
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
  return { succeeded, failed, skippedOtherOwner };
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
  handler();
  return () => window.removeEventListener('online', handler);
}
