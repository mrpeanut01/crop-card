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
 * @param {BlobConfig} cfg
 * @param {string} method
 * @param {string} blobPath path under the container, '' for the container itself
 * @param {{ query?: Record<string, string>, headers?: Record<string, string>, body?: string }} [opts]
 * @returns {Promise<BlobResult>}
 */
async function request(cfg, method, blobPath, opts = {}) {
  const query = opts.query ?? {};
  const body = opts.body;
  const path = `/${cfg.container}${blobPath ? `/${blobPath}` : ''}`;
  /** @type {Record<string, string>} */
  const headers = {
    'x-ms-date': new Date().toUTCString(),
    'x-ms-version': API_VERSION,
    ...(opts.headers ?? {})
  };
  if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body));
  const signature = sign(
    cfg.key,
    stringToSign({ method, account: cfg.account, path, query, headers })
  );
  headers.authorization = `SharedKey ${cfg.account}:${signature}`;
  const qs = new URLSearchParams(query).toString();
  const base = cfg.endpoint ?? `https://${cfg.account}.blob.core.windows.net`;
  const doFetch = cfg.fetchImpl ?? fetch;
  const res = await doFetch(`${base}${path}${qs ? `?${qs}` : ''}`, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 10_000)
  });
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
