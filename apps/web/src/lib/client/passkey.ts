import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService
} from '@simplewebauthn/browser';
import type { MessageKey } from '$lib/i18n';

/** Phase 38 passkey ceremonies in the browser. Each returns a result
 *  instead of throwing: the person cancelling the device prompt is
 *  `cancelled` and shows nothing. */
export type PasskeyResult<T> =
  | { ok: true; value: T }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error?: string; errorKey?: MessageKey; code?: string };

function isCancel(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  const code = (e as { code?: string } | null)?.code;
  return name === 'NotAllowedError' || name === 'AbortError' || code === 'ERROR_CEREMONY_ABORTED';
}

async function postJson(
  url: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? '{}' : JSON.stringify(body),
    credentials: 'same-origin'
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

function serverError<T>(data: Record<string, unknown>): PasskeyResult<T> {
  return {
    ok: false,
    cancelled: false,
    error: typeof data.error === 'string' ? data.error : undefined,
    errorKey: typeof data.error === 'string' ? undefined : 'passkey.err.unavailable',
    code: typeof data.code === 'string' ? data.code : undefined
  };
}

export function passkeysSupported(): boolean {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

/** P38-6: only devices that can hold a passkey themselves see the card. */
export async function canAddPasskeyHere(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

export interface SignedIn {
  next: string;
  crossDevice: boolean;
}

async function finishLogin(
  autofill: boolean,
  optionsJSON: Parameters<typeof startAuthentication>[0]['optionsJSON']
): Promise<PasskeyResult<SignedIn>> {
  let response;
  try {
    response = await startAuthentication({ optionsJSON, useBrowserAutofill: autofill });
  } catch (e) {
    // The autofill request runs in the background, so its failures (no
    // passkey here, the form was sent, the page moved on) say nothing to
    // the person; only a sign-in they picked can fail out loud.
    if (autofill || isCancel(e)) return { ok: false, cancelled: true };
    return { ok: false, cancelled: false, errorKey: 'passkey.err.signinFailed' };
  }
  const verify = await postJson('/api/auth/passkey/login/verify', response);
  if (!verify.ok) return serverError(verify.data);
  return {
    ok: true,
    value: { next: String(verify.data.next ?? '/today'), crossDevice: !!verify.data.crossDevice }
  };
}

function loginOptions() {
  return postJson('/api/auth/passkey/login/options');
}

/** The autofill request (`mediation: 'conditional'`). It waits until the
 *  person picks a passkey from the Email field's suggestions, and is
 *  cancelled by `cancelPasskeyRequests` or by starting another ceremony. */
export async function startAutofillLogin(): Promise<PasskeyResult<SignedIn> | null> {
  try {
    if (!(await browserSupportsWebAuthnAutofill())) return null;
  } catch {
    return null;
  }
  const opts = await loginOptions().catch(() => null);
  if (!opts?.ok) return null;
  return finishLogin(true, opts.data.options as never);
}

/** The **Use a passkey** button: a modal request, where browsers offer
 *  the phone/QR option for a passkey held on another device (P38-1). */
export async function loginWithButton(): Promise<PasskeyResult<SignedIn>> {
  if (!passkeysSupported()) {
    return { ok: false, cancelled: false, errorKey: 'passkey.err.unsupported' };
  }
  const opts = await loginOptions().catch(() => null);
  if (!opts) return { ok: false, cancelled: false, errorKey: 'passkey.err.unavailable' };
  if (!opts.ok) return serverError(opts.data);
  return finishLogin(false, opts.data.options as never);
}

export function cancelPasskeyRequests(): void {
  try {
    WebAuthnAbortService.cancelCeremony();
  } catch {
    /* nothing running */
  }
}

/** Make a passkey on this device for the signed-in person. */
export async function addPasskey(): Promise<PasskeyResult<{ id: string }>> {
  if (!passkeysSupported()) {
    return { ok: false, cancelled: false, errorKey: 'passkey.err.unsupported' };
  }
  const opts = await postJson('/api/auth/passkey/register/options').catch(() => null);
  if (!opts) return { ok: false, cancelled: false, errorKey: 'passkey.err.unavailable' };
  if (!opts.ok) return serverError(opts.data);
  let response;
  try {
    response = await startRegistration({ optionsJSON: opts.data.options as never });
  } catch (e) {
    if (isCancel(e)) return { ok: false, cancelled: true };
    const name = (e as { name?: string } | null)?.name;
    if (name === 'InvalidStateError') {
      return { ok: false, cancelled: false, errorKey: 'passkey.err.duplicate' };
    }
    return { ok: false, cancelled: false, errorKey: 'passkey.err.addFailed' };
  }
  const verify = await postJson('/api/auth/passkey/register/verify', response);
  if (!verify.ok) return serverError(verify.data);
  return { ok: true, value: { id: String(verify.data.id) } };
}

/** P38-7: "Don't ask on this device", per person, in this browser only. */
const NEVER_KEY = 'cc.passkeyOffer.never.';
const DISMISS_KEY = 'cc.passkeyOffer.dismissed.';

export function offerSuppressedHere(userId: string): boolean {
  try {
    return localStorage.getItem(NEVER_KEY + userId) === '1';
  } catch {
    return false;
  }
}

export function offerDismissCount(userId: string): number {
  try {
    return Number(localStorage.getItem(DISMISS_KEY + userId) ?? '0') || 0;
  } catch {
    return 0;
  }
}

export function recordOfferDismissed(userId: string): void {
  try {
    localStorage.setItem(DISMISS_KEY + userId, String(offerDismissCount(userId) + 1));
  } catch {
    /* storage blocked: the card just asks again next sign-in */
  }
}

export function suppressOfferHere(userId: string): void {
  try {
    localStorage.setItem(NEVER_KEY + userId, '1');
  } catch {
    /* storage blocked */
  }
}

export async function dismissOffer(): Promise<void> {
  await fetch('/api/auth/passkey/offer', { method: 'DELETE', credentials: 'same-origin' }).catch(
    () => undefined
  );
}
