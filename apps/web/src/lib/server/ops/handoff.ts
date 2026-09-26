import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  configFromEnv,
  getJson,
  putJson,
  type BlobConfig
} from '../../../../scripts/lib/azureBlob.mjs';
import {
  CATCHUP_TIMEOUT_MS,
  DRAIN_TIMEOUT_MS,
  HEARTBEAT_MS,
  HOLDER_BLOB,
  POLL_MS,
  REQUEST_BLOB,
  frameAlign,
  parseLitestreamMetrics,
  shouldFence
} from '../../../../scripts/lib/handoffProtocol.mjs';
import { setDbReadOnly } from '$lib/db/client';

export interface WalPosition {
  generation: string;
  index: number;
  offset: number;
}

type Phase = 'serving' | 'fencing' | 'released';

const state: {
  phase: Phase;
  reason: string | null;
  inflight: number;
  started: boolean;
} = { phase: 'serving', reason: null, inflight: 0, started: false };

const log = (msg: string) => console.log(`[handoff] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isFenced(): boolean {
  return state.phase !== 'serving';
}

export function handoffStatus(): { phase: Phase; reason: string | null; inflight: number } {
  return { phase: state.phase, reason: state.reason, inflight: state.inflight };
}

/** Run a mutating request while counting it, so a release can wait for
 *  requests that were admitted before the fence went up. */
export async function trackMutation<T>(fn: () => Promise<T>): Promise<T> {
  state.inflight++;
  try {
    return await fn();
  } finally {
    state.inflight--;
  }
}

/** Test-only reset. */
export function _resetHandoffForTests(): void {
  state.phase = 'serving';
  state.reason = null;
  state.inflight = 0;
  state.started = false;
  releasing = null;
  deps = null;
  holderEtag = null;
}

/** Test-only: put the process into the fenced state without Blob I/O. */
export function _fenceForTests(reason = 'test'): void {
  state.phase = 'fencing';
  state.reason = reason;
}

/** Litestream 0.3's own notion of the DB position: the highest shadow WAL
 *  index of the current generation, and that file's frame-aligned size. */
export async function localWalPosition(
  dbPath: string,
  pageSize: number
): Promise<WalPosition | null> {
  const meta = path.join(path.dirname(dbPath), `.${path.basename(dbPath)}-litestream`);
  let generation: string;
  try {
    generation = (await readFile(path.join(meta, 'generation'), 'utf8')).trim();
  } catch {
    return null;
  }
  if (!generation) return null;
  const walDir = path.join(meta, 'generations', generation, 'wal');
  let index = -1;
  for (const name of await readdir(walDir).catch(() => [] as string[])) {
    const m = /^([0-9a-f]{8})\.wal$/.exec(name);
    if (m) index = Math.max(index, parseInt(m[1], 16));
  }
  if (index < 0) return { generation, index: 0, offset: 0 };
  const file = path.join(walDir, `${index.toString(16).padStart(8, '0')}.wal`);
  const size = (await stat(file)).size;
  return { generation, index, offset: frameAlign(size, pageSize) };
}

async function scrapeMetrics(url: string, dbPath: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`metrics HTTP ${res.status}`);
  return parseLitestreamMetrics(await res.text(), dbPath);
}

/**
 * Wait until Litestream has run at least two syncs after writes stopped and
 * its replica position matches the local shadow WAL, i.e. every committed
 * frame is in Blob. Bounded; returns what it could prove.
 */
async function waitForReplicaCatchUp(
  metricsUrl: string,
  dbPath: string,
  pageSize: number,
  timeoutMs: number
): Promise<{ verified: boolean; position: WalPosition | null; detail: string }> {
  const deadline = Date.now() + timeoutMs;
  let baseline: number | null = null;
  let last = 'no metrics yet';
  let position: WalPosition | null = null;
  while (Date.now() < deadline) {
    try {
      const m = await scrapeMetrics(metricsUrl, dbPath);
      if (baseline === null) baseline = m.syncCount;
      position = await localWalPosition(dbPath, pageSize);
      const synced = m.syncCount !== null && baseline !== null && m.syncCount >= baseline + 2;
      const caughtUp =
        !!position && m.replicaIndex === position.index && m.replicaOffset === position.offset;
      last = `sync ${m.syncCount}/${baseline === null ? '?' : baseline + 2} replica ${m.replicaIndex}:${m.replicaOffset} local ${position?.index}:${position?.offset}`;
      if (synced && caughtUp) return { verified: true, position, detail: last };
    } catch (e) {
      const cause = e instanceof Error && e.cause instanceof Error ? `: ${e.cause.message}` : '';
      last = `${e instanceof Error ? e.message : String(e)}${cause}`;
    }
    await sleep(500);
  }
  return { verified: false, position, detail: last };
}

interface WatcherDeps {
  cfg: BlobConfig;
  nonce: string;
  revision: string;
  dbPath: string;
  metricsUrl: string;
}

let deps: WatcherDeps | null = null;
let holderEtag: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let releasing: Promise<void> | null = null;

async function heartbeat(): Promise<void> {
  if (!deps || state.phase !== 'serving') return;
  const r = await putJson(
    deps.cfg,
    HOLDER_BLOB,
    { nonce: deps.nonce, revision: deps.revision, state: 'serving', heartbeatAt: Date.now() },
    holderEtag ? { ifMatch: holderEtag } : {}
  );
  if (r.ok) {
    holderEtag = r.etag;
    return;
  }
  void release('another container took over the writer lease', null);
}

async function poll(): Promise<void> {
  if (!deps || state.phase !== 'serving') return;
  const got = await getJson(deps.cfg, REQUEST_BLOB);
  const req = got?.value as { nonce?: string; revision?: string } | null;
  if (req && shouldFence({ nonce: String(req.nonce ?? '') }, deps.nonce)) {
    void release(`handoff requested by ${req.revision ?? 'a new container'}`, req.nonce ?? null);
  }
}

/**
 * Stop taking writes, let admitted ones finish, make the connection
 * read-only, wait for Litestream to ship the last frame, then record the
 * release so the next container can restore. Idempotent.
 */
export function release(reason: string, releasedTo: string | null): Promise<void> {
  if (releasing) return releasing;
  state.phase = 'fencing';
  state.reason = reason;
  log(`fencing writes: ${reason}`);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (pollTimer) clearInterval(pollTimer);
  releasing = (async () => {
    const drainDeadline = Date.now() + DRAIN_TIMEOUT_MS;
    while (state.inflight > 0 && Date.now() < drainDeadline) await sleep(100);
    if (state.inflight > 0) log(`${state.inflight} request(s) still running after drain timeout`);
    let pageSize = 4096;
    try {
      pageSize = setDbReadOnly();
    } catch (e) {
      log(`could not set the connection read-only: ${e instanceof Error ? e.message : e}`);
    }
    if (!deps) {
      state.phase = 'released';
      return;
    }
    const catchUp = await waitForReplicaCatchUp(
      deps.metricsUrl,
      deps.dbPath,
      pageSize,
      CATCHUP_TIMEOUT_MS
    );
    const record = {
      nonce: deps.nonce,
      revision: deps.revision,
      state: 'released',
      releasedAt: Date.now(),
      releasedTo,
      position: catchUp.position,
      verified: catchUp.verified
    };
    try {
      const r = await putJson(
        deps.cfg,
        HOLDER_BLOB,
        record,
        holderEtag ? { ifMatch: holderEtag } : {}
      );
      if (!r.ok) log('holder record already replaced by the new container');
    } catch (e) {
      log(`could not write the release record: ${e instanceof Error ? e.message : e}`);
    }
    state.phase = 'released';
    if (catchUp.verified) {
      log(`released at ${JSON.stringify(catchUp.position)} (replica verified)`);
    } else {
      console.error(
        `[handoff] RELEASE_UNVERIFIED: replica catch-up not proven (${catchUp.detail})`
      );
    }
  })();
  return releasing;
}

/**
 * Start the writer lease: claim the holder record, heartbeat it, poll for a
 * newer container's handoff request, and release on SIGTERM. A no-op unless
 * HANDOFF_FENCE=1 and the Litestream storage settings are present.
 */
export function startHandoffWatcher(env: NodeJS.ProcessEnv = process.env): void {
  if (state.started || env.HANDOFF_FENCE !== '1' || env.VITEST) return;
  const cfg = configFromEnv(env);
  if (!cfg || !env.HANDOFF_NONCE) {
    log('HANDOFF_FENCE=1 but storage settings or HANDOFF_NONCE are missing; fence disabled');
    return;
  }
  state.started = true;
  deps = {
    cfg,
    nonce: env.HANDOFF_NONCE,
    revision: env.CONTAINER_APP_REVISION ?? env.HOSTNAME ?? 'unknown',
    dbPath: (env.DATABASE_URL ?? 'file:/data/cropcard.db').replace(/^file:/, ''),
    metricsUrl: env.LITESTREAM_METRICS_URL ?? 'http://127.0.0.1:9090/metrics'
  };
  const swallow = (what: string) => (e: unknown) =>
    log(`${what} failed: ${e instanceof Error ? e.message : e}`);
  heartbeat()
    .then(() => log(`writer lease held by ${deps?.revision}`))
    .catch(swallow('claim'));
  heartbeatTimer = setInterval(() => void heartbeat().catch(swallow('heartbeat')), HEARTBEAT_MS);
  pollTimer = setInterval(() => void poll().catch(swallow('poll')), POLL_MS);
  heartbeatTimer.unref();
  pollTimer.unref();
  process.once('SIGTERM', () => void release('container stopping (SIGTERM)', null));
}
