// @vitest-environment node
/**
 * Thread mode (R-05, R-10, R-11): the real worker bundle, built into a temp
 * folder under node_modules/.cache so it resolves pdfmake the way
 * `build/render-worker.mjs` does in production.
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildRenderWorker, WEB_ROOT } from '../../../../scripts/build-render-worker.mjs';
import {
  _resetRenderQueueForTests,
  _setRenderLimitsForTests,
  _terminateRenderWorkerForTests,
  effectiveRenderMode,
  renderQueueStatus,
  runRenderJob
} from './queue';
import { executeRenderJob, type RenderJob, type RenderResult } from './jobs';
import { packCsvFiles, packReadme } from '$lib/records/organicPack';
import { crc32 } from '$lib/server/zip';
import { treatmentLogDoc } from './docs/treatmentLog';
import { NOW, packData, PREFS, treatmentRows } from './__reference__/fixtures';

const dir = path.join(
  WEB_ROOT as string,
  'node_modules/.cache',
  `render-worker-test-${process.pid}`
);
const workerPath = path.join(dir, 'render-worker.mjs');
const env = { mode: process.env.RENDER_MODE, path: process.env.RENDER_WORKER_PATH };

beforeAll(async () => {
  mkdirSync(dir, { recursive: true });
  await buildRenderWorker({ outfile: workerPath });
  process.env.RENDER_MODE = 'thread';
  process.env.RENDER_WORKER_PATH = workerPath;
}, 60_000);

afterEach(async () => {
  vi.restoreAllMocks();
  await _resetRenderQueueForTests();
  process.env.RENDER_WORKER_PATH = workerPath;
});

afterAll(async () => {
  await _resetRenderQueueForTests();
  if (env.mode === undefined) delete process.env.RENDER_MODE;
  else process.env.RENDER_MODE = env.mode;
  if (env.path === undefined) delete process.env.RENDER_WORKER_PATH;
  else process.env.RENDER_WORKER_PATH = env.path;
  rmSync(dir, { recursive: true, force: true });
});

function pdfJob(rows = 40): RenderJob {
  const spec = treatmentLogDoc(treatmentRows(rows), {
    farmName: 'Hill Farm',
    from: '2026-01-01',
    to: '2026-12-31',
    footer: 'log',
    exporter: 'owner@example.com',
    prefs: PREFS,
    now: NOW
  });
  spec.doc.info = { ...spec.doc.info, creationDate: new Date(0) };
  return { kind: 'pdf', spec };
}

function bytesOf(r: RenderResult): Uint8Array {
  if (r.kind === 'organic-pack-files') throw new Error('unexpected');
  return r.bytes;
}

describe('render worker (thread mode)', () => {
  it('renders the same PDF bytes as inline mode', async () => {
    const job = pdfJob();
    const inline = bytesOf(await executeRenderJob(structuredClone(job)));
    const thread = bytesOf(await runRenderJob(job, { ownerId: 'o1' }));
    expect(effectiveRenderMode()).toBe('thread');
    expect(renderQueueStatus().worker).toBe('started');
    expect(Buffer.from(thread).equals(Buffer.from(inline))).toBe(true);
  }, 60_000);

  it('builds export.json bytes identical to JSON.stringify(value, null, 2)', async () => {
    const value = {
      when: new Date('2026-02-03T04:05:06Z'),
      skipped: undefined,
      list: [1, 'two', null, { nested: 'ñandú ✓ 🌱' }],
      quote: '"quoted"\n'
    };
    const r = await runRenderJob({ kind: 'json-bytes', value, space: 2 }, { ownerId: 'o1' });
    const expected = new TextEncoder().encode(JSON.stringify(value, null, 2));
    if (r.kind !== 'json-bytes') throw new Error('expected json-bytes');
    expect(Buffer.from(r.bytes).equals(Buffer.from(expected))).toBe(true);
    expect(r.crc32).toBe(crc32(expected));
  }, 60_000);

  it('builds the certifier pack README, summary and CSV files', async () => {
    const data = packData();
    const r = await runRenderJob(
      {
        kind: 'organic-pack-files',
        input: {
          data,
          exporter: 'owner@example.com',
          role: 'owner',
          prefs: PREFS,
          nowMs: NOW.getTime(),
          withDocuments: false
        }
      },
      { ownerId: 'o1' }
    );
    if (r.kind !== 'organic-pack-files') throw new Error('expected pack files');
    const enc = new TextEncoder();
    expect(new TextDecoder().decode(r.readme)).toBe(packReadme(data, { withDocuments: false }));
    expect(Buffer.from(r.summary.subarray(0, 5)).toString()).toBe('%PDF-');
    const csv = packCsvFiles(data);
    expect(r.csv.map((c) => c.name)).toEqual(Object.keys(csv));
    for (const file of r.csv) {
      const expected = enc.encode(csv[file.name]);
      expect(Buffer.from(file.bytes).equals(Buffer.from(expected))).toBe(true);
      expect(file.crc32).toBe(crc32(expected));
    }
  }, 60_000);

  it('passes a render error back as a rejected job and keeps the worker', async () => {
    await expect(
      runRenderJob(
        { kind: 'pdf', spec: { doc: { content: [{ image: 'https://example.com/x.png' }] } } },
        { ownerId: 'o1' }
      )
    ).rejects.toThrow(/access policy/i);
    const ok = await runRenderJob(pdfJob(2), { ownerId: 'o1' });
    expect(ok.kind).toBe('pdf');
  }, 60_000);

  it('terminates a render past the time limit and starts a fresh worker for the next', async () => {
    await runRenderJob(pdfJob(2), { ownerId: 'o1' });
    _setRenderLimitsForTests({ timeoutMs: 1 });
    await expect(runRenderJob(pdfJob(400), { ownerId: 'o1' })).rejects.toMatchObject({
      code: 'RENDER_TIMEOUT',
      status: 503
    });
    expect(renderQueueStatus().worker).toBe('stopped');
    _setRenderLimitsForTests({ timeoutMs: 120_000 });
    const next = await runRenderJob(pdfJob(2), { ownerId: 'o1' });
    expect(next.kind).toBe('pdf');
    expect(effectiveRenderMode()).toBe('thread');
  }, 60_000);

  it('answers RENDER_FAILED when the worker dies mid-render, then recovers', async () => {
    await runRenderJob(pdfJob(2), { ownerId: 'o1' });
    const running = runRenderJob(pdfJob(400), { ownerId: 'o1' });
    await new Promise((r) => setTimeout(r, 20));
    await _terminateRenderWorkerForTests();
    await expect(running).rejects.toMatchObject({ code: 'RENDER_FAILED', status: 503 });
    const next = await runRenderJob(pdfJob(2), { ownerId: 'o1' });
    expect(next.kind).toBe('pdf');
    expect(effectiveRenderMode()).toBe('thread');
  }, 60_000);

  it('stops the worker after it sits idle', async () => {
    _setRenderLimitsForTests({ idleMs: 30 });
    await runRenderJob(pdfJob(2), { ownerId: 'o1' });
    expect(renderQueueStatus().worker).toBe('started');
    await new Promise((r) => setTimeout(r, 200));
    expect(renderQueueStatus().worker).toBe('stopped');
  }, 60_000);

  it('falls back to the main thread, logging once, when the bundle is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.RENDER_WORKER_PATH = path.join(dir, 'missing.mjs');
    const a = await runRenderJob(pdfJob(2), { ownerId: 'o1' });
    const b = await runRenderJob(pdfJob(2), { ownerId: 'o1' });
    expect(a.kind).toBe('pdf');
    expect(b.kind).toBe('pdf');
    expect(effectiveRenderMode()).toBe('inline');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(
      /^\[render\] worker unavailable \(no bundle at .*missing\.mjs\); rendering on the main thread$/
    );
  }, 60_000);
});
