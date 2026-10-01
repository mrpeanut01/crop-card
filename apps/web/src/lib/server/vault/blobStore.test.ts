// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  BLOCK_BYTES,
  blockId,
  deleteBlob,
  getStream,
  listPage,
  type BlobConfig
} from '../../../../scripts/lib/azureBlob.mjs';
import { blobVaultStore } from './blobStore';

const KEY = Buffer.from('not-a-real-key-not-a-real-key!!!').toString('base64');

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  bodyBytes: number;
}

/** A tiny in-memory Blob service: staged blocks, committed blobs, list with
 *  marker paging (page size 2), deletes. */
function fakeAzure(pageSize = 2) {
  const staged = new Map<string, Map<string, Uint8Array>>();
  const blobs = new Map<string, { data: Uint8Array; type: string; modified: number }>();
  const calls: Call[] = [];
  const impl = (async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const headers = init.headers as Record<string, string>;
    const body =
      init.body === undefined
        ? new Uint8Array(0)
        : typeof init.body === 'string'
          ? new TextEncoder().encode(init.body)
          : new Uint8Array(init.body as ArrayBuffer);
    calls.push({ method: init.method!, url, headers, bodyBytes: body.length });
    expect(headers.authorization).toMatch(/^SharedKey acct:/);
    const [, container, ...rest] = url.pathname.split('/');
    expect(container).toBe('documents');
    const name = decodeURIComponent(rest.join('/'));
    const q = url.searchParams;
    if (init.method === 'PUT' && q.get('comp') === 'block') {
      const m = staged.get(name) ?? new Map();
      m.set(q.get('blockid')!, body);
      staged.set(name, m);
      return new Response(null, { status: 201 });
    }
    if (init.method === 'PUT' && q.get('comp') === 'blocklist') {
      const xml = new TextDecoder().decode(body);
      const ids = [...xml.matchAll(/<Latest>([^<]*)<\/Latest>/g)].map((m) => m[1]);
      const m = staged.get(name) ?? new Map();
      const parts = ids.map((id) => {
        const b = m.get(id);
        if (!b) throw new Error('missing block');
        return b;
      });
      blobs.set(name, {
        data: Buffer.concat(parts),
        type: headers['x-ms-blob-content-type'],
        modified: Date.now()
      });
      staged.delete(name);
      return new Response(null, { status: 201 });
    }
    if (init.method === 'GET' && q.get('comp') === 'list') {
      const prefix = q.get('prefix') ?? '';
      const names = [...blobs.keys()].filter((n) => n.startsWith(prefix)).sort();
      const start = q.get('marker') ? names.indexOf(q.get('marker')!) : 0;
      const page = names.slice(start, start + pageSize);
      const next = names[start + pageSize];
      const xml =
        '<?xml version="1.0"?><EnumerationResults><Blobs>' +
        page
          .map(
            (n) =>
              `<Blob><Name>${n}</Name><Properties><Last-Modified>${new Date(blobs.get(n)!.modified).toUTCString()}</Last-Modified><Content-Length>${blobs.get(n)!.data.length}</Content-Length></Properties></Blob>`
          )
          .join('') +
        `</Blobs><NextMarker>${next ?? ''}</NextMarker></EnumerationResults>`;
      return new Response(xml, { status: 200 });
    }
    if (init.method === 'GET') {
      const b = blobs.get(name);
      if (!b) return new Response('nope', { status: 404 });
      return new Response(b.data as unknown as BodyInit, {
        status: 200,
        headers: { 'content-length': String(b.data.length), 'content-type': b.type }
      });
    }
    if (init.method === 'DELETE') {
      expect(headers['x-ms-delete-snapshots']).toBe('include');
      return new Response(null, { status: blobs.delete(name) ? 202 : 404 });
    }
    return new Response('bad', { status: 400 });
  }) as unknown as typeof fetch;
  const cfg: BlobConfig = { account: 'acct', key: KEY, container: 'documents', fetchImpl: impl };
  return { cfg, calls, blobs };
}

const key = (o = 'owner_a') => `owners/${o}/${randomUUID()}`;

describe('azureBlob streaming helpers', () => {
  it('gives every block id the same length', () => {
    const lens = new Set([0, 9, 10, 999, 123456].map((i) => blockId(i).length));
    expect(lens.size).toBe(1);
  });

  it('streams an upload in 4 MB blocks and commits them in order', async () => {
    const az = fakeAzure();
    const store = blobVaultStore(az.cfg);
    const size = 2 * BLOCK_BYTES + 12345;
    const src = new Uint8Array(size);
    for (let i = 0; i < size; i++) src[i] = (i * 7) & 0xff;
    const k = key();
    async function* odd() {
      for (let i = 0; i < size; i += 1_000_003) yield src.subarray(i, i + 1_000_003);
    }
    const r = await store.put(k, odd(), { contentType: 'application/pdf' });
    expect(r.bytes).toBe(size);
    const blocks = az.calls.filter((c) => c.url.searchParams.get('comp') === 'block');
    expect(blocks.map((c) => c.bodyBytes)).toEqual([BLOCK_BYTES, BLOCK_BYTES, 12345]);
    const commit = az.calls.find((c) => c.url.searchParams.get('comp') === 'blocklist')!;
    expect(commit.headers['x-ms-blob-content-type']).toBe('application/pdf');
    expect(Buffer.compare(Buffer.from(az.blobs.get(k)!.data), Buffer.from(src))).toBe(0);
  });

  it('streams a download and answers null for a missing blob', async () => {
    const az = fakeAzure();
    const store = blobVaultStore(az.cfg);
    const k = key();
    await store.put(k, new TextEncoder().encode('lab report'), { contentType: 'application/pdf' });
    const got = await store.get(k);
    expect(got?.bytes).toBe(10);
    expect(await new Response(got!.body).text()).toBe('lab report');
    expect(await store.get(key())).toBeNull();
    expect(await getStream(az.cfg, 'owners/x/none')).toBeNull();
  });

  it('deletes idempotently, including snapshots', async () => {
    const az = fakeAzure();
    const store = blobVaultStore(az.cfg);
    const k = key();
    await store.put(k, new TextEncoder().encode('x'), { contentType: 'application/pdf' });
    await store.delete(k);
    await store.delete(k);
    await deleteBlob(az.cfg, k);
    expect(az.blobs.has(k)).toBe(false);
  });

  it('pages through every match with NextMarker', async () => {
    const az = fakeAzure(2);
    const store = blobVaultStore(az.cfg);
    const keys = [key(), key(), key(), key(), key()];
    for (const k of keys) await store.put(k, new TextEncoder().encode(k), { contentType: 'x' });
    await store.put(key('owner_b'), new TextEncoder().encode('b'), { contentType: 'x' });
    const listed: string[] = [];
    for await (const o of store.list('owners/owner_a/')) listed.push(o.key);
    expect(listed.sort()).toEqual([...keys].sort());
    const first = await listPage(az.cfg, 'owners/owner_a/');
    expect(first.blobs.length).toBe(2);
    expect(first.next).not.toBeNull();
  });

  it('deletePrefix removes only the matching Owner and honours keep', async () => {
    const az = fakeAzure(2);
    const store = blobVaultStore(az.cfg);
    const a1 = key();
    const a2 = key();
    const b = key('owner_b');
    for (const k of [a1, a2, b])
      await store.put(k, new TextEncoder().encode(k), { contentType: 'x' });
    expect(await store.deletePrefix('owners/owner_a/', { keep: (k) => k === a2 })).toBe(1);
    expect(az.blobs.has(a1)).toBe(false);
    expect(az.blobs.has(a2)).toBe(true);
    expect(az.blobs.has(b)).toBe(true);
    expect(await store.deletePrefix('owners/owner_a/', { modifiedBefore: 0 })).toBe(0);
  });

  it('refuses bad keys before any request', async () => {
    const az = fakeAzure();
    const store = blobVaultStore(az.cfg);
    await expect(
      store.put('owners/a/../x', new Uint8Array(1), { contentType: 'x' })
    ).rejects.toThrow();
    await expect(store.get('documents/x')).rejects.toThrow();
    expect(az.calls).toEqual([]);
  });

  it('throws on an unexpected status instead of reporting success', async () => {
    const cfg: BlobConfig = {
      account: 'acct',
      key: KEY,
      container: 'documents',
      fetchImpl: (async () => new Response('denied', { status: 403 })) as unknown as typeof fetch
    };
    const store = blobVaultStore(cfg);
    await expect(store.put(key(), new Uint8Array(3), { contentType: 'x' })).rejects.toThrow(/403/);
    await expect(store.get(key())).rejects.toThrow(/403/);
    await expect(store.delete(key())).rejects.toThrow(/403/);
  });
});
