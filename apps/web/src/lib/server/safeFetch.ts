/**
 * SSRF-hardened outbound GET for user-supplied URLs (#298).
 *
 * Every hop is validated before a socket opens: scheme must be http(s), no
 * userinfo, and EVERY address the hostname resolves to must be public
 * unicast. The connection is then pinned to the validated address (the
 * connector's `lookup` only ever returns it), so a DNS answer that changes
 * between validation and connect (rebinding) cannot redirect the socket.
 * Redirects are followed manually and re-validated per hop.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';

export type SafeFetchErrorCode =
  | 'invalid-url'
  | 'bad-scheme'
  | 'credentials'
  | 'blocked-address'
  | 'dns'
  | 'too-many-redirects'
  | 'bad-redirect'
  | 'timeout'
  | 'network';

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

/** Codes that mean "this URL is not allowed", as opposed to a transport failure. */
export const POLICY_ERROR_CODES: ReadonlySet<SafeFetchErrorCode> = new Set([
  'invalid-url',
  'bad-scheme',
  'credentials',
  'blocked-address',
  'bad-redirect'
]);

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface ConnectArgs {
  url: URL;
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  signal: AbortSignal;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  destroy(): void;
}

export type Connector = (args: ConnectArgs) => Promise<RawResponse>;

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  resolver?: Resolver;
  connector?: Connector;
}

export interface SafeFetchResponse {
  url: string;
  status: number;
  contentType: string;
  /** Reads the (decoded) body up to `maxBytes`, then stops reading. */
  readText(): Promise<{ text: string; truncated: boolean }>;
  cancel(): void;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// ─── Address classification ────────────────────────────────────────────

type Cidr = [bytes: number[], prefix: number];

function parseIPv4(s: string): number[] | null {
  if (isIP(s) !== 4) return null;
  return s.split('.').map(Number);
}

function parseIPv6(input: string): number[] | null {
  let s = input;
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (isIP(s) !== 6) return null;
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(':');
  const maybeV4 = s.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const v4 = parseIPv4(maybeV4);
    if (!v4) return null;
    tail = v4;
    s = s.slice(0, lastColon + 1) + '0:0';
  }
  const [head, rest] = s.includes('::') ? s.split('::') : [s, null];
  const toGroups = (part: string) => (part ? part.split(':').map((g) => parseInt(g, 16)) : []);
  const h = toGroups(head);
  const r = rest === null ? [] : toGroups(rest);
  const fill = rest === null ? 0 : 8 - h.length - r.length;
  const groups = [...h, ...new Array<number>(fill).fill(0), ...r];
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return null;
  const bytes = groups.flatMap((g) => [(g >> 8) & 0xff, g & 0xff]);
  if (tail.length === 4) bytes.splice(12, 4, ...tail);
  return bytes;
}

function cidr(s: string): Cidr {
  const [addr, prefix] = s.split('/');
  const bytes = parseIPv4(addr) ?? parseIPv6(addr);
  if (!bytes) throw new Error(`bad CIDR ${s}`);
  return [bytes, Number(prefix)];
}

function inCidr(bytes: number[], [net, prefix]: Cidr): boolean {
  if (bytes.length !== net.length) return false;
  let bits = prefix;
  for (let i = 0; i < bytes.length && bits > 0; i++) {
    const take = Math.min(8, bits);
    const mask = (0xff << (8 - take)) & 0xff;
    if ((bytes[i] & mask) !== (net[i] & mask)) return false;
    bits -= take;
  }
  return true;
}

const BLOCKED_V4: Cidr[] = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4'
].map(cidr);

const V6_GLOBAL_UNICAST = cidr('2000::/3');
const V6_EMBEDS_V4: Array<{ net: Cidr; offset: number }> = [
  { net: cidr('::ffff:0:0/96'), offset: 12 },
  { net: cidr('64:ff9b::/96'), offset: 12 },
  { net: cidr('2002::/16'), offset: 2 }
];
const BLOCKED_V6: Cidr[] = [
  '2001::/32',
  '2001:2::/48',
  '2001:10::/28',
  '2001:20::/28',
  '2001:db8::/32',
  '3fff::/20'
].map(cidr);

function isPublicV4(bytes: number[]): boolean {
  return !BLOCKED_V4.some((c) => inCidr(bytes, c));
}

/** True only for globally-routable unicast addresses. Anything unparseable is
 *  treated as non-public. */
export function isPublicAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return isPublicV4(v4);
  const v6 = parseIPv6(address);
  if (!v6) return false;
  for (const { net, offset } of V6_EMBEDS_V4) {
    if (inCidr(v6, net)) return isPublicV4(v6.slice(offset, offset + 4));
  }
  if (!inCidr(v6, V6_GLOBAL_UNICAST)) return false;
  return !BLOCKED_V6.some((c) => inCidr(v6, c));
}

// ─── URL validation ────────────────────────────────────────────────────

function hostOf(u: URL): string {
  return u.hostname.startsWith('[') ? u.hostname.slice(1, -1) : u.hostname;
}

/** Synchronous checks that need no DNS: scheme, userinfo, literal IPs
 *  (the WHATWG parser already canonicalises decimal/octal/hex IPv4 forms
 *  like `http://2130706433` to dotted-quad), and localhost names. */
export function assertUrlAllowed(raw: string | URL): URL {
  let u: URL;
  try {
    u = typeof raw === 'string' ? new URL(raw) : raw;
  } catch {
    throw new SafeFetchError('invalid-url', 'URL is not valid');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SafeFetchError('bad-scheme', 'URL must use http or https');
  }
  if (u.username || u.password) {
    throw new SafeFetchError('credentials', 'URL must not contain credentials');
  }
  const host = hostOf(u).toLowerCase();
  if (!host) throw new SafeFetchError('invalid-url', 'URL has no host');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new SafeFetchError('blocked-address', 'URL must be a public http(s) address');
  }
  if (isIP(host) && !isPublicAddress(host)) {
    throw new SafeFetchError('blocked-address', 'URL must be a public http(s) address');
  }
  return u;
}

const defaultResolver: Resolver = async (hostname) => dnsLookup(hostname, { all: true });

async function resolveValidated(
  u: URL,
  resolver: Resolver
): Promise<{ address: string; family: 4 | 6 }> {
  const host = hostOf(u);
  const literal = isIP(host);
  if (literal) return { address: host, family: literal as 4 | 6 };
  let addrs: ResolvedAddress[];
  try {
    addrs = await resolver(host);
  } catch (e) {
    throw new SafeFetchError(
      'dns',
      `Could not resolve ${host}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  if (addrs.length === 0) throw new SafeFetchError('dns', `Could not resolve ${host}`);
  for (const a of addrs) {
    if (!isPublicAddress(a.address)) {
      throw new SafeFetchError('blocked-address', 'URL must be a public http(s) address');
    }
  }
  const first = addrs[0];
  return { address: first.address, family: isIP(first.address) === 6 ? 6 : 4 };
}

// ─── Default transport ─────────────────────────────────────────────────

function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return ((_host: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) => {
    if (opts?.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  }) as unknown as LookupFunction;
}

function decode(res: http.IncomingMessage): Readable {
  const enc = String(res.headers['content-encoding'] ?? '')
    .trim()
    .toLowerCase();
  if (enc === 'gzip' || enc === 'x-gzip') return res.pipe(zlib.createGunzip());
  if (enc === 'deflate') return res.pipe(zlib.createInflate());
  if (enc === 'br') return res.pipe(zlib.createBrotliDecompress());
  return res;
}

export const nodeConnector: Connector = ({ url, address, family, headers, signal }) =>
  new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      {
        method: 'GET',
        headers: { 'Accept-Encoding': 'gzip, deflate, br', ...headers },
        lookup: pinnedLookup(address, family),
        signal,
        agent: false
      },
      (res) => {
        const body = decode(res);
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body,
          destroy: () => {
            body.destroy();
            res.destroy();
            req.destroy();
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });

// ─── safeFetch ─────────────────────────────────────────────────────────

function headerValue(h: RawResponse['headers'], name: string): string {
  const v = h[name] ?? h[name.toLowerCase()];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new SafeFetchError('timeout', 'Request timed out'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SafeFetchError('timeout', 'Request timed out'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(
          signal.aborted
            ? new SafeFetchError('timeout', 'Request timed out')
            : e instanceof SafeFetchError
              ? e
              : new SafeFetchError('network', e instanceof Error ? e.message : String(e))
        );
      }
    );
  });
}

export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions = {}
): Promise<SafeFetchResponse> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const resolver = opts.resolver ?? defaultResolver;
  const connector = opts.connector ?? nodeConnector;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = controller.signal;
  const done = () => clearTimeout(timer);

  try {
    let url = assertUrlAllowed(rawUrl);
    for (let hop = 0; ; hop++) {
      const { address, family } = await abortable(resolveValidated(url, resolver), signal);
      const res = await abortable(
        connector({ url, address, family, headers: { ...opts.headers }, signal }),
        signal
      );
      if (REDIRECT_STATUSES.has(res.status)) {
        res.destroy();
        const location = headerValue(res.headers, 'location');
        if (!location) throw new SafeFetchError('network', 'Redirect without a Location');
        if (hop >= maxRedirects) {
          throw new SafeFetchError('too-many-redirects', `More than ${maxRedirects} redirects`);
        }
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw new SafeFetchError('bad-redirect', 'Redirect to an invalid URL');
        }
        try {
          url = assertUrlAllowed(next);
        } catch (e) {
          if (e instanceof SafeFetchError && e.code === 'bad-scheme') {
            throw new SafeFetchError('bad-redirect', 'Redirect to a non-http(s) URL');
          }
          throw e;
        }
        continue;
      }

      const finalUrl = url.toString();
      let consumed = false;
      return {
        url: finalUrl,
        status: res.status,
        contentType: headerValue(res.headers, 'content-type'),
        cancel: () => {
          res.destroy();
          done();
        },
        readText: async () => {
          if (consumed) throw new Error('body already read');
          consumed = true;
          const decoder = new TextDecoder('utf-8');
          const it = res.body[Symbol.asyncIterator]();
          let text = '';
          let bytes = 0;
          let truncated = false;
          try {
            for (;;) {
              const { value, done: end } = await abortable(it.next(), signal);
              if (end) break;
              const room = maxBytes - bytes;
              const chunk = value.byteLength > room ? value.subarray(0, room) : value;
              bytes += chunk.byteLength;
              text += decoder.decode(chunk, { stream: true });
              if (bytes >= maxBytes) {
                truncated = true;
                break;
              }
            }
            text += decoder.decode();
            return { text, truncated };
          } finally {
            res.destroy();
            done();
          }
        }
      };
    }
  } catch (e) {
    done();
    throw e;
  }
}
