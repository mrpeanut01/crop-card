// @vitest-environment node
// Phase 38 passkey sign-in, end to end against @simplewebauthn/server with
// a software authenticator (rulings P38-1 to P38-15).
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { passkeys, users } from '$lib/db/schema';
import { DEMO_EMAIL_DOMAIN } from '$lib/demo/identity';
import { SoftAuthenticator } from './__fixtures__/softAuthenticator';
import {
  AAGUID_NAMES,
  CHALLENGE_COOKIE,
  CHALLENGE_TTL_MS,
  deletePasskey,
  listPasskeys,
  loginOptions,
  openChallenge,
  registrationOptions,
  relyingParty,
  renamePasskey,
  resetPasskeyLimitsForTests,
  sealChallenge,
  takeLoginAttempt,
  verifyLogin,
  verifyRegistration,
  type RelyingParty
} from './passkeys';
import { addRefusal, OFFER_COOKIE, PASSKEY_ADD_WINDOW_MS } from './passkeyOffer';
import { readSession } from './session';

const ORIGIN = 'http://localhost:5173';
const RP: RelyingParty = { rpID: 'localhost', origins: [ORIGIN] };

function jar() {
  const store = new Map<string, string>();
  const cookies = {
    get: (name: string) => store.get(name),
    getAll: () => [...store.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void store.set(name, value),
    delete: (name: string) => void store.delete(name),
    serialize: () => ''
  } as unknown as RequestEvent['cookies'];
  return { store, cookies };
}

function event(cookies: RequestEvent['cookies']): RequestEvent {
  return {
    cookies,
    url: new URL(`${ORIGIN}/api/auth/passkey/login/verify`),
    locals: {},
    getClientAddress: () => '203.0.113.9'
  } as unknown as RequestEvent;
}

function seedUser(email?: string) {
  const id = `pk-${randomUUID().slice(0, 8)}`;
  const row = { id, email: email ?? `${id}@test`, phone: null };
  db.insert(users).values(row).run();
  return { ...row, sessionIssuedAt: Date.now() };
}

async function enroll(
  user: ReturnType<typeof seedUser>,
  opts: { attachment?: 'platform' | 'cross-platform'; synced?: boolean; aaguid?: string } = {}
) {
  const browser = jar();
  const options = await registrationOptions(browser.cookies, RP, user);
  const auth = new SoftAuthenticator({
    rpID: RP.rpID,
    origin: ORIGIN,
    userHandle: options.user.id,
    ...opts
  });
  const result = await verifyRegistration(
    browser.cookies,
    RP,
    user,
    auth.register(options.challenge)
  );
  return { auth, result, browser, options };
}

async function signIn(auth: SoftAuthenticator, override: { origin?: string } = {}) {
  const browser = jar();
  const options = await loginOptions(browser.cookies, RP);
  const ev = event(browser.cookies);
  const outcome = await verifyLogin(ev, RP, auth.signIn(options.challenge, override));
  return { outcome, browser, options, ev };
}

beforeEach(() => resetPasskeyLimitsForTests());

describe('registration', () => {
  it('stores a passkey with no name and its provider from the AAGUID', async () => {
    const user = seedUser();
    const aaguid = 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd';
    const { result } = await enroll(user, { synced: true, aaguid });
    expect(result.ok).toBe(true);
    const list = listPasskeys(user.id);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBeNull();
    expect(list[0].provider).toBe(AAGUID_NAMES[aaguid]);
    expect(list[0].backedUp).toBe(true);
    expect(list[0].lastUsedAt).toBeNull();
  });

  it('asks for user verification and a discoverable credential (P38-4)', async () => {
    const user = seedUser();
    const options = await registrationOptions(jar().cookies, RP, user);
    expect(options.authenticatorSelection?.userVerification).toBe('required');
    expect(options.authenticatorSelection?.residentKey).toBe('required');
    expect(options.attestation).toBe('none');
  });

  it('excludes passkeys the person already has', async () => {
    const user = seedUser();
    const { auth } = await enroll(user);
    const again = await registrationOptions(jar().cookies, RP, user);
    expect(again.excludeCredentials?.map((c) => c.id)).toEqual([auth.id]);
  });

  it('refuses a passkey made for another origin', async () => {
    const user = seedUser();
    const browser = jar();
    const options = await registrationOptions(browser.cookies, RP, user);
    const auth = new SoftAuthenticator({ rpID: RP.rpID, origin: 'https://evil.example' });
    const r = await verifyRegistration(browser.cookies, RP, user, auth.register(options.challenge));
    expect(r).toEqual({ ok: false, reason: 'invalid' });
    expect(listPasskeys(user.id)).toHaveLength(0);
  });

  it('refuses a passkey made without user verification', async () => {
    const user = seedUser();
    const browser = jar();
    const options = await registrationOptions(browser.cookies, RP, user);
    const auth = new SoftAuthenticator({ rpID: RP.rpID, origin: ORIGIN, userVerified: false });
    const r = await verifyRegistration(browser.cookies, RP, user, auth.register(options.challenge));
    expect(r.ok).toBe(false);
  });

  it("refuses a challenge issued for someone else's account", async () => {
    const alice = seedUser();
    const bob = seedUser();
    const browser = jar();
    const options = await registrationOptions(browser.cookies, RP, alice);
    const auth = new SoftAuthenticator({ rpID: RP.rpID, origin: ORIGIN });
    const r = await verifyRegistration(browser.cookies, RP, bob, auth.register(options.challenge));
    expect(r).toEqual({ ok: false, reason: 'challenge' });
  });

  it('uses each challenge once', async () => {
    const user = seedUser();
    const browser = jar();
    const options = await registrationOptions(browser.cookies, RP, user);
    const auth = new SoftAuthenticator({ rpID: RP.rpID, origin: ORIGIN });
    const response = auth.register(options.challenge);
    expect((await verifyRegistration(browser.cookies, RP, user, response)).ok).toBe(true);
    expect(browser.store.has(CHALLENGE_COOKIE)).toBe(false);
    expect(await verifyRegistration(browser.cookies, RP, user, response)).toEqual({
      ok: false,
      reason: 'challenge'
    });
  });

  it('answers duplicate for a credential already stored', async () => {
    const user = seedUser();
    const { auth } = await enroll(user);
    const browser = jar();
    const options = await registrationOptions(browser.cookies, RP, user);
    const r = await verifyRegistration(browser.cookies, RP, user, auth.register(options.challenge));
    expect(r).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('clears the add-a-passkey offer once a passkey is added', async () => {
    const user = seedUser();
    const browser = jar();
    browser.store.set(OFFER_COOKIE, '1');
    const options = await registrationOptions(browser.cookies, RP, user);
    const auth = new SoftAuthenticator({ rpID: RP.rpID, origin: ORIGIN });
    await verifyRegistration(browser.cookies, RP, user, auth.register(options.challenge));
    expect(browser.store.has(OFFER_COOKIE)).toBe(false);
  });
});

describe('sign-in', () => {
  it('signs in with a passkey on this device and mints the session', async () => {
    const user = seedUser();
    const { auth } = await enroll(user);
    const { outcome, browser } = await signIn(auth);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.crossDevice).toBe(false);
    expect(outcome.result.next).toBe('onboarding');
    expect(readSession(browser.cookies)?.userId).toBe(user.id);
    expect(browser.store.has(OFFER_COOKIE)).toBe(false);
    const row = db.select().from(passkeys).where(eq(passkeys.userId, user.id)).get();
    expect(row?.signCount).toBe(1);
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
  });

  it('asks for no particular credential, so any passkey or a phone can answer (P38-1)', async () => {
    const options = await loginOptions(jar().cookies, RP);
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(options.userVerification).toBe('required');
  });

  it('offers a passkey on this device after a phone sign-in (P38-6)', async () => {
    const user = seedUser();
    const { auth } = await enroll(user, { attachment: 'cross-platform' });
    const { outcome, browser } = await signIn(auth);
    expect(outcome.ok && outcome.crossDevice).toBe(true);
    expect(browser.store.get(OFFER_COOKIE)).toBe('1');
  });

  it('refuses a response for another origin', async () => {
    const user = seedUser();
    const { auth } = await enroll(user);
    const { outcome, browser } = await signIn(auth, { origin: 'https://evil.example' });
    expect(outcome).toEqual({ ok: false, reason: 'invalid' });
    expect(readSession(browser.cookies)).toBeNull();
  });

  it('refuses an unknown credential', async () => {
    const user = seedUser();
    const stranger = new SoftAuthenticator({ rpID: RP.rpID, origin: ORIGIN, userHandle: 'eA' });
    void user;
    const { outcome } = await signIn(stranger);
    expect(outcome).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses a user handle that is not the passkey owner', async () => {
    const user = seedUser();
    const { auth } = await enroll(user);
    auth.userHandle = Buffer.from('someone-else').toString('base64url');
    const { outcome } = await signIn(auth);
    expect(outcome).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses a replayed response, because the challenge is gone', async () => {
    const user = seedUser();
    const { auth } = await enroll(user);
    const browser = jar();
    const options = await loginOptions(browser.cookies, RP);
    const response = auth.signIn(options.challenge);
    expect((await verifyLogin(event(browser.cookies), RP, response)).ok).toBe(true);
    expect(await verifyLogin(event(browser.cookies), RP, response)).toEqual({
      ok: false,
      reason: 'challenge'
    });
  });

  it('refuses a sign-in without a challenge cookie', async () => {
    const user = seedUser();
    const { auth } = await enroll(user);
    const options = await loginOptions(jar().cookies, RP);
    const outcome = await verifyLogin(event(jar().cookies), RP, auth.signIn(options.challenge));
    expect(outcome).toEqual({ ok: false, reason: 'challenge' });
  });

  it('accepts a synced passkey that always reports 0 (P38-11)', async () => {
    const user = seedUser();
    const { auth } = await enroll(user, { synced: true });
    auth.counter = -1;
    expect((await signIn(auth)).outcome.ok).toBe(true);
    auth.counter = -1;
    expect((await signIn(auth)).outcome.ok).toBe(true);
  });

  it('refuses a sign counter that went backwards (P38-11)', async () => {
    const user = seedUser();
    const { auth } = await enroll(user);
    auth.counter = 4;
    expect((await signIn(auth)).outcome.ok).toBe(true);
    auth.counter = 1;
    expect((await signIn(auth)).outcome).toEqual({ ok: false, reason: 'invalid' });
  });

  it('never signs a demo visitor in by passkey', async () => {
    const user = seedUser(`visitor-${randomUUID().slice(0, 6)}@${DEMO_EMAIL_DOMAIN}`);
    const auth = new SoftAuthenticator({ rpID: RP.rpID, origin: ORIGIN });
    const browser = jar();
    const options = await registrationOptions(browser.cookies, RP, user);
    auth.userHandle = options.user.id;
    await verifyRegistration(browser.cookies, RP, user, auth.register(options.challenge));
    const { outcome } = await signIn(auth);
    expect(outcome).toEqual({ ok: false, reason: 'invalid' });
  });

  it('keeps working after "Sign out everywhere" moves the cutoff', async () => {
    const user = seedUser();
    const { auth } = await enroll(user);
    db.update(users)
      .set({ sessionsValidAfter: new Date(Date.now() - 1000) })
      .where(eq(users.id, user.id))
      .run();
    const { outcome, browser } = await signIn(auth);
    expect(outcome.ok).toBe(true);
    expect(readSession(browser.cookies)!.iat).toBeGreaterThan(Date.now() - 5000);
  });
});

describe('challenge cookie', () => {
  it('expires after five minutes', () => {
    const now = Date.now();
    const sealed = sealChallenge({ c: 'abc', k: 'auth', exp: now + CHALLENGE_TTL_MS });
    expect(openChallenge(sealed, now)?.c).toBe('abc');
    expect(openChallenge(sealed, now + CHALLENGE_TTL_MS + 1)).toBeNull();
  });

  it('refuses a tampered cookie', () => {
    const sealed = sealChallenge({ c: 'abc', k: 'auth', exp: Date.now() + 60_000 });
    const [body, mac] = sealed.split('.');
    const forged = Buffer.from(
      JSON.stringify({ c: 'xyz', k: 'auth', exp: Date.now() + 60_000 })
    ).toString('base64url');
    expect(openChallenge(`${forged}.${mac}`)).toBeNull();
    expect(openChallenge(`${body}.${mac.slice(0, -2)}AA`)).toBeNull();
  });
});

describe('who may add a passkey (P38-5, P38-8)', () => {
  const base = { id: 'u', email: 'a@b.test', phone: null };
  it('allows a sign-in from the last ten minutes', () => {
    const now = Date.now();
    expect(addRefusal({ ...base, sessionIssuedAt: now - 60_000 }, now)).toBeNull();
  });
  it('refuses an older or unknown sign-in time', () => {
    const now = Date.now();
    expect(addRefusal({ ...base, sessionIssuedAt: now - PASSKEY_ADD_WINDOW_MS - 1 }, now)).toBe(
      'stale'
    );
    expect(addRefusal({ ...base, sessionIssuedAt: 0 }, now)).toBe('stale');
    expect(addRefusal({ ...base }, now)).toBe('stale');
  });
  it('refuses a demo visitor', () => {
    expect(
      addRefusal({ ...base, email: `v@${DEMO_EMAIL_DOMAIN}`, sessionIssuedAt: Date.now() })
    ).toBe('demo');
  });
});

describe('managing passkeys', () => {
  it("cannot rename or remove another person's passkey", async () => {
    const alice = seedUser();
    const bob = seedUser();
    await enroll(alice);
    const [pk] = listPasskeys(alice.id);
    expect(renamePasskey(bob.id, pk.id, 'mine now')).toBe(false);
    expect(deletePasskey(bob.id, pk.id)).toBe(false);
    expect(listPasskeys(alice.id)[0].name).toBeNull();
    expect(renamePasskey(alice.id, pk.id, 'Barn phone')).toBe(true);
    expect(listPasskeys(alice.id)[0].name).toBe('Barn phone');
    expect(deletePasskey(alice.id, pk.id)).toBe(true);
    expect(listPasskeys(alice.id)).toHaveLength(0);
  });

  it('goes with the account when the user row is deleted', async () => {
    const user = seedUser();
    await enroll(user);
    db.delete(users).where(eq(users.id, user.id)).run();
    expect(db.select().from(passkeys).where(eq(passkeys.userId, user.id)).all()).toHaveLength(0);
  });
});

describe('relying party (P38-3)', () => {
  it('uses the registrable domain when ORIGIN is under it', () => {
    const rp = relyingParty('http://ignored', {
      NODE_ENV: 'production',
      ORIGIN: 'https://app.cropcard.io',
      PASSKEY_RP_ID: 'cropcard.io',
      REDIRECT_HOSTS: 'www.cropcard.io,cropcard.io,other.example'
    });
    expect(rp).toEqual({
      rpID: 'cropcard.io',
      origins: ['https://app.cropcard.io', 'https://www.cropcard.io', 'https://cropcard.io']
    });
  });

  it("falls back to ORIGIN's host when the RP ID does not cover it", () => {
    const rp = relyingParty('http://ignored', {
      NODE_ENV: 'production',
      ORIGIN: 'https://cropcard-dev.azurecontainerapps.io',
      PASSKEY_RP_ID: 'cropcard.io'
    });
    expect(rp?.rpID).toBe('cropcard-dev.azurecontainerapps.io');
  });

  it('has none in production without ORIGIN, and uses the request in dev', () => {
    expect(relyingParty('https://x.test', { NODE_ENV: 'production' })).toBeNull();
    expect(relyingParty('http://localhost:5173', { NODE_ENV: 'development' })).toEqual({
      rpID: 'localhost',
      origins: ['http://localhost:5173']
    });
  });
});

describe('rate limit (P38-12)', () => {
  it('caps one public address and leaves another alone', () => {
    const now = Date.now();
    let taken = 0;
    while (takeLoginAttempt('8.8.4.4', now) && taken < 1000) taken += 1;
    expect(taken).toBe(60);
    expect(takeLoginAttempt('8.8.8.8', now)).toBe(true);
  });
});
