// @vitest-environment node
import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_PAYLOAD_BYTES,
  b64urlDecode,
  b64urlEncode,
  createVapidJwt,
  DEFAULT_VAPID_SUBJECT,
  decryptPayload,
  encryptPayload,
  generateVapidKeys,
  readVapidConfig,
  sendWebPush,
  vapidAuthorizationHeader,
  type VapidConfig
} from './webPush';

// RFC 8291 §5 "Push Message Encryption Example" (all values base64url).
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  message:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
};

function browserKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    priv: ecdh.getPrivateKey(),
    target: {
      endpoint: 'https://push.example.net/send/abc123',
      p256dh: b64urlEncode(ecdh.getPublicKey()),
      auth: b64urlEncode(auth)
    },
    auth
  };
}

function vapid(): VapidConfig {
  return { ...generateVapidKeys(), subject: 'mailto:ops@cropcard.test' };
}

describe('RFC 8291 aes128gcm encryption', () => {
  it('reproduces the RFC 8291 §5 example byte-for-byte', () => {
    const out = encryptPayload(
      b64urlDecode(RFC.plaintext),
      b64urlDecode(RFC.uaPublic),
      b64urlDecode(RFC.authSecret),
      { salt: b64urlDecode(RFC.salt), asPrivateKey: b64urlDecode(RFC.asPrivate) }
    );
    expect(b64urlEncode(out)).toBe(RFC.message);
    expect(b64urlEncode(out.subarray(21, 86))).toBe(RFC.asPublic);
  });

  it('decrypts the RFC 8291 §5 message with the user-agent key', () => {
    const plain = decryptPayload(
      b64urlDecode(RFC.message),
      b64urlDecode(RFC.uaPrivate),
      b64urlDecode(RFC.authSecret)
    );
    expect(plain.toString('utf-8')).toBe('When I grow up, I want to be a watermelon');
  });

  it('round-trips random payloads with fresh keys and a 4096 record size', () => {
    const b = browserKeys();
    for (const size of [0, 1, 100, MAX_PAYLOAD_BYTES]) {
      const plain = randomBytes(size);
      const body = encryptPayload(plain, b64urlDecode(b.target.p256dh), b.auth);
      expect(body.readUInt32BE(16)).toBe(4096);
      expect(body[20]).toBe(65);
      expect(body.length).toBeLessThanOrEqual(4096);
      expect(decryptPayload(body, b.priv, b.auth).equals(plain)).toBe(true);
    }
  });

  it('uses a fresh salt + ephemeral key per message', () => {
    const b = browserKeys();
    const a1 = encryptPayload(Buffer.from('x'), b64urlDecode(b.target.p256dh), b.auth);
    const a2 = encryptPayload(Buffer.from('x'), b64urlDecode(b.target.p256dh), b.auth);
    expect(a1.subarray(0, 16).equals(a2.subarray(0, 16))).toBe(false);
    expect(a1.subarray(21, 86).equals(a2.subarray(21, 86))).toBe(false);
  });

  it('fails authentication with the wrong auth secret', () => {
    const b = browserKeys();
    const body = encryptPayload(Buffer.from('hi'), b64urlDecode(b.target.p256dh), b.auth);
    expect(() => decryptPayload(body, b.priv, randomBytes(16))).toThrow();
  });

  it('rejects oversize payloads and malformed keys', () => {
    const b = browserKeys();
    const pub = b64urlDecode(b.target.p256dh);
    expect(() => encryptPayload(randomBytes(MAX_PAYLOAD_BYTES + 1), pub, b.auth)).toThrow(
      /too large/
    );
    expect(() => encryptPayload(Buffer.from('x'), pub.subarray(1), b.auth)).toThrow(/p256dh/);
    expect(() => encryptPayload(Buffer.from('x'), pub, randomBytes(15))).toThrow(/auth/);
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs an ES256 JWT verifiable with the public key', () => {
    const cfg = vapid();
    const now = Date.UTC(2026, 8, 25, 12);
    const jwt = createVapidJwt('https://push.example.net', cfg, now);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(b64urlDecode(h).toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(b64urlDecode(c).toString());
    expect(claims).toEqual({
      aud: 'https://push.example.net',
      exp: Math.floor(now / 1000) + 12 * 3600,
      sub: 'mailto:ops@cropcard.test'
    });
    const pub = b64urlDecode(cfg.publicKey);
    const key = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: b64urlEncode(pub.subarray(1, 33)),
        y: b64urlEncode(pub.subarray(33))
      },
      format: 'jwk'
    });
    const sig = b64urlDecode(s);
    expect(sig.length).toBe(64);
    expect(
      verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, sig)
    ).toBe(true);
    expect(
      verify('sha256', Buffer.from(`${h}.${c}x`), { key, dsaEncoding: 'ieee-p1363' }, sig)
    ).toBe(false);
  });

  it('Authorization header uses the endpoint origin as audience', () => {
    const cfg = vapid();
    const header = vapidAuthorizationHeader('https://fcm.googleapis.com/fcm/send/xyz', cfg);
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(m).not.toBeNull();
    expect(m![2]).toBe(cfg.publicKey);
    const claims = JSON.parse(b64urlDecode(m![1].split('.')[1]).toString());
    expect(claims.aud).toBe('https://fcm.googleapis.com');
  });

  it('readVapidConfig: disabled unless all three values are present and consistent', () => {
    const cfg = vapid();
    const env = {
      VAPID_PUBLIC_KEY: cfg.publicKey,
      VAPID_PRIVATE_KEY: cfg.privateKey,
      VAPID_SUBJECT: cfg.subject
    };
    expect(readVapidConfig(env)).toEqual(cfg);
    expect(readVapidConfig({})).toBeNull();
    expect(readVapidConfig({ ...env, VAPID_PUBLIC_KEY: '' })).toBeNull();
    expect(readVapidConfig({ ...env, VAPID_PRIVATE_KEY: undefined })).toBeNull();
    expect(readVapidConfig({ ...env, VAPID_SUBJECT: 'ops@cropcard.test' })).toBeNull();
    expect(readVapidConfig({ ...env, VAPID_SUBJECT: undefined })?.subject).toBe(
      'mailto:hello@cropcard.io'
    );
    expect(readVapidConfig({ ...env, VAPID_SUBJECT: '  ' })?.subject).toBe(DEFAULT_VAPID_SUBJECT);
    expect(readVapidConfig({ ...env, VAPID_PRIVATE_KEY: vapid().privateKey })).toBeNull();
    expect(readVapidConfig({ ...env, VAPID_PUBLIC_KEY: 'not-a-key' })).toBeNull();
  });
});

describe('sendWebPush', () => {
  function fetchReturning(status: number) {
    return vi.fn(async () => new Response(null, { status }));
  }

  it('POSTs an encrypted aes128gcm body with VAPID + TTL headers', async () => {
    const b = browserKeys();
    const f = fetchReturning(201);
    const out = await sendWebPush(b.target, '{"title":"hi"}', vapid(), {
      fetchImpl: f as unknown as typeof fetch
    });
    expect(out).toEqual({ kind: 'sent', status: 201 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(b.target.endpoint);
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers.TTL).toBe(String(24 * 3600));
    expect(headers.Authorization).toMatch(/^vapid t=/);
    const plain = decryptPayload(Buffer.from(init.body as Uint8Array), b.priv, b.auth);
    expect(plain.toString()).toBe('{"title":"hi"}');
  });

  it.each([404, 410])('%i ⇒ gone', async (status) => {
    const out = await sendWebPush(browserKeys().target, 'x', vapid(), {
      fetchImpl: fetchReturning(status) as unknown as typeof fetch
    });
    expect(out.kind).toBe('gone');
  });

  it.each([400, 413, 429, 500])('%i ⇒ failed', async (status) => {
    const out = await sendWebPush(browserKeys().target, 'x', vapid(), {
      fetchImpl: fetchReturning(status) as unknown as typeof fetch
    });
    expect(out).toMatchObject({ kind: 'failed', status });
  });

  it('network error ⇒ failed, never throws', async () => {
    const f = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const out = await sendWebPush(browserKeys().target, 'x', vapid(), {
      fetchImpl: f as unknown as typeof fetch
    });
    expect(out).toMatchObject({ kind: 'failed', status: null, message: 'ECONNRESET' });
  });

  it('refuses non-https endpoints without calling fetch', async () => {
    const f = fetchReturning(201);
    const target = { ...browserKeys().target, endpoint: 'http://push.example.net/x' };
    const out = await sendWebPush(target, 'x', vapid(), {
      fetchImpl: f as unknown as typeof fetch
    });
    expect(out.kind).toBe('failed');
    expect(f).not.toHaveBeenCalled();
  });
});
