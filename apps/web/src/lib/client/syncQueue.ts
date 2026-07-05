/**
 * Offline write-behind sync queue (NFR-02).
 *
 * Field records confirmed while offline (or that fail to POST due to
 * transient network errors) are stashed in IndexedDB. On reconnect, the
 * queue drains by POSTing each pending payload to the same endpoint a
 * normal client would call — server still re-runs the kernel, so a record
 * that was kernel-OK at queue time but is no longer (e.g., rules changed)
 * is rejected and stays flagged for the operator's review.
 *
 * Phase 18h (multi-tenant): every pending record carries an `ownerId`. The
 * queue drains ONLY rows matching the current active Owner so a helper
 * switching tenants can't accidentally submit Farm A's offline records
 * against Farm B's session. The cross-tenant pending count surfaces as a
 * "N pending for other farm" badge instead of disappearing silently.
 *
 * #314 (tenant-safety FAIL-SAFE): the active Owner id is seeded from the
 * server-provided value on every layout mount (`primeActiveOwnerId`), so a
 * fresh tab / first-login never has a null key. Belt-and-braces, `drainQueue`
 * REFUSES to drain when the active owner is unknown — draining unfiltered
 * would replay every tenant's rows against whichever session happens to be
 * live. No active owner ⇒ no drain.
 *
 * #316: the queue is no longer herbicide-only. `enqueueRecord(kind, payload)`
 * accepts any offline-capable record kind and `drainQueue` POSTs each to the
 * kind's endpoint (ENDPOINT_BY_KIND). `enqueueSprayRecord` is retained as a
 * herbicide-kind wrapper for back-compat.
 */

import { db, type PendingSprayRecord, type PendingRecordKind } from './dexie';

export interface DrainResult {
  succeeded: string[];
  failed: { id: string; error: string }[];
  skippedOtherOwner: number;
}

/** #316 — replay endpoint per record kind. Each POST re-runs the server
 *  kernel, so a queued record is re-validated exactly as if submitted live.
 *  Keep in lockstep with `PendingRecordKind` in dexie.ts. */
export const ENDPOINT_BY_KIND: Record<PendingRecordKind, string> = {
  herbicide: '/api/spray/record',
  insecticide: '/api/insecticide/record',
  fungicide: '/api/fungicide/record',
  harvest: '/api/harvest/record',
  'hay-cutting': '/api/hay/cuttings'
};

/** Rows written before the v3 Dexie upgrade lack `kind`; they were all
 *  herbicide sprays. Coalesce here so routing never sees `undefined`. */
export function kindOf(rec: Pick<PendingSprayRecord, 'kind'>): PendingRecordKind {
  return rec.kind ?? 'herbicide';
}

/** #316 — resolve the replay endpoint for a row, defaulting a missing/
 *  unknown kind to the herbicide endpoint (matches the pre-v3 shape). */
export function endpointForRecord(rec: Pick<PendingSprayRecord, 'kind'>): string {
  return ENDPOINT_BY_KIND[kindOf(rec)] ?? ENDPOINT_BY_KIND.herbicide;
}

/**
 * #314 — pure drain-guard decision. Given the active owner id and a row's
 * owner id, decide whether to submit, skip (belongs to another farm), or
 * halt the whole drain (no active owner ⇒ fail safe: never drain unfiltered).
 * Extracted so the tenant-safety contract is unit-testable without Dexie.
 */
export type DrainDecision = 'submit' | 'skip-other-owner' | 'halt-no-active-owner';

export function drainDecisionFor(
  activeOwnerId: string | null | undefined,
  recordOwnerId: string
): DrainDecision {
  if (!activeOwnerId) return 'halt-no-active-owner';
  return recordOwnerId === activeOwnerId ? 'submit' : 'skip-other-owner';
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

/**
 * #314 — seed `cropcard.activeOwnerId` from the server-provided active
 * owner id. Called on layout mount BEFORE any enqueue/drain so a fresh tab
 * or first-login (which never fires the Owner-switch that used to be the
 * only writer) tags rows with the correct owner and drains safely.
 *
 * Only writes when the value differs so we don't thrash storage on every
 * navigation. A live Owner-switch still overwrites this via
 * `resetTenantCaches` in tenantSwitch.ts.
 */
export function primeActiveOwnerId(ownerId: string | null | undefined): void {
  if (typeof window === 'undefined' || !ownerId) return;
  try {
    if (sessionStorage.getItem('cropcard.activeOwnerId') !== ownerId) {
      sessionStorage.setItem('cropcard.activeOwnerId', ownerId);
    }
  } catch {
    /* private mode → skip; drainQueue's fail-safe still protects us */
  }
}

/**
 * #316 — generalized enqueue. Stashes a payload under a record kind so the
 * drain can POST it to the right endpoint. `occurredAt` is lifted from the
 * payload when present (herbicide/insecticide/etc. carry it) so the queue
 * UI can show a sensible timestamp.
 */
export async function enqueueRecord(kind: PendingRecordKind, payload: unknown): Promise<string> {
  const id = uuid();
  const ownerId = currentOwnerId() ?? 'owner_home_farm';
  await db().pendingSprayRecords.put({
    id,
    ownerId,
    kind,
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

/** Back-compat herbicide-kind wrapper (#316). Existing call-sites and the
 *  herbicide /spray page continue to work unchanged. */
export async function enqueueSprayRecord(payload: unknown): Promise<string> {
  return enqueueRecord('herbicide', payload);
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
  const res = await fetch(endpointForRecord(rec), {
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
  // #314 — FAIL SAFE. If we don't know the active owner we must NOT drain:
  // an unfiltered drain would replay every tenant's rows against whichever
  // session is live. Treat null as "no active owner, skip entirely".
  if (!ownerId) {
    return { succeeded: [], failed: [], skippedOtherOwner: 0 };
  }
  const allPending = await listPending();
  const succeeded: string[] = [];
  const failed: { id: string; error: string }[] = [];
  let skippedOtherOwner = 0;
  for (const rec of allPending) {
    const decision = drainDecisionFor(ownerId, rec.ownerId);
    if (decision === 'halt-no-active-owner') {
      // Unreachable given the guard above, but keeps the contract explicit.
      break;
    }
    if (decision === 'skip-other-owner') {
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
