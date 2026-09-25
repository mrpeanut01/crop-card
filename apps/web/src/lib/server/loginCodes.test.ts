import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { loginCodes, users } from '$lib/db/schema';
import { loginByIdentity } from './auth';
import { clearOutbox, readOutbox } from './email';
import {
  MAX_ATTEMPTS,
  MAX_PER_DESTINATION,
  SMS_CODE_TTL_MS,
  normalizeCode,
  redeemCode,
  redeemLinkCode,
  requestLinkCode,
  requestSmsLogin,
  unlinkIdentity
} from './loginCodes';
import {
  consumeMagicLink,
  handleLoginRequest,
  redeemLoginCode,
  requestMagicLink
} from './magicLink';
import { readSession } from './session';
import { clearSmsOutbox, readSmsOutbox } from './sms';

const ORIGIN = 'http://cropcard.test';
const IP = { hash: 'test-ip', max: 1000 };

function uniqPhone(): string {
  const n = () => Math.floor(Math.random() * 10);
  return `+1571555${n()}${n()}${n()}${n()}`.slice(0, 12);
}
function uniqEmail(): string {
  return `c-${randomUUID().slice(0, 8)}@example.test`;
}
function uniqIp(): string {
  const o = () => 1 + Math.floor(Math.random() * 254);
  return `44.${o()}.${o()}.${o()}`;
}

function lastSmsCode(phone: string): string {
  const msgs = readSmsOutbox(phone);
  const m = /^(\d{6}) /.exec(msgs[msgs.length - 1]?.body ?? '');
  if (!m) throw new Error(`no code texted to ${phone}`);
  return m[1];
}

function lastEmail(email: string) {
  const msgs = readOutbox(email);
  return msgs[msgs.length - 1]?.email;
}

function fakeEvent(ip = uniqIp()): RequestEvent {
  const jar = new Map<string, string>();
  return {
    url: new URL(`${ORIGIN}/`),
    getClientAddress: () => ip,
    cookies: {
      get: (k: string) => jar.get(k),
      set: (k: string, v: string) => void jar.set(k, v),
      delete: (k: string) => void jar.delete(k)
    }
  } as unknown as RequestEvent;
}

function wrongCode(code: string): string {
  return code === '000000' ? '000001' : '000000';
}

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.EMAIL_TRANSPORT = 'memory';
  process.env.SMS_TRANSPORT = 'memory';
  clearOutbox();
  clearSmsOutbox();
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe('normalizeCode', () => {
  it('accepts spaced or dashed six-digit codes only', () => {
    expect(normalizeCode('123 456')).toBe('123456');
    expect(normalizeCode('123-456')).toBe('123456');
    expect(normalizeCode('12345')).toBeNull();
    expect(normalizeCode('12345a')).toBeNull();
    expect(normalizeCode(123456)).toBeNull();
  });
});

describe('SMS sign-in', () => {
  it('texts a code with a web-OTP autofill line and stores only its HMAC', async () => {
    const phone = uniqPhone();
    expect((await requestSmsLogin({ phone, ip: IP, origin: ORIGIN })).outcome).toBe('sent');
    const code = lastSmsCode(phone);
    expect(readSmsOutbox(phone).at(-1)?.body).toContain(`@cropcard.test #${code}`);
    const row = db.select().from(loginCodes).where(eq(loginCodes.destination, phone)).get();
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.codeHash).not.toContain(code);
  });

  it('redeems once, then the code is spent', async () => {
    const phone = uniqPhone();
    await requestSmsLogin({ phone, ip: IP, origin: ORIGIN });
    const code = lastSmsCode(phone);
    expect(redeemCode({ destination: phone, purpose: 'login', code })).toMatchObject({ ok: true });
    expect(redeemCode({ destination: phone, purpose: 'login', code })).toEqual({
      ok: false,
      reason: 'invalid'
    });
  });

  it(`locks the code after ${MAX_ATTEMPTS} wrong guesses, even for the right code`, async () => {
    const phone = uniqPhone();
    await requestSmsLogin({ phone, ip: IP, origin: ORIGIN });
    const code = lastSmsCode(phone);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(redeemCode({ destination: phone, purpose: 'login', code: wrongCode(code) }).ok).toBe(
        false
      );
    }
    expect(redeemCode({ destination: phone, purpose: 'login', code })).toEqual({
      ok: false,
      reason: 'too-many-attempts'
    });
  });

  it('expires', async () => {
    const phone = uniqPhone();
    const now = Date.now();
    await requestSmsLogin({ phone, ip: IP, origin: ORIGIN, now });
    const code = lastSmsCode(phone);
    expect(
      redeemCode({ destination: phone, purpose: 'login', code, now: now + SMS_CODE_TTL_MS + 1 })
    ).toEqual({ ok: false, reason: 'expired' });
  });

  it('a code for one number never redeems for another', async () => {
    const a = uniqPhone();
    const b = uniqPhone();
    await requestSmsLogin({ phone: a, ip: IP, origin: ORIGIN });
    await requestSmsLogin({ phone: b, ip: IP, origin: ORIGIN });
    expect(redeemCode({ destination: b, purpose: 'login', code: lastSmsCode(a) }).ok).toBe(
      lastSmsCode(a) === lastSmsCode(b)
    );
  });

  it(`sends at most ${MAX_PER_DESTINATION} texts per number per window`, async () => {
    const phone = uniqPhone();
    const now = Date.now();
    for (let i = 0; i < MAX_PER_DESTINATION; i++) {
      expect((await requestSmsLogin({ phone, ip: IP, origin: ORIGIN, now })).outcome).toBe('sent');
    }
    expect((await requestSmsLogin({ phone, ip: IP, origin: ORIGIN, now })).outcome).toBe(
      'rate-limited'
    );
    expect(readSmsOutbox(phone)).toHaveLength(MAX_PER_DESTINATION);
  });

  it('caps texts per IP across different numbers', async () => {
    const ip = { hash: `ip-${randomUUID()}`, max: 2 };
    const now = Date.now();
    expect((await requestSmsLogin({ phone: uniqPhone(), ip, origin: ORIGIN, now })).outcome).toBe(
      'sent'
    );
    expect((await requestSmsLogin({ phone: uniqPhone(), ip, origin: ORIGIN, now })).outcome).toBe(
      'sent'
    );
    expect((await requestSmsLogin({ phone: uniqPhone(), ip, origin: ORIGIN, now })).outcome).toBe(
      'rate-limited'
    );
  });
});

describe('handleLoginRequest — one field, email or phone', () => {
  it('routes a phone number to SMS and a new number signs up phone-only', async () => {
    const r = await handleLoginRequest(fakeEvent(), '(571) 555-0142', null);
    expect(r).toMatchObject({ ok: true, channel: 'sms', identifier: '+15715550142' });
    const code = lastSmsCode('+15715550142');

    const redeemed = redeemLoginCode('571-555-0142', code);
    expect(redeemed).toEqual({ ok: true, identity: { phone: '+15715550142' } });

    db.delete(users).where(eq(users.phone, '+15715550142')).run();
    const event = fakeEvent();
    const login = loginByIdentity(event, (redeemed as { identity: { phone: string } }).identity);
    expect(login.next).toBe('onboarding');
    expect(login.user).toMatchObject({ email: null, phone: '+15715550142' });
    expect(readSession(event.cookies)).toMatchObject({ email: null, phone: '+15715550142' });
    const row = db.select().from(users).where(eq(users.phone, '+15715550142')).get();
    expect(row?.email).toBeNull();
  });

  it('routes an email to the magic link, whose email carries a backup code', async () => {
    const email = uniqEmail();
    const r = await handleLoginRequest(fakeEvent(), email.toUpperCase(), null);
    expect(r).toMatchObject({ ok: true, channel: 'email', identifier: email });
    const mail = lastEmail(email);
    expect(mail?.kind).toBe('magic-link');
    expect(readOutbox(email).at(-1)?.body).toContain((mail as { code: string }).code);
  });

  it('400s on something that is neither', async () => {
    expect(await handleLoginRequest(fakeEvent(), 'call me maybe', null)).toMatchObject({
      ok: false,
      status: 400
    });
  });

  it('503s when the SMS transport fails', async () => {
    process.env.SMS_TRANSPORT = 'pingram';
    delete process.env.PINGRAM_API_KEY;
    expect(await handleLoginRequest(fakeEvent(), uniqPhone(), null)).toMatchObject({
      ok: false,
      status: 503
    });
  });

  it('a wrong code returns readable copy, not a reason enum', async () => {
    const phone = uniqPhone();
    await requestSmsLogin({ phone, ip: IP, origin: ORIGIN });
    const r = redeemLoginCode(phone, wrongCode(lastSmsCode(phone)));
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/didn't match/);
  });
});

describe('email link and backup code share one lifetime', () => {
  async function issue(email: string) {
    await requestMagicLink({ email, ip: uniqIp(), origin: ORIGIN });
    const mail = lastEmail(email) as { loginUrl: string; code: string };
    return { token: new URL(mail.loginUrl).searchParams.get('token')!, code: mail.code };
  }

  it('redeeming the code burns the link', async () => {
    const email = uniqEmail();
    const { token, code } = await issue(email);
    expect(redeemLoginCode(email, code)).toEqual({ ok: true, identity: { email } });
    expect(consumeMagicLink(token)).toEqual({ ok: false, reason: 'used' });
  });

  it('redeeming the link burns the code', async () => {
    const email = uniqEmail();
    const { token, code } = await issue(email);
    expect(consumeMagicLink(token)).toEqual({ ok: true, email });
    expect(redeemLoginCode(email, code).ok).toBe(false);
  });
});

describe('linking a second sign-in identity', () => {
  function makeUser(fields: { email?: string; phone?: string }): string {
    const id = `user_${randomUUID()}`;
    db.insert(users)
      .values({ id, email: fields.email ?? null, phone: fields.phone ?? null })
      .run();
    return id;
  }

  it('adds a verified phone to an email account', async () => {
    const userId = makeUser({ email: uniqEmail() });
    const phone = uniqPhone();
    const identifier = { kind: 'phone' as const, value: phone };
    expect(await requestLinkCode({ userId, identifier })).toMatchObject({ ok: true });
    const code = /^(\d{6}) /.exec(readSmsOutbox(phone).at(-1)!.body)![1];
    expect(redeemLinkCode({ userId, identifier, code })).toEqual({ ok: true });
    expect(db.select().from(users).where(eq(users.id, userId)).get()?.phone).toBe(phone);
  });

  it('adds a verified email to a phone-only account', async () => {
    const userId = makeUser({ phone: uniqPhone() });
    const email = uniqEmail();
    const identifier = { kind: 'email' as const, value: email };
    await requestLinkCode({ userId, identifier });
    const mail = lastEmail(email);
    expect(mail?.kind).toBe('contact-code');
    const code = (mail as { code: string }).code;
    expect(redeemLinkCode({ userId, identifier, code })).toEqual({ ok: true });
    expect(db.select().from(users).where(eq(users.id, userId)).get()?.email).toBe(email);
  });

  it("another user's code can't attach a destination to you", async () => {
    const alice = makeUser({ email: uniqEmail() });
    const mallory = makeUser({ email: uniqEmail() });
    const phone = uniqPhone();
    const identifier = { kind: 'phone' as const, value: phone };
    await requestLinkCode({ userId: alice, identifier });
    const code = /^(\d{6}) /.exec(readSmsOutbox(phone).at(-1)!.body)![1];
    expect(redeemLinkCode({ userId: mallory, identifier, code })).toEqual({
      ok: false,
      error: 'invalid'
    });
  });

  it('refuses an identity that belongs to someone else, or is already yours', async () => {
    const taken = uniqEmail();
    makeUser({ email: taken });
    const me = makeUser({ email: uniqEmail(), phone: uniqPhone() });
    expect(
      await requestLinkCode({ userId: me, identifier: { kind: 'email', value: taken } })
    ).toEqual({ ok: false, error: 'in-use' });
    const mine = db.select().from(users).where(eq(users.id, me)).get()!;
    expect(
      await requestLinkCode({ userId: me, identifier: { kind: 'phone', value: mine.phone! } })
    ).toEqual({ ok: false, error: 'already-yours' });
    expect(readOutbox(taken)).toHaveLength(0);
  });

  it('a login code cannot be used as a link code', async () => {
    const userId = makeUser({ email: uniqEmail() });
    const phone = uniqPhone();
    await requestSmsLogin({ phone, ip: IP, origin: ORIGIN });
    const code = lastSmsCode(phone);
    expect(redeemLinkCode({ userId, identifier: { kind: 'phone', value: phone }, code }).ok).toBe(
      false
    );
  });

  it('never removes the last identity', () => {
    const userId = makeUser({ email: uniqEmail(), phone: uniqPhone() });
    expect(unlinkIdentity(userId, 'email')).toEqual({ ok: true });
    expect(unlinkIdentity(userId, 'phone')).toEqual({ ok: false, error: 'last-identity' });
    const row = db.select().from(users).where(eq(users.id, userId)).get();
    expect(row?.email).toBeNull();
    expect(row?.phone).not.toBeNull();
  });
});
