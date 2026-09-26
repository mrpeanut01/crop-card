// Deploy handoff fence + restore guard: the pure decisions, shared by the
// container entrypoint (scripts/handoff.mjs) and the running app
// (src/lib/server/ops/handoff.ts). See docs/ops/restore-runbook.md.
//
// Blobs (in the Litestream container, outside Litestream's own `<db>/` path):
//   _ops/handoff/request.json  — written by every booting container before it
//                                restores: { nonce, revision, requestedAt }.
//   _ops/handoff/holder.json   — written by the serving app: a heartbeat while
//                                it serves, then { state: 'released', position }
//                                once it has fenced writes and Litestream has
//                                shipped its last WAL frame.
//   _ops/initialized.json      — written once a replica has been restored; its
//                                presence makes an empty replica a hard error.

export const REQUEST_BLOB = '_ops/handoff/request.json';
export const HOLDER_BLOB = '_ops/handoff/holder.json';
export const INITIALIZED_BLOB = '_ops/initialized.json';

export const HEARTBEAT_MS = 20_000;
export const STALE_MS = 60_000;
export const ACQUIRE_TIMEOUT_MS = 75_000;
export const POLL_MS = 2_000;
export const DRAIN_TIMEOUT_MS = 10_000;
export const CATCHUP_TIMEOUT_MS = 15_000;
export const RETRY_AFTER_S = 10;

/**
 * @typedef {{ nonce: string, revision?: string, state: 'serving' | 'released', heartbeatAt?: number, releasedAt?: number, releasedTo?: string | null, position?: unknown, verified?: boolean }} Holder
 * @typedef {{ nonce: string, revision?: string, requestedAt?: number }} HandoffRequest
 */

/**
 * What a booting container does given the current holder record.
 * @param {Holder | null | undefined} holder
 * @param {number} now
 * @returns {{ action: 'proceed' | 'wait', reason: 'no-holder' | 'released' | 'stale' | 'serving' }}
 */
export function acquireDecision(holder, now) {
  if (!holder || typeof holder !== 'object' || !holder.nonce) {
    return { action: 'proceed', reason: 'no-holder' };
  }
  if (holder.state === 'released') return { action: 'proceed', reason: 'released' };
  const beat = Number(holder.heartbeatAt ?? 0);
  if (!Number.isFinite(beat) || now - beat > STALE_MS)
    return { action: 'proceed', reason: 'stale' };
  return { action: 'wait', reason: 'serving' };
}

/**
 * The serving app must fence when the latest boot request is not its own.
 * @param {HandoffRequest | null | undefined} request
 * @param {string} selfNonce
 */
export function shouldFence(request, selfNonce) {
  return !!request && typeof request.nonce === 'string' && request.nonce !== selfNonce;
}

/**
 * Decide whether a restore result is safe to serve.
 * @param {{ dbExists: boolean, replicaHasGenerations: boolean, initialized: boolean, owners: number | null, migrations: number | null, quickCheck: string | null, allowEmpty: boolean }} s
 * @returns {{ ok: boolean, fresh: boolean, reason: string }}
 */
export function restoreVerdict(s) {
  if (!s.dbExists) {
    if (s.replicaHasGenerations) {
      return s.allowEmpty
        ? {
            ok: true,
            fresh: true,
            reason: 'OVERRIDE: replica has generations but restore produced no database'
          }
        : {
            ok: false,
            fresh: false,
            reason: 'replica has generations but restore produced no database'
          };
    }
    if (s.initialized) {
      return s.allowEmpty
        ? { ok: true, fresh: true, reason: 'OVERRIDE: replica was initialized but is now empty' }
        : {
            ok: false,
            fresh: false,
            reason:
              'replica was initialized before but is now empty (deleted blobs? wrong container?)'
          };
    }
    return { ok: true, fresh: true, reason: 'no replica yet; first boot starts an empty database' };
  }
  if (s.quickCheck !== null && s.quickCheck !== 'ok') {
    return {
      ok: false,
      fresh: false,
      reason: `restored database failed quick_check: ${s.quickCheck}`
    };
  }
  if (!s.allowEmpty && (s.migrations ?? 0) === 0) {
    return { ok: false, fresh: false, reason: 'restored database has no applied migrations' };
  }
  if (!s.allowEmpty && (s.owners ?? 0) === 0) {
    return { ok: false, fresh: false, reason: 'restored database has zero owners' };
  }
  return { ok: true, fresh: false, reason: 'restored' };
}

/**
 * Litestream 0.3 WAL framing: 32-byte WAL header, 24-byte frame header.
 * @param {number} offset
 * @param {number} pageSize
 */
export function frameAlign(offset, pageSize) {
  if (offset < 32) return 0;
  const frame = 24 + pageSize;
  return Math.floor((offset - 32) / frame) * frame + 32;
}

/**
 * Pull one db's replica position and sync counter from Litestream's
 * Prometheus text.
 * @param {string} text
 * @param {string} dbPath
 * @returns {{ replicaIndex: number | null, replicaOffset: number | null, syncCount: number | null }}
 */
export function parseLitestreamMetrics(text, dbPath) {
  /** @param {string} name */
  const pick = (name) => {
    for (const line of text.split('\n')) {
      if (!line.startsWith(`${name}{`)) continue;
      if (!line.includes(`db="${dbPath}"`)) continue;
      const v = Number(line.slice(line.lastIndexOf(' ') + 1));
      if (Number.isFinite(v)) return v;
    }
    return null;
  };
  return {
    replicaIndex: pick('litestream_replica_wal_index'),
    replicaOffset: pick('litestream_replica_wal_offset'),
    syncCount: pick('litestream_sync_count')
  };
}
