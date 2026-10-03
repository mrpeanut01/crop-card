// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  pending: [] as Array<{
    job: unknown;
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
  }>
}));

vi.mock('./jobs', () => ({
  executeRenderJob: (job: unknown) =>
    new Promise((resolve, reject) => m.pending.push({ job, resolve, reject }))
}));

import { _fenceForTests, _resetHandoffForTests, handoffStatus } from '$lib/server/ops/handoff';
import {
  _resetRenderQueueForTests,
  _setRenderLimitsForTests,
  configuredRenderMode,
  renderQueueStatus,
  runRenderJob,
  RenderRefused
} from './queue';
import { renderCounters, runWithRenderTiming } from './metrics';
import type { RenderJob, RenderResult } from './jobs';

const job: RenderJob = { kind: 'json-bytes', value: { a: 1 }, space: 2 };
const result = (n: number): RenderResult => ({
  kind: 'json-bytes',
  bytes: new Uint8Array([n]),
  crc32: n
});
const tick = () => new Promise((r) => setTimeout(r, 0));

async function finishNext(n: number) {
  await tick();
  const p = m.pending.shift();
  if (!p) throw new Error('no job running');
  p.resolve(result(n));
  await tick();
}

beforeEach(async () => {
  m.pending.length = 0;
  await _resetRenderQueueForTests();
  _resetHandoffForTests();
  renderCounters.jobs = 0;
  renderCounters.ms = 0;
  renderCounters.busy = 0;
});

afterEach(async () => {
  vi.useRealTimers();
  await _resetRenderQueueForTests();
  _resetHandoffForTests();
});

function refusal(p: Promise<unknown>) {
  return p.then(
    () => {
      throw new Error('expected a refusal');
    },
    (e) => e as RenderRefused
  );
}

describe('render queue (R-04)', () => {
  it('runs one job at a time, in order', async () => {
    const a = runRenderJob(job, { ownerId: 'o1' });
    const b = runRenderJob(job, { ownerId: 'o2' });
    await tick();
    expect(m.pending).toHaveLength(1);
    expect(renderQueueStatus()).toMatchObject({ running: 1, waiting: 1 });
    await finishNext(1);
    expect(await a).toEqual(result(1));
    await finishNext(2);
    expect(await b).toEqual(result(2));
    expect(renderCounters.jobs).toBe(2);
  });

  it('lets 3 wait behind the running job and refuses the fifth with 429', async () => {
    const accepted = ['a', 'b', 'c', 'd'].map((o) => runRenderJob(job, { ownerId: o }));
    const e = await refusal(runRenderJob(job, { ownerId: 'e' }));
    expect(e).toBeInstanceOf(RenderRefused);
    expect(e.code).toBe('RENDER_BUSY');
    expect(e.status).toBe(429);
    expect(e.retryAfterS).toBe(15);
    expect(renderCounters.busy).toBe(1);
    for (let i = 0; i < 4; i++) await finishNext(i);
    await Promise.all(accepted);
  });

  it('holds each Owner to 2 jobs running or waiting', async () => {
    const one = runRenderJob(job, { ownerId: 'o1' });
    const two = runRenderJob(job, { ownerId: 'o1' });
    const e = await refusal(runRenderJob(job, { ownerId: 'o1' }));
    expect(e.code).toBe('RENDER_BUSY');
    const other = runRenderJob(job, { ownerId: 'o2' });
    await finishNext(1);
    await one;
    const three = runRenderJob(job, { ownerId: 'o1' });
    await finishNext(2);
    await finishNext(3);
    await finishNext(4);
    await Promise.all([two, other, three]);
  });

  it('frees the Owner slot when a job fails', async () => {
    const a = runRenderJob(job, { ownerId: 'o1' });
    const b = runRenderJob(job, { ownerId: 'o1' });
    await tick();
    m.pending.shift()!.reject(new Error('boom'));
    await expect(a).rejects.toThrow('boom');
    await finishNext(2);
    await b;
    const c = runRenderJob(job, { ownerId: 'o1' });
    await finishNext(3);
    expect(await c).toEqual(result(3));
  });

  it('drops a waiting job whose request was aborted, before it starts', async () => {
    const a = runRenderJob(job, { ownerId: 'o1' });
    const ac = new AbortController();
    const b = runRenderJob(job, { ownerId: 'o2', signal: ac.signal });
    ac.abort();
    const e = await refusal(b);
    expect(e.code).toBe('RENDER_FAILED');
    expect(renderQueueStatus().waiting).toBe(0);
    await finishNext(1);
    await a;
    await tick();
    expect(m.pending).toHaveLength(0);
  });

  it('lets a running job finish even when its request is aborted', async () => {
    const ac = new AbortController();
    const a = runRenderJob(job, { ownerId: 'o1', signal: ac.signal });
    await tick();
    ac.abort();
    await finishNext(7);
    expect(await a).toEqual(result(7));
  });

  it('refuses a job whose request is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const e = await refusal(runRenderJob(job, { ownerId: 'o1', signal: ac.signal }));
    expect(e.code).toBe('RENDER_FAILED');
    await tick();
    expect(m.pending).toHaveLength(0);
  });

  it('answers 503 RENDER_TIMEOUT when a render runs past the limit', async () => {
    _setRenderLimitsForTests({ timeoutMs: 20 });
    const e = await refusal(runRenderJob(job, { ownerId: 'o1' }));
    expect(e.code).toBe('RENDER_TIMEOUT');
    expect(e.status).toBe(503);
  });
});

describe('render queue and the handoff fence (R-12)', () => {
  it('counts a render from acceptance until its result is delivered', async () => {
    const a = runRenderJob(job, { ownerId: 'o1' });
    const b = runRenderJob(job, { ownerId: 'o2' });
    expect(handoffStatus().renders).toBe(2);
    await finishNext(1);
    await a;
    expect(handoffStatus().renders).toBe(1);
    await finishNext(2);
    await b;
    expect(handoffStatus().renders).toBe(0);
  });

  it('refuses new jobs once fenced, with the updating retry delay', async () => {
    _fenceForTests();
    const e = await refusal(runRenderJob(job, { ownerId: 'o1' }));
    expect(e.code).toBe('UPDATING');
    expect(e.status).toBe(503);
    expect(e.retryAfterS).toBe(10);
    expect(handoffStatus().renders).toBe(0);
  });

  it('lets accepted jobs finish after the fence goes up', async () => {
    const a = runRenderJob(job, { ownerId: 'o1' });
    const b = runRenderJob(job, { ownerId: 'o2' });
    _fenceForTests();
    await finishNext(1);
    await finishNext(2);
    expect(await a).toEqual(result(1));
    expect(await b).toEqual(result(2));
  });
});

describe('render mode and timing (R-10, R-13)', () => {
  it('defaults to thread in production and inline elsewhere', () => {
    expect(configuredRenderMode({ NODE_ENV: 'production' })).toBe('thread');
    expect(configuredRenderMode({ NODE_ENV: 'development' })).toBe('inline');
    expect(configuredRenderMode({ NODE_ENV: 'production', RENDER_MODE: 'inline' })).toBe('inline');
    expect(configuredRenderMode({ RENDER_MODE: 'thread' })).toBe('thread');
  });

  it('records the render time and mode on the request that asked', async () => {
    const { timing, result: p } = runWithRenderTiming(() => runRenderJob(job, { ownerId: 'o1' }));
    await finishNext(1);
    await p;
    expect(timing.mode).toBe('inline');
    expect(timing.ms).toBeGreaterThanOrEqual(0);
  });

  it('copies the job in inline mode, so data the worker could not take fails here', async () => {
    const bad = { kind: 'json-bytes', value: { f: () => 1 }, space: 2 } as RenderJob;
    await expect(runRenderJob(bad, { ownerId: 'o1' })).rejects.toThrow(/could not be cloned/);
  });
});
