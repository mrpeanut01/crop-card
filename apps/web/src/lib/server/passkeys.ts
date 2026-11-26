/**
 * Phase 38 passkey sign-in (WebAuthn), on @simplewebauthn/server.
 *
 * A passkey is a third way to prove who someone is, beside the email link
 * and the SMS code; a verified passkey ends in `startSession`, so the HMAC
 * cookie, roles and tenant choice are unchanged. Rulings P38-1 to P38-15 in
 * docs/design/PHASE_38_PASSKEYS_PLAN.md.
 *
 * `passkeys` is identity-level (P38-9), so every query is unscoped.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON
} from '@simplewebauthn/server';
import { db } from '$lib/db/client';
import { passkeys, users } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';
import { isDemoEmail } from '$lib/demo/identity';
import { identityLabel } from '$lib/identity';
import { realNow } from './clock';
import { authSecret } from './session';
import { startSession, type LoginResult } from './auth';
import { createSendLimiter } from './sendLimiter';
import { ipRateBucket } from './magicLink';
import { clearPasskeyOffer, markPasskeyOffer, type PasskeyOwner } from './passkeyOffer';

export { addRefusal, PASSKEY_ADD_WINDOW_MS, type AddRefusal } from './passkeyOffer';

export const CHALLENGE_TTL_MS = 5 * 60_000;

export const CHALLENGE_COOKIE = 'cc_wa';
const CHALLENGE_PATH = '/api/auth/passkey';
const RP_NAME = 'CropCard';

const ATTRIBUTED_PER_10_MIN = 60;
const UNATTRIBUTED_PER_10_MIN = 1000;
const attributedLimiter = createSendLimiter([{ ms: 10 * 60_000, max: ATTRIBUTED_PER_10_MIN }]);
const unattributedLimiter = createSendLimiter([{ ms: 10 * 60_000, max: UNATTRIBUTED_PER_10_MIN }]);

/** P38-12: per-IP limit on the public login endpoints, on the magic link's
 *  buckets (a missing or private address shares one larger bucket). */
export function takeLoginAttempt(ip: string | null, now = realNow()): boolean {
  const bucket = ipRateBucket(ip);
  return (bucket.attributed ? attributedLimiter : unattributedLimiter).tryTake(bucket.key, now);
}

export function resetPasskeyLimitsForTests(): void {
  attributedLimiter.reset();
  unattributedLimiter.reset();
}

/* ---------------------------------------------------------------- config */

export interface RelyingParty {
  rpID: string;
  origins: string[];
}

/**
 * P38-3. With ORIGIN set, origins are ORIGIN plus each REDIRECT_HOSTS host
 * over https, and the RP ID is PASSKEY_RP_ID when ORIGIN's host is that
 * domain or under it (`cropcard.io` in production), else ORIGIN's host. Dev
 * without ORIGIN uses the request's own origin. Production without ORIGIN
 * has no relying party, and the routes answer 503.
 */
export function relyingParty(requestOrigin: string, env = process.env): RelyingParty | null {
  const configured = env.ORIGIN?.trim().replace(/\/+$/, '');
  let base: URL;
  try {
    if (configured) base = new URL(configured);
    else if (env.NODE_ENV === 'production') return null;
    else base = new URL(requestOrigin);
  } catch {
    return null;
  }
  const host = base.hostname.toLowerCase();
  const wanted = env.PASSKEY_RP_ID?.trim().toLowerCase();
  const rpID = wanted && (host === wanted || host.endsWith(`.${wanted}`)) ? wanted : host;
  const origins = new Set([base.origin]);
  if (configured) {
    for (const h of (env.REDIRECT_HOSTS ?? '').split(',')) {
      const name = h.trim().toLowerCase();
      if (name && (name === rpID || name.endsWith(`.${rpID}`))) origins.add(`https://${name}`);
    }
  }
  return { rpID, origins: [...origins] };
}

/* ------------------------------------------------------- challenge cookie */

interface ChallengeState {
  c: string;
  k: 'reg' | 'auth';
  u?: string;
  exp: number;
}

function b64url(b: Buffer | string): string {
  return Buffer.from(b).toString('base64url');
}

function mac(body: string): Buffer {
  return createHmac('sha256', authSecret()).update(`passkey-challenge:${body}`).digest();
}

export function sealChallenge(state: ChallengeState): string {
  const body = b64url(JSON.stringify(state));
  return `${body}.${b64url(mac(body))}`;
}

export function openChallenge(raw: string | undefined, now = realNow()): ChallengeState | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const body = raw.slice(0, dot);
  const given = Buffer.from(raw.slice(dot + 1), 'base64url');
  const expected = mac(body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
  const s = parsed as Partial<ChallengeState>;
  if (typeof s.c !== 'string' || (s.k !== 'reg' && s.k !== 'auth')) return null;
  if (typeof s.exp !== 'number' || s.exp < now) return null;
  return { c: s.c, k: s.k, u: typeof s.u === 'string' ? s.u : undefined, exp: s.exp };
}

function cookieOpts(path: string, maxAgeMs: number, sameSite: 'strict' | 'lax') {
  return {
    path,
    httpOnly: true,
    sameSite,
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.floor(maxAgeMs / 1000)
  };
}

function setChallenge(cookies: Cookies, state: Omit<ChallengeState, 'exp'>): void {
  cookies.set(
    CHALLENGE_COOKIE,
    sealChallenge({ ...state, exp: realNow() + CHALLENGE_TTL_MS }),
    cookieOpts(CHALLENGE_PATH, CHALLENGE_TTL_MS, 'strict')
  );
}

/** Reads and clears the challenge, so each one is good for one verify. */
function takeChallenge(cookies: Cookies, kind: 'reg' | 'auth'): ChallengeState | null {
  const state = openChallenge(cookies.get(CHALLENGE_COOKIE));
  cookies.delete(CHALLENGE_COOKIE, { path: CHALLENGE_PATH });
  return state && state.k === kind ? state : null;
}

/* ---------------------------------------------------------- registration */

function parseTransports(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
  } catch {
    return undefined;
  }
}

export async function registrationOptions(
  cookies: Cookies,
  rp: RelyingParty,
  user: PasskeyOwner
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  unscopedQueryNote('passkeys are identity-level; a person owns them, not a farm');
  const existing = db
    .select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.userId, user.id))
    .all();
  const label = identityLabel(user);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: label,
    userDisplayName: label,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: parseTransports(c.transports)
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
  });
  setChallenge(cookies, { c: options.challenge, k: 'reg', u: user.id });
  return options;
}

export type VerifyFailure = 'challenge' | 'invalid' | 'duplicate';

export async function verifyRegistration(
  cookies: Cookies,
  rp: RelyingParty,
  user: PasskeyOwner,
  response: RegistrationResponseJSON
): Promise<{ ok: true; id: string } | { ok: false; reason: VerifyFailure }> {
  const state = takeChallenge(cookies, 'reg');
  if (!state || state.u !== user.id) return { ok: false, reason: 'challenge' };
  let result;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: state.c,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpID,
      requireUserVerification: true
    });
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!result.verified) return { ok: false, reason: 'invalid' };
  const info = result.registrationInfo;
  unscopedQueryNote('passkeys are identity-level; a person owns them, not a farm');
  const taken = db
    .select({ id: passkeys.id })
    .from(passkeys)
    .where(eq(passkeys.credentialId, info.credential.id))
    .get();
  if (taken) return { ok: false, reason: 'duplicate' };
  const id = `pk_${randomUUID()}`;
  db.insert(passkeys)
    .values({
      id,
      userId: user.id,
      credentialId: info.credential.id,
      publicKey: Buffer.from(info.credential.publicKey),
      signCount: info.credential.counter,
      transports: info.credential.transports ? JSON.stringify(info.credential.transports) : null,
      aaguid: info.aaguid,
      backedUp: info.credentialBackedUp,
      name: null,
      createdAt: new Date(realNow())
    })
    .run();
  clearPasskeyOffer(cookies);
  return { ok: true, id };
}

/* --------------------------------------------------------------- sign-in */

export async function loginOptions(
  cookies: Cookies,
  rp: RelyingParty
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: 'required'
  });
  setChallenge(cookies, { c: options.challenge, k: 'auth' });
  return options;
}

export type LoginOutcome =
  | { ok: true; result: LoginResult; crossDevice: boolean }
  | { ok: false; reason: 'challenge' | 'invalid' };

/** Ruling P38-12: every failure maps to one generic message at the route,
 *  so the answer never says whether a credential or account exists. */
export async function verifyLogin(
  event: RequestEvent,
  rp: RelyingParty,
  response: AuthenticationResponseJSON
): Promise<LoginOutcome> {
  const state = takeChallenge(event.cookies, 'auth');
  if (!state) return { ok: false, reason: 'challenge' };
  unscopedQueryNote('passkey sign-in precedes any Owner context');
  const row = db.select().from(passkeys).where(eq(passkeys.credentialId, response.id)).get();
  if (!row) return { ok: false, reason: 'invalid' };
  const handle = response.response.userHandle;
  if (handle && Buffer.from(handle, 'base64url').toString('utf-8') !== row.userId) {
    return { ok: false, reason: 'invalid' };
  }
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: state.c,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpID,
      credential: {
        id: row.credentialId,
        publicKey: new Uint8Array(row.publicKey),
        counter: row.signCount,
        transports: parseTransports(row.transports)
      },
      requireUserVerification: true
    });
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!result.verified) return { ok: false, reason: 'invalid' };
  const user = db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user || isDemoEmail(user.email)) return { ok: false, reason: 'invalid' };
  db.update(passkeys)
    .set({
      signCount: result.authenticationInfo.newCounter,
      backedUp: result.authenticationInfo.credentialBackedUp,
      lastUsedAt: new Date(realNow())
    })
    .where(eq(passkeys.id, row.id))
    .run();
  const crossDevice = response.authenticatorAttachment === 'cross-platform';
  const login = startSession(event, user);
  if (crossDevice) markPasskeyOffer(event.cookies);
  else clearPasskeyOffer(event.cookies);
  return { ok: true, result: login, crossDevice };
}

/* ----------------------------------------------------------- management */

/** Provider names for common AAGUIDs, shown when the person has not named
 *  a passkey. Brand names, so not translated. */
export const AAGUID_NAMES: Readonly<Record<string, string>> = {
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain',
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
  '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
  '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello',
  '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
  'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
  'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
  '53414d53-554e-4700-0000-000000000000': 'Samsung Pass'
};

export interface PasskeyView {
  id: string;
  name: string | null;
  provider: string | null;
  backedUp: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

export function listPasskeys(userId: string): PasskeyView[] {
  unscopedQueryNote('passkeys are identity-level; a person owns them, not a farm');
  return db
    .select()
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(asc(passkeys.createdAt))
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      provider: (r.aaguid && AAGUID_NAMES[r.aaguid]) || null,
      backedUp: r.backedUp,
      createdAt: r.createdAt.getTime(),
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.getTime() : null
    }));
}

export function countPasskeys(userId: string): number {
  return listPasskeys(userId).length;
}

/** Own rows only; another person's id reads as missing. */
export function renamePasskey(userId: string, id: string, name: string | null): boolean {
  unscopedQueryNote('passkeys are identity-level; a person owns them, not a farm');
  const res = db
    .update(passkeys)
    .set({ name })
    .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
    .run();
  return res.changes > 0;
}

export function deletePasskey(userId: string, id: string): boolean {
  unscopedQueryNote('passkeys are identity-level; a person owns them, not a farm');
  const res = db
    .delete(passkeys)
    .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
    .run();
  return res.changes > 0;
}
