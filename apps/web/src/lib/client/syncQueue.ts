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
import { holdQueueMarker, type HoldQueueMarker } from '$lib/animals/holdGuardCopy';
import {
  QUEUED_LIVE_FIELD,
  lineageKeys,
  payloadSubjectKeys,
  rejectInfoOf,
  rewriteForRecovery,
  type RecoveryAction,
  type RejectInfo
} from '$lib/animals/queueRecovery';
import type { FarmSnapshot } from '$lib/cards/snapshot';

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
  /** 32D (D1-09): animal rows held back because an earlier row for the
   *  same animal, group or flock was refused and is still waiting. */
  heldBehindRejected: string[];
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
    heldBehindRejected: [],
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
  task: '/api/tasks/close',
  journal: '/api/journal/record',
  'animal-move': '/api/animals/move',
  'animal-health': '/api/animals/health/record',
  'animal-production': '/api/animals/production/record',
  'feed-use': '/api/stock/:id/use',
  'seed-start': '/api/seed-starts/:id/progress',
  irrigation: '/api/irrigation',
  'rain-gauge': '/api/rain-gauge',
  'harvest-disposition': '/api/harvest/:id/dispositions'
};

const STOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Rows written before the v3 Dexie upgrade lack `kind`; they were all
 *  herbicide sprays. Coalesce here so routing never sees `undefined`. */
export function kindOf(rec: Pick<PendingSprayRecord, 'kind'>): PendingRecordKind {
  return rec.kind ?? 'herbicide';
}

/** Shown on a queued row whose kind this build does not route (A-10). */
export const UNSENDABLE_KIND_NOTE = "This app version can't send this record yet.";

function isRoutedKind(kind: string): kind is PendingRecordKind {
  return Object.hasOwn(ENDPOINT_BY_KIND, kind);
}

/** #316 — resolve the replay endpoint for a row. A row with no `kind` predates
 *  v3 and was a herbicide spray. A row whose kind this build does not route
 *  gets null and is never posted (A-10): it must not replay to the wrong
 *  endpoint. */
export function endpointForRecord(
  rec: Pick<PendingSprayRecord, 'kind'> & { payload?: unknown }
): string | null {
  const kind = kindOf(rec);
  if (!isRoutedKind(kind)) return null;
  if (kind === 'feed-use') {
    const id = (rec.payload as { stockItemId?: unknown } | null | undefined)?.stockItemId;
    const safe = typeof id === 'string' && STOCK_ID_PATTERN.test(id) ? id : '_';
    return `/api/stock/${safe}/use`;
  }
  if (kind === 'seed-start') {
    const id = (rec.payload as { seedStartId?: unknown } | null | undefined)?.seedStartId;
    const safe = typeof id === 'string' && STOCK_ID_PATTERN.test(id) ? id : '_';
    return `/api/seed-starts/${safe}/progress`;
  }
  if (kind === 'harvest-disposition') {
    const id = (rec.payload as { harvestEventId?: unknown } | null | undefined)?.harvestEventId;
    const safe = typeof id === 'string' && STOCK_ID_PATTERN.test(id) ? id : '_';
    return `/api/harvest/${safe}/dispositions`;
  }
  return ENDPOINT_BY_KIND[kind];
}

/** The body a row replays with. `feed-use` carries its stock item,
 *  `seed-start` its tray and `harvest-disposition` its harvest in the path,
 *  not the body. */
export function bodyForRecord(rec: Pick<PendingSprayRecord, 'kind' | 'payload'>): unknown {
  const kind = kindOf(rec);
  if (kind !== 'feed-use' && kind !== 'seed-start' && kind !== 'harvest-disposition') {
    return rec.payload;
  }
  if (!rec.payload || typeof rec.payload !== 'object') return rec.payload;
  const {
    stockItemId: _drop,
    seedStartId: _tray,
    harvestEventId: _harvest,
    ...rest
  } = rec.payload as Record<string, unknown>;
  return rest;
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

/** Kinds whose server gates and holds depend on when the work was done
 *  (insecticide pollinator dusk-to-dawn, the grazing and hay rules that
 *  count from an application or a cut). Their payloads must carry the
 *  moment the operator recorded, not the drain time. The value is the
 *  field the endpoint reads that moment from. */
const TIME_GATED_KINDS: ReadonlyMap<PendingRecordKind, 'occurredAt' | 'mowAt' | 'movedAt'> =
  new Map<PendingRecordKind, 'occurredAt' | 'mowAt' | 'movedAt'>([
    ['herbicide', 'occurredAt'],
    ['insecticide', 'occurredAt'],
    ['fungicide', 'occurredAt'],
    ['harvest', 'occurredAt'],
    ['hay-cutting', 'mowAt'],
    ['animal-production', 'occurredAt'],
    ['animal-move', 'movedAt'],
    ['feed-use', 'occurredAt'],
    ['irrigation', 'occurredAt'],
    ['harvest-disposition', 'occurredAt']
  ]);

/** Stamps the recorded moment on a time-gated payload that lacks one.
 *  Pure; other kinds and payloads that already carry it pass through. */
export function withOccurredAt(kind: PendingRecordKind, payload: unknown, now: number): unknown {
  const field = TIME_GATED_KINDS.get(kind);
  if (!field) return payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const existing = (payload as Record<string, unknown>)[field];
  if (typeof existing === 'number' && Number.isFinite(existing)) return payload;
  return { ...(payload as Record<string, unknown>), [field]: now };
}

function recordedAt(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as {
    occurredAt?: unknown;
    mowAt?: unknown;
    movedAt?: unknown;
    administeredAt?: unknown;
    readAt?: unknown;
  };
  const v = [p.occurredAt, p.mowAt, p.movedAt, p.administeredAt, p.readAt].find(
    (x) => typeof x === 'number'
  );
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * #316 — generalized enqueue. Stashes a payload under a record kind so the
 * drain can POST it to the right endpoint. `occurredAt` is lifted from the
 * payload when present (herbicide/insecticide/etc. carry it) so the queue
 * UI can show a sensible timestamp.
 */
/** `id` becomes the replay's client record id. Pass the one an online
 *  attempt already sent, so a replay after a lost response is a duplicate. */
export async function enqueueRecord(
  kind: PendingRecordKind,
  raw: unknown,
  id: string = uuid()
): Promise<string> {
  const payload = withOccurredAt(kind, raw, Date.now());
  const ownerId = currentOwnerId() ?? UNASSIGNED_OWNER_ID;
  await db().pendingSprayRecords.put({
    id,
    ownerId,
    kind,
    occurredAt: recordedAt(payload) ?? Date.now(),
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
      delete r.rejectInfo;
    });
  return true;
}

async function loadActiveSnapshot(): Promise<FarmSnapshot | null> {
  try {
    const { loadSnapshot } = await import('./cardStore');
    return (await loadSnapshot())?.bundle ?? null;
  } catch {
    return null;
  }
}

function animalLineage(
  rec: Pick<PendingSprayRecord, 'kind' | 'payload'>,
  snapshot: FarmSnapshot | null
): string[] {
  const keys = payloadSubjectKeys(rec.kind, rec.payload);
  if (keys.length === 0) return [];
  return [...lineageKeys(keys, snapshot)];
}

async function ownRejectedRow(id: string): Promise<PendingSprayRecord | null> {
  const ownerId = currentOwnerId();
  if (!ownerId) return null;
  const target = await db().pendingSprayRecords.get(id);
  if (!target || target.ownerId !== ownerId || target.status !== 'rejected') return null;
  return target;
}

/**
 * 32D recovery for a refused row (D0-11, D1-06, D1-07). Every action but
 * `keep-here` rewrites the parked row in place and clears the refusal, so
 * the next drain re-sends it under the same client record id; the server
 * released that id when it refused, so the record saves once.
 * `keep-here` drops a refused move: nothing is sent. Scoped to the active
 * Owner like discard. Returns false when the row is not this Owner's
 * refused row or the action does not apply to it.
 */
export async function recoverRejectedForActiveOwner(
  id: string,
  action: RecoveryAction,
  opts: { now?: number; at?: number } = {}
): Promise<boolean> {
  const target = await ownRejectedRow(id);
  if (!target) return false;
  if (action === 'retry') return retryRejectedForActiveOwner(id);
  if (action === 'keep-here') {
    if (kindOf(target) !== 'animal-move') return false;
    await db().pendingSprayRecords.delete(id);
    return true;
  }
  const now = opts.now ?? Date.now();
  const payload = rewriteForRecovery(target.kind, target.payload, action, { now, at: opts.at });
  if (!payload) return false;
  await db()
    .pendingSprayRecords.where('id')
    .equals(id)
    .modify((r) => {
      r.payload = payload;
      r.occurredAt = recordedAt(payload) ?? r.occurredAt;
      delete r.status;
      delete r.lastStatus;
      delete r.rejectInfo;
      delete r.holdMarker;
    });
  return true;
}

/** Offline-tapped moves carry this flag so a replay is judged as live. */
export function markQueuedLive(payload: Record<string, unknown>): Record<string, unknown> {
  return { ...payload, [QUEUED_LIVE_FIELD]: true };
}

type SubmitOutcome =
  | { ok: true }
  | {
      ok: false;
      kind: SubmitFailure;
      status: number;
      error: string;
      holdMarker?: HoldQueueMarker | null;
      rejectInfo?: RejectInfo;
    };

async function submitOne(rec: PendingSprayRecord, endpoint: string): Promise<SubmitOutcome> {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [EXPECTED_OWNER_HEADER]: rec.ownerId,
        [CLIENT_RECORD_HEADER]: rec.id
      },
      body: JSON.stringify(bodyForRecord(rec)),
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
    error: `HTTP ${res.status}: ${body.slice(0, 240)}`,
    holdMarker: holdQueueMarker(res.status, body),
    rejectInfo: rejectInfoOf(body)
  };
}

let inflight: Promise<DrainResult> | null = null;
let scheduled: ReturnType<typeof setTimeout> | null = null;

/** Drain once after `ms` (coalesced). Used when the server answered "updating,
 *  retry shortly" (the deploy handoff fence): the row is queued and sent as
 *  soon as the new server is up, without waiting for the next page load. */
export function scheduleDrain(ms: number): void {
  if (typeof window === 'undefined' || scheduled) return;
  scheduled = setTimeout(() => {
    scheduled = null;
    drainQueue().catch(() => {});
  }, ms);
}

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

  const snapshot = await loadActiveSnapshot();
  const blocked = new Set<string>();
  for (const rec of allPending) {
    if (rec.ownerId !== ownerId || rec.status !== 'rejected') continue;
    for (const k of animalLineage(rec, snapshot)) blocked.add(k);
  }

  for (const rec of mine) {
    const lineage = animalLineage(rec, snapshot);
    if (lineage.some((k) => blocked.has(k))) {
      // D1-09: an earlier row for this animal or flock is waiting on the
      // operator. Replaying this one first could save it out of order.
      for (const k of lineage) blocked.add(k);
      result.heldBehindRejected.push(rec.id);
      continue;
    }
    const endpoint = endpointForRecord(rec);
    if (endpoint === null) {
      // A-10: kept, never posted, until an app version that routes it loads.
      await db().pendingSprayRecords.update(rec.id, {
        lastErrorAt: Date.now(),
        lastError: UNSENDABLE_KIND_NOTE
      });
      result.failed.push({ id: rec.id, error: UNSENDABLE_KIND_NOTE });
      continue;
    }
    const outcome = await submitOne(rec, endpoint);
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
      lastStatus: outcome.status,
      holdMarker: outcome.holdMarker ?? undefined,
      rejectInfo: outcome.rejectInfo
    };
    if (outcome.kind === 'rejected') {
      patch.status = 'rejected';
      for (const k of lineage) blocked.add(k);
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
