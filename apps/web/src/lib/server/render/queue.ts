/**
 * Contract C-R1, main thread: the one render queue (R-04, R-05, R-10).
 *
 * One job runs at a time, in a lazily started `node:worker_threads` worker
 * (thread mode) or on this thread (inline mode); up to 3 more wait, FIFO;
 * each Owner has at most 2 running or waiting. Everything a job needs was
 * read and checked before it got here (R-07).
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { RETRY_AFTER_S } from '../../../../scripts/lib/handoffProtocol.mjs';
import { isFenced, trackRender } from '$lib/server/ops/handoff';
import { executeRenderJob, type RenderJob, type RenderResult } from './jobs';
import { noteRenderMode, renderCounters, renderTimingStore, type RenderMode } from './metrics';
import type { WorkerReply, WorkerRequest } from './protocol';

export type RenderRefusalCode = 'RENDER_BUSY' | 'RENDER_TIMEOUT' | 'RENDER_FAILED' | 'UPDATING';

export class RenderRefused extends Error {
  readonly code: RenderRefusalCode;
  readonly status: 429 | 503;
  readonly retryAfterS: number;
  constructor(code: RenderRefusalCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'RenderRefused';
    this.code = code;
    this.status = code === 'RENDER_BUSY' ? 429 : 503;
    this.retryAfterS = code === 'UPDATING' ? RETRY_AFTER_S : limits.retryAfterS;
  }
}

const DEFAULT_LIMITS = {
  waiting: 3,
  perOwner: 2,
  timeoutMs: 120_000,
  idleMs: 10 * 60_000,
  retryAfterS: 15,
  maxOldGenerationSizeMb: 384
};
let limits = { ...DEFAULT_LIMITS };

interface Entry {
  job: RenderJob;
  ownerId: string;
  signal?: AbortSignal;
  onAbort?: () => void;
  resolve: (r: RenderResult) => void;
  reject: (e: unknown) => void;
}

let running: Entry | null = null;
const waiting: Entry[] = [];
const perOwner = new Map<string, number>();

interface WorkerState {
  worker: Worker;
  ready: Promise<boolean>;
  current: {
    id: number;
    resolve: (r: RenderResult) => void;
    reject: (e: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null;
}

let ws: WorkerState | null = null;
let unavailable: string | null = null;
let seq = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** `RENDER_MODE=thread|inline`; thread by default in production (R-10). */
export function configuredRenderMode(env: NodeJS.ProcessEnv = process.env): RenderMode {
  if (env.RENDER_MODE === 'thread' || env.RENDER_MODE === 'inline') return env.RENDER_MODE;
  return env.NODE_ENV === 'production' ? 'thread' : 'inline';
}

export function renderWorkerPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.RENDER_WORKER_PATH || resolve(process.cwd(), 'build/render-worker.mjs');
}

/** The mode jobs actually run in right now. */
export function effectiveRenderMode(): RenderMode {
  return configuredRenderMode() === 'thread' && !unavailable ? 'thread' : 'inline';
}

function markUnavailable(reason: string): void {
  if (unavailable) return;
  unavailable = reason;
  console.warn(`[render] worker unavailable (${reason}); rendering on the main thread`);
}

function failCurrent(state: WorkerState, err: unknown): void {
  const cur = state.current;
  if (!cur) return;
  state.current = null;
  clearTimeout(cur.timer);
  cur.reject(err);
}

function dropWorker(state: WorkerState): void {
  if (ws === state) ws = null;
  void state.worker.terminate().catch(() => {});
}

function startWorker(): WorkerState | null {
  if (unavailable) return null;
  if (ws) return ws;
  const path = renderWorkerPath();
  if (!existsSync(path)) {
    markUnavailable(`no bundle at ${path}`);
    return null;
  }
  let worker: Worker;
  try {
    worker = new Worker(path, {
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb }
    });
  } catch (e) {
    markUnavailable(e instanceof Error ? e.message : String(e));
    return null;
  }
  worker.unref();
  let settleReady: (ok: boolean) => void = () => {};
  const state: WorkerState = {
    worker,
    ready: new Promise<boolean>((r) => (settleReady = r)),
    current: null
  };
  let isReady = false;
  worker.on('message', (msg: WorkerReply) => {
    if (msg.type === 'ready') {
      isReady = true;
      settleReady(true);
      return;
    }
    if (msg.type === 'fatal') {
      markUnavailable(msg.message);
      settleReady(false);
      return;
    }
    const cur = state.current;
    if (!cur || cur.id !== msg.id) return;
    state.current = null;
    clearTimeout(cur.timer);
    if (msg.type === 'done') cur.resolve(msg.result);
    else cur.reject(new Error(msg.message));
  });
  worker.on('error', (err) => {
    if (!isReady) {
      markUnavailable(err.message);
      settleReady(false);
    }
    failCurrent(state, new RenderRefused('RENDER_FAILED', err.message));
    if (ws === state) ws = null;
  });
  worker.on('exit', (code) => {
    if (!isReady) {
      markUnavailable(`worker exited with code ${code} before it was ready`);
      settleReady(false);
    }
    failCurrent(state, new RenderRefused('RENDER_FAILED', `worker exited with code ${code}`));
    if (ws === state) ws = null;
  });
  ws = state;
  return state;
}

async function runInWorker(job: RenderJob): Promise<RenderResult | null> {
  const state = startWorker();
  if (!state) return null;
  if (!(await state.ready)) return null;
  return new Promise<RenderResult>((resolveJob, rejectJob) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      failCurrent(state, new RenderRefused('RENDER_TIMEOUT'));
      dropWorker(state);
    }, limits.timeoutMs);
    state.current = { id, resolve: resolveJob, reject: rejectJob, timer };
    try {
      state.worker.postMessage({ id, job } satisfies WorkerRequest);
    } catch (e) {
      failCurrent(state, e);
    }
  });
}

function runInline(job: RenderJob): Promise<RenderResult> {
  return new Promise<RenderResult>((resolveJob, rejectJob) => {
    const timer = setTimeout(
      () => rejectJob(new RenderRefused('RENDER_TIMEOUT')),
      limits.timeoutMs
    );
    executeRenderJob(job).then(
      (r) => {
        clearTimeout(timer);
        resolveJob(r);
      },
      (e) => {
        clearTimeout(timer);
        rejectJob(e);
      }
    );
  });
}

async function execute(job: RenderJob): Promise<{ result: RenderResult; mode: RenderMode }> {
  if (configuredRenderMode() === 'thread') {
    const result = await runInWorker(job);
    if (result) return { result, mode: 'thread' };
    return { result: await runInline(job), mode: 'inline' };
  }
  // Dev and tests copy the job the way postMessage would, so data that
  // could not cross to the worker fails here first.
  return { result: await runInline(structuredClone(job)), mode: 'inline' };
}

function scheduleIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (running || waiting.length || !ws) return;
    dropWorker(ws);
  }, limits.idleMs);
  idleTimer.unref?.();
}

function release(entry: Entry): void {
  const n = (perOwner.get(entry.ownerId) ?? 1) - 1;
  if (n > 0) perOwner.set(entry.ownerId, n);
  else perOwner.delete(entry.ownerId);
  if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort);
}

function pump(): void {
  if (running || waiting.length === 0) return;
  const entry = waiting.shift()!;
  running = entry;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort);
  const started = performance.now();
  execute(entry.job)
    .then(
      ({ result, mode }) => {
        const ms = performance.now() - started;
        renderCounters.jobs++;
        renderCounters.ms += ms;
        noteRenderMode(mode);
        entry.resolve(result);
        return { ms, mode };
      },
      (e) => {
        entry.reject(e);
        return null;
      }
    )
    .finally(() => {
      running = null;
      release(entry);
      if (waiting.length === 0) scheduleIdle();
      pump();
    });
}

/**
 * Queue a render. Refuses with `RenderRefused` when this container is
 * handing over (`UPDATING`), when the queue or this Owner's share of it is
 * full (`RENDER_BUSY`), when the render takes too long (`RENDER_TIMEOUT`) or
 * when the worker dies (`RENDER_FAILED`). A waiting job whose request was
 * aborted is dropped before it starts; a running one finishes.
 */
export function runRenderJob(
  job: RenderJob,
  ctx: { ownerId: string; signal?: AbortSignal }
): Promise<RenderResult> {
  if (isFenced()) return Promise.reject(new RenderRefused('UPDATING'));
  if (ctx.signal?.aborted) return Promise.reject(new RenderRefused('RENDER_FAILED', 'aborted'));
  const owned = perOwner.get(ctx.ownerId) ?? 0;
  if (owned >= limits.perOwner || (running && waiting.length >= limits.waiting)) {
    renderCounters.busy++;
    return Promise.reject(new RenderRefused('RENDER_BUSY'));
  }
  perOwner.set(ctx.ownerId, owned + 1);
  const timing = renderTimingStore.getStore();
  const accepted = trackRender(
    () =>
      new Promise<RenderResult>((resolveJob, rejectJob) => {
        const entry: Entry = {
          job,
          ownerId: ctx.ownerId,
          signal: ctx.signal,
          resolve: resolveJob,
          reject: rejectJob
        };
        if (ctx.signal) {
          entry.onAbort = () => {
            const i = waiting.indexOf(entry);
            if (i < 0) return;
            waiting.splice(i, 1);
            release(entry);
            rejectJob(new RenderRefused('RENDER_FAILED', 'aborted'));
          };
          ctx.signal.addEventListener('abort', entry.onAbort, { once: true });
        }
        waiting.push(entry);
        pump();
      })
  );
  if (!timing) return accepted;
  const started = performance.now();
  return accepted.then((r) => {
    timing.ms += performance.now() - started;
    timing.mode = effectiveRenderMode();
    return r;
  });
}

/** For `/api/health`-style checks and tests. */
export function renderQueueStatus() {
  return {
    running: running ? 1 : 0,
    waiting: waiting.length,
    worker: ws ? 'started' : 'stopped',
    mode: effectiveRenderMode(),
    unavailable
  };
}

/** Test-only. */
export function _setRenderLimitsForTests(partial: Partial<typeof DEFAULT_LIMITS>): void {
  limits = { ...limits, ...partial };
}

/** Test-only: kill the worker the way an out-of-memory exit would. */
export async function _terminateRenderWorkerForTests(): Promise<void> {
  await ws?.worker.terminate();
}

/** Test-only: stop the worker and forget every queue state. */
export async function _resetRenderQueueForTests(): Promise<void> {
  limits = { ...DEFAULT_LIMITS };
  waiting.length = 0;
  running = null;
  perOwner.clear();
  unavailable = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const state = ws;
  ws = null;
  if (state) {
    failCurrent(state, new RenderRefused('RENDER_FAILED', 'reset'));
    await state.worker.terminate().catch(() => {});
  }
}
