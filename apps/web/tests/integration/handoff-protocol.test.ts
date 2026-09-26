// @vitest-environment node
/**
 * The whole deploy handoff against an in-memory Blob endpoint: a serving app
 * (the watcher in lib/server/ops/handoff.ts) and a booting container
 * (scripts/handoff.mjs acquire, run as a real child process) agree that the
 * old one fences writes, proves the replica caught up, and releases before
 * the new one is allowed to restore.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db/client', () => ({ setDbReadOnly: vi.fn(() => 4096) }));

import { setDbReadOnly } from '$lib/db/client';
import {
  _resetHandoffForTests,
  handoffStatus,
  isFenced,
  startHandoffWatcher
} from '../../src/lib/server/ops/handoff';

const blobs = new Map<string, { body: string; etag: string }>();
let etagSeq = 0;
let syncCount = 100;

function listen(server: Server): Promise<string> {
  return new Promise((r) =>
    server.listen(0, '127.0.0.1', () =>
      r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    )
  );
}

const blobServer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const key = url.pathname.replace(/^\/cropcard\/?/, '');
  if (req.method === 'GET' && url.searchParams.get('comp') === 'list') {
    const prefix = url.searchParams.get('prefix') ?? '';
    const names = [...blobs.keys()].filter((k) => k.startsWith(prefix));
    res.end(
      `<EnumerationResults><Blobs>${names.map((n) => `<Blob><Name>${n}</Name></Blob>`).join('')}</Blobs></EnumerationResults>`
    );
    return;
  }
  if (req.method === 'GET') {
    const b = blobs.get(key);
    if (!b) return void res.writeHead(404).end();
    res.writeHead(200, { etag: b.etag }).end(b.body);
    return;
  }
  if (req.method === 'PUT') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const cur = blobs.get(key);
      const ifMatch = req.headers['if-match'];
      if (ifMatch && cur?.etag !== ifMatch) return void res.writeHead(412).end();
      if (req.headers['if-none-match'] === '*' && cur) return void res.writeHead(409).end();
      const etag = `"${++etagSeq}"`;
      blobs.set(key, { body, etag });
      res.writeHead(201, { etag }).end();
    });
    return;
  }
  res.writeHead(405).end();
});

const metricsServer = createServer((_req, res) => {
  syncCount++;
  res.end(
    [
      `litestream_sync_count{db="${'__DB__'}"} ${syncCount}`,
      `litestream_replica_wal_index{db="__DB__",name="abs"} 3`,
      `litestream_replica_wal_offset{db="__DB__",name="abs"} ${32 + 4120 * 5}`
    ]
      .join('\n')
      .replaceAll('__DB__', dbPath)
  );
});

let dir = '';
let dbPath = '';
let blobUrl = '';
let metricsUrl = '';

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'handoff-e2e-'));
  dbPath = path.join(dir, 'cropcard.db');
  const wal = path.join(dir, '.cropcard.db-litestream', 'generations', 'g1', 'wal');
  await mkdir(wal, { recursive: true });
  await writeFile(path.join(dir, '.cropcard.db-litestream', 'generation'), 'g1');
  await writeFile(path.join(wal, '00000003.wal'), Buffer.alloc(32 + 4120 * 5));
  blobUrl = await listen(blobServer);
  metricsUrl = `${await listen(metricsServer)}/metrics`;
});

afterAll(async () => {
  _resetHandoffForTests();
  blobServer.close();
  metricsServer.close();
  await rm(dir, { recursive: true, force: true });
});

const storage = () => ({
  AZURE_STORAGE_ACCOUNT: 'acct',
  AZURE_STORAGE_KEY: Buffer.from('k').toString('base64'),
  AZURE_BLOB_CONTAINER: 'cropcard',
  AZURE_BLOB_ENDPOINT: blobUrl
});

function runHandoff(
  cmd: 'acquire' | 'verify-restore',
  extra: Record<string, string> = {}
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/handoff.mjs', cmd], {
      cwd: path.resolve(__dirname, '../..'),
      env: {
        PATH: process.env.PATH,
        ...storage(),
        CONTAINER_APP_REVISION: 'rev-new',
        HANDOFF_TIMEOUT_MS: '30000',
        ...extra
      }
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}

const runAcquire = (nonce: string) => runHandoff('acquire', { HANDOFF_NONCE: nonce });

describe('deploy handoff, old writer to new container', () => {
  it('a cold start with no writer on record proceeds at once', async () => {
    const r = await runAcquire('cold');
    expect(r.code).toBe(0);
    expect(r.out).toContain('no previous writer on record');
  });

  it('the new container waits until the old one has fenced and proven its last frame', async () => {
    blobs.delete('_ops/handoff/request.json');
    startHandoffWatcher({
      ...storage(),
      HANDOFF_FENCE: '1',
      HANDOFF_NONCE: 'old',
      CONTAINER_APP_REVISION: 'rev-old',
      DATABASE_URL: `file:${dbPath}`,
      LITESTREAM_METRICS_URL: metricsUrl
    });
    await vi.waitFor(() => expect(blobs.get('_ops/handoff/holder.json')).toBeTruthy());
    expect(JSON.parse(blobs.get('_ops/handoff/holder.json')!.body)).toMatchObject({
      nonce: 'old',
      state: 'serving'
    });

    const r = await runAcquire('new');
    expect(r.code).toBe(0);
    expect(r.out).toContain('waiting for rev-old');
    expect(r.out).toContain('previous writer rev-old released');
    expect(r.out).toContain('verified=true');

    expect(isFenced()).toBe(true);
    expect(handoffStatus().phase).toBe('released');
    expect(setDbReadOnly).toHaveBeenCalled();
    expect(JSON.parse(blobs.get('_ops/handoff/holder.json')!.body)).toMatchObject({
      state: 'released',
      releasedTo: 'new',
      verified: true,
      position: { generation: 'g1', index: 3, offset: 32 + 4120 * 5 }
    });
  }, 40_000);
});

describe('restore guard (verify-restore)', () => {
  const restored = () => path.join(dir, 'restored.db');

  it('boots an empty database only when the replica never had one', async () => {
    const r = await runHandoff('verify-restore', {
      DB_PATH: restored(),
      LITESTREAM_REPLICA_PATH: 'cropcard.db'
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain('first boot');
    expect(blobs.has('_ops/initialized.json')).toBe(false);
  });

  it('refuses to serve when the replica has generations but nothing was restored', async () => {
    blobs.set('cropcard.db/generations/g1/snapshots/00000000.snapshot.lz4', {
      body: '',
      etag: '"s"'
    });
    const r = await runHandoff('verify-restore', {
      DB_PATH: restored(),
      LITESTREAM_REPLICA_PATH: 'cropcard.db'
    });
    expect(r.code).toBe(3);
    expect(r.out).toContain('RESTORE_REFUSED');
  });

  it('accepts a sane restore, marks the replica initialized, and refuses zero owners', async () => {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(restored());
    db.exec(
      'CREATE TABLE __drizzle_migrations (id INTEGER); INSERT INTO __drizzle_migrations VALUES (1); CREATE TABLE owners (id TEXT);'
    );
    let r = await runHandoff('verify-restore', {
      DB_PATH: restored(),
      LITESTREAM_REPLICA_PATH: 'cropcard.db'
    });
    expect(r.code).toBe(3);
    expect(r.out).toContain('zero owners');
    db.exec("INSERT INTO owners VALUES ('owner_home_farm')");
    db.close();
    r = await runHandoff('verify-restore', {
      DB_PATH: restored(),
      LITESTREAM_REPLICA_PATH: 'cropcard.db'
    });
    expect(r.code).toBe(0);
    expect(blobs.has('_ops/initialized.json')).toBe(true);
  });

  it('fails closed when the store cannot be reached', async () => {
    const r = await runHandoff('verify-restore', {
      DB_PATH: restored(),
      LITESTREAM_REPLICA_PATH: 'cropcard.db',
      AZURE_BLOB_ENDPOINT: 'http://127.0.0.1:9'
    });
    expect(r.code).toBe(1);
  });
});
