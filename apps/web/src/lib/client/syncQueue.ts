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
 *
 * Stale-tab guard: `cropcard.activeOwnerId` is per tab, but the session
 * cookie is shared, so a switch in another tab leaves this tab's id stale.
 * Before replaying anything, `drainQueue` confirms the server's active Owner
 * matches the tab's and halts on a mismatch; each replay POST also names its
 * row's Owner (`EXPECTED_OWNER_HEADER`) so the server refuses it if the
 * session moves mid-drain. A definitive 4xx (e.g. a foreign-ref 400 or a
 * kernel 422) marks the row `rejected` so it stops retrying and waits for
 * the operator on /records/pending.
 */

import { db, type PendingSprayRecord, type PendingRecordKind } from './dexie';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import {
  EXPECTED_OWNER_HEADER,
  classifySubmitFailure,
  fetchServerActiveOwner,
  type SubmitFailure
} from './ownerSync';

export type DrainHalt = 'offline' | 'no-active-owner' | 'owner-unverified' | 'owner-mismatch';

export interface DrainResult {
  succeeded: string[];
  /** Transient failures; retried on the next drain. */
  failed: { id: string; error: string }[];
  /** Definitive 4xx; parked until the operator retries or discards. */
  rejected: { id: string; status: number; error: string }[];
  skippedOtherOwner: number;
  /** Previously rejected rows left alone by this drain. */
  skippedRejected: number;
  /** Why the drain stopped early, if it did. */
  halted: DrainHalt | null;
  /** The server's active Owner when it disagreed with this tab's. */
  serverOwnerId?: string | null;
}

function emptyResult(halted: DrainHalt | null): DrainResult {
  return {
    succeeded: [],
    failed: [],
    rejected: [],
    skippedOtherOwner: 0,
    skippedRejected: 0,
    halted
  };
}

/** #316 — replay endpoint per record kind. Each POST re-runs the server
 *  kernel, so a queued record is re-validated exactly as if submitted live.
 *  Keep in lockstep with `PendingRecordKind` in dexie.ts. */
export const ENDPOINT_BY_KIND: Record<PendingRecordKind, string> = {
  herbicide: '/api/spray/record',
  insecticide: '/api/insecticide/record',
  fungicide: '/api/fungicide/record',
  harvest: '/api/harvest/record',
  'hay-cutting': '/api/hay/cuttings',
  scout: '/api/scout/record',
  journal: '/api/journal/record'
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

/** #278 — tag for a row enqueued while the active Owner is unknown. It can
 *  never equal a real owner id, so the row is never listed, drained, or
 *  discarded under any tenant; it surfaces only in the other-farm count.
 *  Previously such rows were tagged `owner_home_farm`, which would have
 *  replayed another farm's record against the Home Farm session. */
export const UNASSIGNED_OWNER_ID = '__unassigned__';

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

/** Kinds whose server gates depend on the application time of day
 *  (insecticide pollinator dusk-to-dawn / residual). Their payloads must
 *  carry the moment the operator recorded, not the drain time. */
const TIME_GATED_KINDS: ReadonlySet<PendingRecordKind> = new Set(['insecticide']);

/** Stamps `occurredAt` on a time-gated payload that lacks one. Pure; other
 *  kinds and payloads that already carry a timestamp pass through as-is. */
export function withOccurredAt(kind: PendingRecordKind, payload: unknown, now: number): unknown {
  if (!TIME_GATED_KINDS.has(kind)) return payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const existing = (payload as { occurredAt?: unknown }).occurredAt;
  if (typeof existing === 'number' && Number.isFinite(existing)) return payload;
  return { ...(payload as Record<string, unknown>), occurredAt: now };
}

/**
 * #316 — generalized enqueue. Stashes a payload under a record kind so the
 * drain can POST it to the right endpoint. `occurredAt` is lifted from the
 * payload when present (herbicide/insecticide/etc. carry it) so the queue
 * UI can show a sensible timestamp.
 */
export async function enqueueRecord(kind: PendingRecordKind, raw: unknown): Promise<string> {
  const id = uuid();
  const payload = withOccurredAt(kind, raw, Date.now());
  const ownerId = currentOwnerId() ?? UNASSIGNED_OWNER_ID;
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
 *  "queued at <other farm>" hint on the layout banner. Scans rather than
 *  using the `ownerId` index so rows lacking an ownerId (absent from the
 *  index) are still surfaced instead of silently hidden. */
export async function pendingCountForOtherOwners(): Promise<number> {
  const ownerId = currentOwnerId();
  if (!ownerId) return 0;
  return db()
    .pendingSprayRecords.filter((r) => r.ownerId !== ownerId)
    .count();
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

/** Operator "retry" for a rejected row: clears the rejection so the next
 *  drain replays it. Scoped to the active Owner like discard. */
export async function retryRejectedForActiveOwner(id: string): Promise<boolean> {
  const ownerId = currentOwnerId();
  if (!ownerId) return false;
  const target = await db().pendingSprayRecords.get(id);
  if (!target || target.ownerId !== ownerId || target.status !== 'rejected') return false;
  await db()
    .pendingSprayRecords.where('id')
    .equals(id)
    .modify((r) => {
      delete r.status;
      delete r.lastStatus;
    });
  return true;
}

type SubmitOutcome =
  { ok: true } | { ok: false; kind: SubmitFailure; status: number; error: string };

async function submitOne(rec: PendingSprayRecord): Promise<SubmitOutcome> {
  let res: Response;
  try {
    res = await fetch(endpointForRecord(rec), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [EXPECTED_OWNER_HEADER]: rec.ownerId,
        [CLIENT_RECORD_HEADER]: rec.id
      },
      body: JSON.stringify(rec.payload),
      credentials: 'include'
    });
  } catch (e) {
    return {
      ok: false,
      kind: 'retry',
      status: 0,
      error: e instanceof Error ? e.message : String(e)
    };
  }
  if (res.ok) return { ok: true };
  const body = await res.text().catch(() => '');
  return {
    ok: false,
    kind: classifySubmitFailure(res.status, body),
    status: res.status,
    error: `HTTP ${res.status}: ${body.slice(0, 240)}`
  };
}

let inflight: Promise<DrainResult> | null = null;

/** Drains the active Owner's queue. Overlapping callers (a flapping
 *  `online` event, "Sync now" during an auto-drain) share one run, so no
 *  row is POSTed twice by this tab. */
export function drainQueue(): Promise<DrainResult> {
  if (inflight) return inflight;
  inflight = drainOnce().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function drainOnce(): Promise<DrainResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return emptyResult('offline');
  }
  const ownerId = currentOwnerId();
  // #314 — FAIL SAFE. If we don't know the active owner we must NOT drain:
  // an unfiltered drain would replay every tenant's rows against whichever
  // session is live. Treat null as "no active owner, skip entirely".
  if (!ownerId) return emptyResult('no-active-owner');

  const allPending = await listPending();
  const result = emptyResult(null);
  const mine: PendingSprayRecord[] = [];
  for (const rec of allPending) {
    const decision = drainDecisionFor(ownerId, rec.ownerId);
    if (decision === 'halt-no-active-owner') return emptyResult('no-active-owner');
    if (decision === 'skip-other-owner') result.skippedOtherOwner++;
    else if (rec.status === 'rejected') result.skippedRejected++;
    else mine.push(rec);
  }
  if (mine.length === 0) return result;

  const serverOwnerId = await fetchServerActiveOwner();
  if (serverOwnerId !== ownerId) {
    result.halted = serverOwnerId === null ? 'owner-unverified' : 'owner-mismatch';
    result.serverOwnerId = serverOwnerId;
    return result;
  }

  for (const rec of mine) {
    const outcome = await submitOne(rec);
    if (outcome.ok) {
      await db().pendingSprayRecords.delete(rec.id);
      result.succeeded.push(rec.id);
      continue;
    }
    if (outcome.kind === 'owner-mismatch') {
      // The session moved to another Owner mid-drain; the server ran nothing.
      // Leave this row and the rest untouched for when this farm is active.
      result.halted = 'owner-mismatch';
      break;
    }
    const patch: Partial<PendingSprayRecord> = {
      attempts: rec.attempts + 1,
      lastErrorAt: Date.now(),
      lastError: outcome.error,
      lastStatus: outcome.status
    };
    if (outcome.kind === 'rejected') {
      patch.status = 'rejected';
      result.rejected.push({ id: rec.id, status: outcome.status, error: outcome.error });
    } else {
      result.failed.push({ id: rec.id, error: outcome.error });
    }
    await db().pendingSprayRecords.update(rec.id, patch);
  }
  return result;
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
