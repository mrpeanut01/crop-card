/**
 * NFR-06 — Web Push without a third-party SDK.
 *
 *  - VAPID (RFC 8292): an ES256 JWT signed with the server's P-256 key,
 *    sent as `Authorization: vapid t=<jwt>, k=<public key>`.
 *  - Message encryption (RFC 8291 over RFC 8188 `aes128gcm`): ephemeral
 *    ECDH P-256 against the browser's `p256dh` key, HKDF-SHA-256 keyed by
 *    the browser's `auth` secret, one AES-128-GCM record.
 *
 * Env: VAPID_PUBLIC_KEY (base64url, 65-byte uncompressed point),
 * VAPID_PRIVATE_KEY (base64url, 32-byte scalar), VAPID_SUBJECT (mailto: or
 * https: contact). Any missing/invalid value ⇒ push is disabled (no-op).
 * Generate a pair with `node scripts/gen-vapid.mjs`.
 */

import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign
} from 'node:crypto';

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function b64urlEncode(buf: Uint8Array): string {
  return Buffer.from(buf).toString('base64url');
}

export function b64urlDecode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

const P256_POINT_LENGTH = 65;
const P256_SCALAR_LENGTH = 32;

/** Parsed VAPID config, or null when push is not configured (or the key pair
 *  is malformed / mismatched — a half-configured server must not send). */
export function readVapidConfig(
  env: Record<string, string | undefined> = process.env
): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(mailto:|https:)/.test(subject)) return null;
  try {
    const pub = b64urlDecode(publicKey);
    const priv = b64urlDecode(privateKey);
    if (pub.length !== P256_POINT_LENGTH || pub[0] !== 0x04) return null;
    if (priv.length !== P256_SCALAR_LENGTH) return null;
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(priv);
    if (!ecdh.getPublicKey().equals(pub)) return null;
  } catch {
    return null;
  }
  return { publicKey, privateKey, subject };
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  let priv = ecdh.getPrivateKey();
  if (priv.length < P256_SCALAR_LENGTH) {
    priv = Buffer.concat([Buffer.alloc(P256_SCALAR_LENGTH - priv.length), priv]);
  }
  return { publicKey: b64urlEncode(ecdh.getPublicKey()), privateKey: b64urlEncode(priv) };
}

// ─── VAPID (RFC 8292) ────────────────────────────────────────────────────

const VAPID_TTL_SECONDS = 12 * 60 * 60;

export function createVapidJwt(
  audience: string,
  config: VapidConfig,
  nowMs: number = Date.now()
): string {
  const pub = b64urlDecode(config.publicKey);
  const key = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: config.privateKey,
      x: b64urlEncode(pub.subarray(1, 33)),
      y: b64urlEncode(pub.subarray(33, 65))
    },
    format: 'jwk'
  });
  const header = b64urlEncode(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(nowMs / 1000) + VAPID_TTL_SECONDS,
        sub: config.subject
      })
    )
  );
  const signingInput = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key,
    dsaEncoding: 'ieee-p1363'
  });
  return `${signingInput}.${b64urlEncode(signature)}`;
}

export function vapidAuthorizationHeader(
  endpoint: string,
  config: VapidConfig,
  nowMs: number = Date.now()
): string {
  const audience = new URL(endpoint).origin;
  return `vapid t=${createVapidJwt(audience, config, nowMs)}, k=${config.publicKey}`;
}

// ─── Payload encryption (RFC 8291 + RFC 8188 aes128gcm) ─────────────────

const RECORD_SIZE = 4096;
const TAG_LENGTH = 16;
const HEADER_LENGTH = 16 + 4 + 1 + P256_POINT_LENGTH;
/** Largest plaintext that fits one record and the 4096-byte push body cap. */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - HEADER_LENGTH - TAG_LENGTH - 1;

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** HKDF (RFC 5869) with a single expand block — every output here is ≤32 bytes. */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = hmac(salt, ikm);
  return hmac(prk, Buffer.concat([info, Buffer.from([0x01])])).subarray(0, length);
}

function deriveKeys(
  ecdhSecret: Buffer,
  authSecret: Buffer,
  uaPublic: Buffer,
  asPublic: Buffer,
  salt: Buffer
): { cek: Buffer; nonce: Buffer } {
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  return { cek, nonce };
}

export interface EncryptOptions {
  /** Test hooks: RFC 8291 §5 fixes both to reproduce its example. */
  salt?: Buffer;
  asPrivateKey?: Buffer;
}

export function encryptPayload(
  plaintext: Buffer,
  uaPublic: Buffer,
  authSecret: Buffer,
  opts: EncryptOptions = {}
): Buffer {
  if (uaPublic.length !== P256_POINT_LENGTH || uaPublic[0] !== 0x04) {
    throw new Error('invalid p256dh key');
  }
  if (authSecret.length !== 16) throw new Error('invalid auth secret');
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error('push payload too large');
  const salt = opts.salt ?? randomBytes(16);
  const ecdh = createECDH('prime256v1');
  if (opts.asPrivateKey) ecdh.setPrivateKey(opts.asPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);
  const { cek, nonce } = deriveKeys(ecdhSecret, authSecret, uaPublic, asPublic, salt);

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag()
  ]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(RECORD_SIZE, 0);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ciphertext]);
}

/** Receiver side of `encryptPayload` (what the browser does). Used by tests
 *  to prove round-trips; never on the request path. */
export function decryptPayload(body: Buffer, uaPrivate: Buffer, authSecret: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const idLen = body[20];
  const asPublic = body.subarray(21, 21 + idLen);
  const record = body.subarray(21 + idLen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(asPublic);
  const { cek, nonce } = deriveKeys(ecdhSecret, authSecret, uaPublic, asPublic, salt);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - TAG_LENGTH));
  const padded = Buffer.concat([
    decipher.update(record.subarray(0, record.length - TAG_LENGTH)),
    decipher.final()
  ]);
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (end < 0 || padded[end] !== 0x02) throw new Error('invalid record padding');
  return padded.subarray(0, end);
}

// ─── Send ────────────────────────────────────────────────────────────────

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type SendOutcome =
  | { kind: 'sent'; status: number }
  /** 404/410: the browser dropped the subscription — delete it. */
  | { kind: 'gone'; status: number }
  | { kind: 'failed'; status: number | null; message: string };

export interface SendOptions {
  fetchImpl?: typeof fetch;
  ttlSeconds?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  nowMs?: number;
}

export async function sendWebPush(
  target: PushTarget,
  payload: string,
  config: VapidConfig,
  opts: SendOptions = {}
): Promise<SendOutcome> {
  let body: Buffer;
  let authorization: string;
  try {
    const url = new URL(target.endpoint);
    if (url.protocol !== 'https:') throw new Error('push endpoint must be https');
    body = encryptPayload(
      Buffer.from(payload, 'utf-8'),
      b64urlDecode(target.p256dh),
      b64urlDecode(target.auth)
    );
    authorization = vapidAuthorizationHeader(target.endpoint, config, opts.nowMs);
  } catch (err) {
    return { kind: 'failed', status: null, message: (err as Error).message };
  }
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(target.endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(opts.ttlSeconds ?? 24 * 60 * 60),
        Urgency: opts.urgency ?? 'normal'
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(10_000)
    });
    if (res.status === 404 || res.status === 410) return { kind: 'gone', status: res.status };
    if (res.status >= 200 && res.status < 300) return { kind: 'sent', status: res.status };
    return { kind: 'failed', status: res.status, message: `push service returned ${res.status}` };
  } catch (err) {
    return { kind: 'failed', status: null, message: (err as Error).message };
  }
}
