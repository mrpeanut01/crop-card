import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { loginTokens, users } from '$lib/db/schema';
import { clearOutbox, readOutbox } from './email';
import {
  MAGIC_LINK_GENERIC_MESSAGE,
  MAGIC_LINK_TTL_MS,
  MAX_PER_EMAIL,
  MAX_PER_IP,
  MAX_PER_UNATTRIBUTED,
  authMode,
  buildVerifyUrl,
  consumeMagicLink,
  handleMagicLinkRequest,
  hashLoginToken,
  ipRateBucket,
  isDirectLoginAllowed,
  magicLinkOrigin,
  normalizeLoginEmail,
  peekMagicLink,
  requestMagicLink,
  resetUnattributedWarningForTests,
  sanitizeInviteToken
} from './magicLink';

const ORIGIN = 'http://cropcard.test';

function uniqEmail(tag = 'm'): string {
  return `${tag}-${randomUUID().slice(0, 8)}@example.test`;
}

/** Random public unicast address (44.0.0.0/8 is globally routable). */
function uniqIp(): string {
  const octet = () => 1 + Math.floor(Math.random() * 254);
  return `44.${octet()}.${octet()}.${octet()}`;
}

function tokenFromOutbox(email: string): string {
  const msgs = readOutbox(email);
  const last = msgs[msgs.length - 1];
  if (last?.email.kind !== 'magic-link') throw new Error(`no magic-link mail for ${email}`);
  return new URL(last.email.loginUrl).searchParams.get('token')!;
}

async function issue(email: string, now = Date.now(), ip = uniqIp()): Promise<string> {
  const r = await requestMagicLink({ email, ip, origin: ORIGIN, now });
  expect(r.outcome).toBe('sent');
  return tokenFromOutbox(email);
}

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.EMAIL_TRANSPORT = 'memory';
  clearOutbox();
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe('authMode', () => {
  it('defaults to direct when unset', () => {
    delete process.env.AUTH_MODE;
    expect(authMode()).toBe('direct');
    expect(isDirectLoginAllowed()).toBe(true);
  });

  it('honours magic-link', () => {
    process.env.AUTH_MODE = 'magic-link';
    expect(authMode()).toBe('magic-link');
    expect(isDirectLoginAllowed()).toBe(false);
  });

  it('fails closed to magic-link on an unrecognised value', () => {
    for (const v of ['magiclink', 'DIRECTLY', 'off', 'true']) {
      process.env.AUTH_MODE = v;
      expect(authMode()).toBe('magic-link');
    }
  });

  it('is case-insensitive for direct', () => {
    process.env.AUTH_MODE = ' Direct ';
    expect(authMode()).toBe('direct');
  });
});

describe('normalizeLoginEmail', () => {
  it('trims + lowercases valid addresses', () => {
    expect(normalizeLoginEmail('  Farmer@Example.COM ')).toBe('farmer@example.com');
  });

  it('rejects malformed input', () => {
    for (const bad of [
      '',
      'nope',
      'a@b',
      'a b@c.d',
      null,
      42,
      undefined,
      `${'x'.repeat(250)}@e.co`
    ])
      expect(normalizeLoginEmail(bad)).toBeNull();
  });
});

describe('requestMagicLink — issue', () => {
  it('emails a 32-byte base64url token and stores only its SHA-256 hash', async () => {
    const email = uniqEmail();
    const token = await issue(email);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const rows = db.select().from(loginTokens).where(eq(loginTokens.email, email)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashLoginToken(token));
    expect(JSON.stringify(rows[0])).not.toContain(token);
    expect(rows[0].expiresAt.getTime() - rows[0].createdAt.getTime()).toBe(MAGIC_LINK_TTL_MS);
    expect(rows[0].ipHash).toMatch(/^[0-9a-f]{64}$/);

    const mail = readOutbox(email)[0];
    expect(mail.subject).toMatch(/sign-in code is \d{6}$/);
    expect(mail.body).toContain(`${ORIGIN}/auth/verify?token=`);
  });

  it('mints a distinct token per request', async () => {
    const email = uniqEmail();
    const a = await issue(email);
    const b = await issue(email);
    expect(a).not.toBe(b);
  });

  it('does not create a users row (identity is proven only on redemption)', async () => {
    const email = uniqEmail('ghost');
    await issue(email);
    expect(db.select().from(users).where(eq(users.email, email)).get()).toBeUndefined();
  });

  it('threads a sanitized invite token into the link', () => {
    const url = buildVerifyUrl(ORIGIN, 'tok', 'inv_ABCDEFGHIJKLMNOP');
    expect(new URL(url).searchParams.get('invite')).toBe('inv_ABCDEFGHIJKLMNOP');
    expect(sanitizeInviteToken('../../etc')).toBeNull();
    expect(sanitizeInviteToken('short')).toBeNull();
    expect(sanitizeInviteToken(42)).toBeNull();
  });
});

describe('peek / consume', () => {
  it('peek does not consume; consume succeeds exactly once and is bound to the email', async () => {
    const email = uniqEmail();
    const token = await issue(email);
    expect(peekMagicLink(token)).toEqual({ ok: true, email });
    expect(peekMagicLink(token)).toEqual({ ok: true, email });
    expect(consumeMagicLink(token)).toEqual({ ok: true, email });
    expect(consumeMagicLink(token)).toEqual({ ok: false, reason: 'used' });
    expect(peekMagicLink(token)).toEqual({ ok: false, reason: 'used' });
  });

  it('expires after 15 minutes', async () => {
    const email = uniqEmail();
    const t0 = Date.now();
    const token = await issue(email, t0);
    expect(peekMagicLink(token, t0 + MAGIC_LINK_TTL_MS - 1).ok).toBe(true);
    expect(consumeMagicLink(token, t0 + MAGIC_LINK_TTL_MS)).toEqual({
      ok: false,
      reason: 'expired'
    });
    expect(consumeMagicLink(token, t0 + MAGIC_LINK_TTL_MS + 60_000)).toEqual({
      ok: false,
      reason: 'expired'
    });
  });

  it('rejects unknown, malformed and non-string tokens', () => {
    for (const bad of [undefined, null, '', 'short', 'x'.repeat(500), 123, 'A'.repeat(43)]) {
      expect(consumeMagicLink(bad).ok).toBe(false);
      expect(peekMagicLink(bad).ok).toBe(false);
    }
  });

  it('a token for one email never redeems as another', async () => {
    const a = uniqEmail('a');
    const b = uniqEmail('b');
    const ta = await issue(a);
    await issue(b);
    expect(consumeMagicLink(ta)).toEqual({ ok: true, email: a });
  });
});

describe('rate limits', () => {
  it(`allows ${MAX_PER_EMAIL} links per email per window, then silently drops`, async () => {
    const email = uniqEmail('rl');
    const now = Date.now();
    for (let i = 0; i < MAX_PER_EMAIL; i++) {
      const r = await requestMagicLink({ email, ip: uniqIp(), origin: ORIGIN, now: now + i });
      expect(r.outcome).toBe('sent');
    }
    const blocked = await requestMagicLink({ email, ip: uniqIp(), origin: ORIGIN, now: now + 10 });
    expect(blocked.outcome).toBe('rate-limited');
    expect(readOutbox(email)).toHaveLength(MAX_PER_EMAIL);
    expect(db.select().from(loginTokens).where(eq(loginTokens.email, email)).all()).toHaveLength(
      MAX_PER_EMAIL
    );

    const later = await requestMagicLink({
      email,
      ip: uniqIp(),
      origin: ORIGIN,
      now: now + 16 * 60 * 1000
    });
    expect(later.outcome).toBe('sent');
  });

  it(`allows ${MAX_PER_IP} links per IP per window across different emails`, async () => {
    const ip = uniqIp();
    const now = Date.now();
    for (let i = 0; i < MAX_PER_IP; i++) {
      const r = await requestMagicLink({ email: uniqEmail('ip'), ip, origin: ORIGIN, now });
      expect(r.outcome).toBe('sent');
    }
    const fresh = uniqEmail('ip-blocked');
    const blocked = await requestMagicLink({ email: fresh, ip, origin: ORIGIN, now });
    expect(blocked.outcome).toBe('rate-limited');
    expect(readOutbox(fresh)).toHaveLength(0);
  });
});

describe('magicLinkOrigin', () => {
  it('prefers the configured ORIGIN over the request host', () => {
    process.env.ORIGIN = 'https://app.cropcard.farm/';
    expect(magicLinkOrigin('https://evil.example')).toBe('https://app.cropcard.farm');
  });

  it('falls back to the request origin outside production', () => {
    delete process.env.ORIGIN;
    process.env.NODE_ENV = 'test';
    expect(magicLinkOrigin('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('refuses to derive the link host from the request in production', () => {
    delete process.env.ORIGIN;
    process.env.NODE_ENV = 'production';
    expect(() => magicLinkOrigin('https://evil.example')).toThrow(/ORIGIN/);
  });
});

function fakeEvent(ip: string): RequestEvent {
  return {
    url: new URL(`${ORIGIN}/api/auth/magic-link`),
    getClientAddress: () => ip
  } as unknown as RequestEvent;
}

describe('handleMagicLinkRequest — no enumeration', () => {
  it('returns the identical generic result for known, unknown and throttled emails', async () => {
    const known = uniqEmail('known');
    db.insert(users)
      .values({ id: `user_${randomUUID()}`, email: known })
      .run();
    const unknown = uniqEmail('unknown');
    const throttled = uniqEmail('throttled');
    const now = Date.now();
    for (let i = 0; i < MAX_PER_EMAIL; i++) {
      await requestMagicLink({ email: throttled, ip: uniqIp(), origin: ORIGIN, now });
    }

    const results = [
      await handleMagicLinkRequest(fakeEvent(uniqIp()), known, null),
      await handleMagicLinkRequest(fakeEvent(uniqIp()), unknown, null),
      await handleMagicLinkRequest(fakeEvent(uniqIp()), throttled, null)
    ];
    for (const r of results) expect(r).toEqual({ ok: true, message: MAGIC_LINK_GENERIC_MESSAGE });
  });

  it('400s only on a malformed address', async () => {
    const r = await handleMagicLinkRequest(fakeEvent(uniqIp()), 'not-an-email', null);
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('503s (not 200) when the transport fails, without revealing account state', async () => {
    process.env.EMAIL_TRANSPORT = 'postmark';
    delete process.env.POSTMARK_TOKEN;
    const r = await handleMagicLinkRequest(fakeEvent(uniqIp()), uniqEmail(), null);
    expect(r).toMatchObject({ ok: false, status: 503 });
  });

  it('tolerates a runtime without a client address', async () => {
    const event = {
      url: new URL(`${ORIGIN}/`),
      getClientAddress: () => {
        throw new Error('no address');
      }
    } as unknown as RequestEvent;
    const email = uniqEmail();
    expect((await handleMagicLinkRequest(event, email, null)).ok).toBe(true);
    const row = db.select().from(loginTokens).where(eq(loginTokens.email, email)).get();
    expect(row?.ipHash).toBe(createHash('sha256').update('ip:unattributed').digest('hex'));
  });
});

// The shared bucket is global to the test DB (other files write to it), so
// these tests run in their own past window — counts only span [now - window, now].
describe('client address resolution + proxy-safe per-IP limit', () => {
  it('gives a public client address its own bucket', () => {
    expect(ipRateBucket('44.1.2.3')).toEqual({
      key: 'ip:44.1.2.3',
      max: MAX_PER_IP,
      attributed: true
    });
    expect(ipRateBucket('2600:1f18::1')).toMatchObject({ attributed: true, max: MAX_PER_IP });
  });

  it('routes proxy / private / loopback / missing / garbage addresses to the shared bucket', () => {
    for (const ip of [
      '10.0.0.4',
      '172.16.8.1',
      '192.168.1.10',
      '100.64.0.9',
      '127.0.0.1',
      '::1',
      'fd00::1',
      '::ffff:10.0.0.4',
      'not-an-ip',
      '',
      null
    ]) {
      expect(ipRateBucket(ip)).toMatchObject({
        key: 'ip:unattributed',
        max: MAX_PER_UNATTRIBUTED,
        attributed: false
      });
    }
  });

  it('a request behind an unconfigured proxy does not lock out other users after MAX_PER_IP', async () => {
    const proxyIp = '10.244.0.1';
    const now = Date.now() - 3 * 60 * 60 * 1000;
    for (let i = 0; i < MAX_PER_IP + 5; i++) {
      const r = await requestMagicLink({
        email: uniqEmail('proxy'),
        ip: proxyIp,
        origin: ORIGIN,
        now
      });
      expect(r.outcome).toBe('sent');
    }
  });

  it('the shared bucket still caps mass mailing at MAX_PER_UNATTRIBUTED', async () => {
    const now = Date.now() - 6 * 60 * 60 * 1000;
    for (let i = 0; i < MAX_PER_UNATTRIBUTED; i++) {
      const r = await requestMagicLink({
        email: uniqEmail('bulk'),
        ip: '10.244.0.1',
        origin: ORIGIN,
        now
      });
      expect(r.outcome).toBe('sent');
    }
    const blocked = await requestMagicLink({
      email: uniqEmail('bulk'),
      ip: null,
      origin: ORIGIN,
      now
    });
    expect(blocked.outcome).toBe('rate-limited');
    const publicIp = await requestMagicLink({
      email: uniqEmail('pub'),
      ip: uniqIp(),
      origin: ORIGIN,
      now
    });
    expect(publicIp.outcome).toBe('sent');
  });

  it('keys the per-IP limit on the address adapter-node resolves via getClientAddress', async () => {
    const clientIp = uniqIp();
    const now = Date.now();
    for (let i = 0; i < MAX_PER_IP; i++) {
      await requestMagicLink({ email: uniqEmail('xff'), ip: clientIp, origin: ORIGIN, now });
    }
    const email = uniqEmail('xff-blocked');
    const r = await handleMagicLinkRequest(fakeEvent(clientIp), email, null);
    expect(r.ok).toBe(true);
    expect(readOutbox(email)).toHaveLength(0);
    const other = uniqEmail('xff-other');
    await handleMagicLinkRequest(fakeEvent(uniqIp()), other, null);
    expect(readOutbox(other)).toHaveLength(1);
  });

  it('warns once in production when the address is not public', async () => {
    process.env.NODE_ENV = 'production';
    process.env.E2E_OUTBOX = '1';
    resetUnattributedWarningForTests();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await requestMagicLink({
      email: uniqEmail('w'),
      ip: '10.0.0.1',
      origin: ORIGIN,
      now: Date.now() - 9 * 60 * 60 * 1000
    });
    await requestMagicLink({
      email: uniqEmail('w'),
      ip: '10.0.0.1',
      origin: ORIGIN,
      now: Date.now() - 9 * 60 * 60 * 1000
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/ADDRESS_HEADER=X-Forwarded-For/);
    warn.mockRestore();
  });
});
