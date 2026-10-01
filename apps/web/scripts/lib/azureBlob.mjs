// Minimal Azure Blob REST client (Shared Key auth) for the deploy handoff
// fence and the restore guard. Shared by the container entrypoint
// (scripts/handoff.mjs) and the running app (src/lib/server/ops/handoff.ts),
// so it is plain ESM with no dependencies beyond node:crypto and fetch.

import { createHmac } from 'node:crypto';

const API_VERSION = '2021-08-06';

/**
 * @typedef {{ account: string, key: string, container: string, endpoint?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} BlobConfig
 * @typedef {{ status: number, etag: string | null, body: string | null }} BlobResult
 */

/**
 * Build the Shared Key string-to-sign for one request.
 * https://learn.microsoft.com/rest/api/storageservices/authorize-with-shared-key
 * @param {{ method: string, account: string, path: string, query: Record<string, string>, headers: Record<string, string> }} req
 */
export function stringToSign({ method, account, path, query, headers }) {
  /** @param {string} name */
  const h = (name) => headers[name] ?? headers[name.toLowerCase()] ?? '';
  const length = h('content-length');
  const canonicalHeaders = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .filter((k) => k.startsWith('x-ms-'))
    .sort()
    .map((k) => `${k}:${String(headers[k] ?? '').trim()}\n`)
    .join('');
  const canonicalQuery = Object.keys(query)
    .map((k) => k.toLowerCase())
    .sort()
    .map((k) => `\n${k}:${query[k]}`)
    .join('');
  return [
    method.toUpperCase(),
    h('content-encoding'),
    h('content-language'),
    length === '0' ? '' : length,
    h('content-md5'),
    h('content-type'),
    '',
    h('if-modified-since'),
    h('if-match'),
    h('if-none-match'),
    h('if-unmodified-since'),
    h('range'),
    `${canonicalHeaders}/${account}${path}${canonicalQuery}`
  ].join('\n');
}

/**
 * @param {string} key base64 account key
 * @param {string} toSign
 */
export function sign(key, toSign) {
  return createHmac('sha256', Buffer.from(key, 'base64')).update(toSign, 'utf8').digest('base64');
}

/**
 * Sign and send one request; the caller owns the response body.
 * @param {BlobConfig} cfg
 * @param {string} method
 * @param {string} blobPath path under the container, '' for the container itself
 * @param {{ query?: Record<string, string>, headers?: Record<string, string>, body?: string | Uint8Array, signal?: AbortSignal }} [opts]
 * @returns {Promise<Response>}
 */
async function send(cfg, method, blobPath, opts = {}) {
  const query = opts.query ?? {};
  const body = opts.body;
  const path = `/${cfg.container}${blobPath ? `/${encodeBlobPath(blobPath)}` : ''}`;
  /** @type {Record<string, string>} */
  const headers = {
    'x-ms-date': new Date().toUTCString(),
    'x-ms-version': API_VERSION,
    ...(opts.headers ?? {})
  };
  if (body !== undefined) {
    headers['content-length'] = String(
      typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength
    );
  }
  const signature = sign(
    cfg.key,
    stringToSign({ method, account: cfg.account, path, query, headers })
  );
  headers.authorization = `SharedKey ${cfg.account}:${signature}`;
  const qs = new URLSearchParams(query).toString();
  const base = cfg.endpoint ?? `https://${cfg.account}.blob.core.windows.net`;
  const doFetch = cfg.fetchImpl ?? fetch;
  return doFetch(`${base}${path}${qs ? `?${qs}` : ''}`, {
    method,
    headers,
    body: /** @type {BodyInit | undefined} */ (body),
    signal: opts.signal ?? AbortSignal.timeout(cfg.timeoutMs ?? 10_000)
  });
}

/** Blob names here are plain ASCII path segments; encode each one the same
 *  way the signature's canonical resource sees it.
 *  @param {string} p */
function encodeBlobPath(p) {
  return p
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/**
 * @param {BlobConfig} cfg
 * @param {string} method
 * @param {string} blobPath path under the container, '' for the container itself
 * @param {{ query?: Record<string, string>, headers?: Record<string, string>, body?: string }} [opts]
 * @returns {Promise<BlobResult>}
 */
async function request(cfg, method, blobPath, opts = {}) {
  const res = await send(cfg, method, blobPath, opts);
  const text = method === 'HEAD' ? null : await res.text();
  return { status: res.status, etag: res.headers.get('etag'), body: text };
}

/** @param {BlobResult} r @param {string} what */
function fail(r, what) {
  const detail = (r.body ?? '').replace(/\s+/g, ' ').slice(0, 300);
  return new Error(`blob ${what} failed: HTTP ${r.status} ${detail}`);
}

/**
 * Read a JSON blob. Null when it does not exist; throws on any other failure.
 * @param {BlobConfig} cfg
 * @param {string} blobPath
 * @returns {Promise<{ value: any, etag: string | null } | null>}
 */
export async function getJson(cfg, blobPath) {
  const r = await request(cfg, 'GET', blobPath);
  if (r.status === 404) return null;
  if (r.status !== 200) throw fail(r, `GET ${blobPath}`);
  try {
    return { value: JSON.parse(r.body ?? 'null'), etag: r.etag };
  } catch {
    return { value: null, etag: r.etag };
  }
}

/**
 * Write a JSON blob. With `ifMatch`, the write only lands if the blob is
 * still at that ETag; a lost race returns `{ ok: false, status: 412 }`.
 * @param {BlobConfig} cfg
 * @param {string} blobPath
 * @param {unknown} value
 * @param {{ ifMatch?: string | null, ifNoneMatch?: string }} [cond]
 * @returns {Promise<{ ok: boolean, status: number, etag: string | null }>}
 */
export async function putJson(cfg, blobPath, value, cond = {}) {
  /** @type {Record<string, string>} */
  const headers = { 'x-ms-blob-type': 'BlockBlob', 'content-type': 'application/json' };
  if (cond.ifMatch) headers['if-match'] = cond.ifMatch;
  if (cond.ifNoneMatch) headers['if-none-match'] = cond.ifNoneMatch;
  const r = await request(cfg, 'PUT', blobPath, { headers, body: JSON.stringify(value) });
  if (r.status === 201) return { ok: true, status: r.status, etag: r.etag };
  if (r.status === 412 || r.status === 409) return { ok: false, status: r.status, etag: null };
  throw fail(r, `PUT ${blobPath}`);
}

/**
 * Names of up to `max` blobs under `prefix`. Throws on any failure, so an
 * auth or network error is never mistaken for an empty container.
 * @param {BlobConfig} cfg
 * @param {string} prefix
 * @param {number} [max]
 * @returns {Promise<string[]>}
 */
export async function listNames(cfg, prefix, max = 5) {
  const r = await request(cfg, 'GET', '', {
    query: { comp: 'list', maxresults: String(max), prefix, restype: 'container' }
  });
  if (r.status !== 200) throw fail(r, `LIST ${prefix}`);
  return [...(r.body ?? '').matchAll(/<Name>([^<]*)<\/Name>/g)].map((m) => m[1]);
}

/** @param {NodeJS.ProcessEnv} env @returns {BlobConfig | null} */
export function configFromEnv(env) {
  const account = env.AZURE_STORAGE_ACCOUNT;
  const key = env.AZURE_STORAGE_KEY;
  const container = env.AZURE_BLOB_CONTAINER;
  if (!account || !key || !container) return null;
  return { account, key, container, endpoint: env.AZURE_BLOB_ENDPOINT || undefined };
}

// Streaming helpers for the document vault. They never read a whole file
// into memory: uploads go up in blocks and downloads come back as a stream.

export const BLOCK_BYTES = 4 * 1024 * 1024;
const BLOCK_TIMEOUT_MS = 60_000;
const GET_HEADERS_TIMEOUT_MS = 30_000;

/**
 * Block ids must all have the same length before base64, so pad the index.
 * @param {number} index
 */
export function blockId(index) {
  return Buffer.from(`block-${String(index).padStart(6, '0')}`).toString('base64');
}

/** @param {Response} res @param {string} what */
async function failRes(res, what) {
  const text = await res.text().catch(() => '');
  return fail({ status: res.status, etag: null, body: text }, what);
}

/**
 * Stage one block of a block blob (Put Block).
 * @param {BlobConfig} cfg
 * @param {string} blobPath
 * @param {string} id base64 block id from `blockId`
 * @param {Uint8Array} bytes
 */
export async function putBlock(cfg, blobPath, id, bytes) {
  const res = await send(cfg, 'PUT', blobPath, {
    query: { comp: 'block', blockid: id },
    body: bytes,
    signal: AbortSignal.timeout(BLOCK_TIMEOUT_MS)
  });
  if (res.status !== 201) throw await failRes(res, `PUT BLOCK ${blobPath}`);
  await res.body?.cancel();
}

/**
 * Commit staged blocks in order (Put Block List).
 * @param {BlobConfig} cfg
 * @param {string} blobPath
 * @param {string[]} ids
 * @param {string} contentType stored as the blob's Content-Type
 */
export async function putBlockList(cfg, blobPath, ids, contentType) {
  const xml =
    '<?xml version="1.0" encoding="utf-8"?><BlockList>' +
    ids.map((id) => `<Latest>${id}</Latest>`).join('') +
    '</BlockList>';
  const res = await send(cfg, 'PUT', blobPath, {
    query: { comp: 'blocklist' },
    headers: { 'content-type': 'application/xml', 'x-ms-blob-content-type': contentType },
    body: xml,
    signal: AbortSignal.timeout(BLOCK_TIMEOUT_MS)
  });
  if (res.status !== 201) throw await failRes(res, `PUT BLOCKLIST ${blobPath}`);
  await res.body?.cancel();
}

/**
 * Upload a whole stream as a block blob, `BLOCK_BYTES` at a time.
 * @param {BlobConfig} cfg
 * @param {string} blobPath
 * @param {AsyncIterable<Uint8Array>} chunks
 * @param {string} contentType
 * @returns {Promise<{ bytes: number, blocks: number }>}
 */
export async function putStream(cfg, blobPath, chunks, contentType) {
  /** @type {string[]} */
  const ids = [];
  let buf = new Uint8Array(BLOCK_BYTES);
  let fill = 0;
  let bytes = 0;
  const flush = async () => {
    if (fill === 0) return;
    const id = blockId(ids.length);
    await putBlock(cfg, blobPath, id, buf.subarray(0, fill));
    ids.push(id);
    buf = new Uint8Array(BLOCK_BYTES);
    fill = 0;
  };
  for await (const chunk of chunks) {
    let off = 0;
    while (off < chunk.byteLength) {
      const n = Math.min(BLOCK_BYTES - fill, chunk.byteLength - off);
      buf.set(chunk.subarray(off, off + n), fill);
      fill += n;
      off += n;
      bytes += n;
      if (fill === BLOCK_BYTES) await flush();
    }
  }
  await flush();
  await putBlockList(cfg, blobPath, ids, contentType);
  return { bytes, blocks: ids.length };
}

/**
 * Streamed Get Blob. Null when the blob does not exist.
 * @param {BlobConfig} cfg
 * @param {string} blobPath
 * @returns {Promise<{ body: ReadableStream<Uint8Array>, bytes: number, contentType: string | null } | null>}
 */
export async function getStream(cfg, blobPath) {
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new Error('blob GET timed out')),
    GET_HEADERS_TIMEOUT_MS
  );
  let res;
  try {
    res = await send(cfg, 'GET', blobPath, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (res.status !== 200 || !res.body) throw await failRes(res, `GET ${blobPath}`);
  return {
    body: res.body,
    bytes: Number(res.headers.get('content-length') ?? '0'),
    contentType: res.headers.get('content-type')
  };
}

/**
 * Delete a blob and its snapshots. A missing blob counts as deleted.
 * @param {BlobConfig} cfg
 * @param {string} blobPath
 */
export async function deleteBlob(cfg, blobPath) {
  const res = await send(cfg, 'DELETE', blobPath, {
    headers: { 'x-ms-delete-snapshots': 'include' }
  });
  await res.body?.cancel();
  if (res.status === 202 || res.status === 404) return;
  throw fail({ status: res.status, etag: null, body: '' }, `DELETE ${blobPath}`);
}

/** @param {string} s */
function xmlText(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * One page of List Blobs.
 * @param {BlobConfig} cfg
 * @param {string} prefix
 * @param {string | null} marker
 * @returns {Promise<{ blobs: { name: string, bytes: number, lastModified: number }[], next: string | null }>}
 */
export async function listPage(cfg, prefix, marker = null) {
  /** @type {Record<string, string>} */
  const query = { comp: 'list', maxresults: '5000', prefix, restype: 'container' };
  if (marker) query.marker = marker;
  const r = await request(cfg, 'GET', '', { query });
  if (r.status !== 200) throw fail(r, `LIST ${prefix}`);
  const body = r.body ?? '';
  const blobs = [...body.matchAll(/<Blob>([\s\S]*?)<\/Blob>/g)].map((m) => {
    const part = m[1];
    const name = xmlText(/<Name>([^<]*)<\/Name>/.exec(part)?.[1] ?? '');
    const bytes = Number(/<Content-Length>(\d+)<\/Content-Length>/.exec(part)?.[1] ?? '0');
    const lm = /<Last-Modified>([^<]*)<\/Last-Modified>/.exec(part)?.[1];
    return { name, bytes, lastModified: lm ? Date.parse(lm) : 0 };
  });
  const nm = /<NextMarker>([^<]*)<\/NextMarker>/.exec(body)?.[1];
  return { blobs, next: nm ? xmlText(nm) : null };
}

/**
 * Every blob under `prefix`, following NextMarker.
 * @param {BlobConfig} cfg
 * @param {string} prefix
 * @returns {AsyncGenerator<{ name: string, bytes: number, lastModified: number }>}
 */
export async function* listAll(cfg, prefix) {
  /** @type {string | null} */
  let marker = null;
  do {
    const page = await listPage(cfg, prefix, marker);
    for (const b of page.blobs) yield b;
    marker = page.next;
  } while (marker);
}
