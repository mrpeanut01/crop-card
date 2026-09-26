import { minutesInWords, withOriginBoundLine } from './otpMessage';
import type { UnsubscribeLinks } from './emailUnsubscribe';
import { emailAlertLabel, type EmailAlertCategory } from '$lib/email/alertCategories';

/**
 * Email transport (Phase 18e foundation + Sprint 21 production adapter).
 *
 * Sprint 21 (Phase 21 launch readiness) — added a real-provider adapter
 * behind `EMAIL_TRANSPORT`:
 *   - unset / `stdout` (default)   → logs to stdout (Phase 18e behavior).
 *   - `none`                       → no-op (used by the test suite to
 *                                     keep noise out of CI logs).
 *   - `postmark`                   → POST to api.postmarkapp.com via the
 *                                     server token at $POSTMARK_TOKEN.
 *   - `pingram`                    → POST to api.pingram.io/email with the
 *                                     secret key at $PINGRAM_API_KEY.
 *   - `memory`                     → appends to an in-process outbox the
 *                                     e2e suite reads via /_dev/outbox.
 *                                     Refused unless NODE_ENV=test or
 *                                     E2E_OUTBOX=1 (see outboxEnabled).
 *
 * Both provider paths are direct REST POSTs so we don't take on the
 * `postmark` / `pingram` SDKs (and their node-fetch) for one endpoint. Other providers (SES,
 * Resend) can be added behind the same switch when the launch checklist
 * picks a vendor — the call-site signature `dispatchEmail(OutboundEmail)`
 * is the stable contract.
 *
 * Templates are typed unions so callers can't accidentally drift the
 * subject line or required-fields contract.
 */

interface InviteEmail {
  kind: 'helper-invite';
  to: string;
  ownerName: string;
  /** Full URL including the unguessable token. */
  acceptUrl: string;
  /** Free text from the inviter, optional. */
  message?: string;
  /** ms-epoch expiry. */
  expiresAt: number;
}

interface MagicLinkEmail {
  kind: 'magic-link';
  to: string;
  /** Full sign-in URL including the unguessable token. */
  loginUrl: string;
  /** 6-digit backup code for signing in on a device without this inbox. */
  code: string;
  /** ms-epoch expiry. */
  expiresAt: number;
}

interface ContactCodeEmail {
  kind: 'contact-code';
  to: string;
  /** 6-digit code confirming this address for an existing account. */
  code: string;
  /** ms-epoch expiry. */
  expiresAt: number;
  /** Site origin for the autofill line; null skips it. */
  origin: string | null;
}

/** A field alert (or the test message from Settings). Opt-in only: the
 *  alert scheduler sends one only to a user with a consent row for that
 *  category, and every one carries its unsubscribe links. */
export interface AlertEmail {
  kind: 'field-alert';
  to: string;
  /** null for the "send a test email" message. */
  category: EmailAlertCategory | null;
  farmName: string;
  title: string;
  body: string;
  /** Absolute link into CropCard for the alert. */
  actionUrl: string;
  /** Absolute link to /settings/notifications. */
  settingsUrl: string;
  unsubscribe: UnsubscribeLinks;
}

export type OutboundEmail = InviteEmail | MagicLinkEmail | ContactCodeEmail | AlertEmail;

/**
 * Transactional mail answers something the person just did (asked to sign
 * in, was invited, confirms an address) and never needs consent. Everything
 * else is opt-in and must carry a working unsubscribe. Stripe sends billing
 * receipts itself, so CropCard sends no billing mail.
 */
export const EMAIL_KIND_CLASS: Record<OutboundEmail['kind'], 'transactional' | 'opt-in'> = {
  'helper-invite': 'transactional',
  'magic-link': 'transactional',
  'contact-code': 'transactional',
  'field-alert': 'opt-in'
};

/** Pingram notification type per kind. Unsubscribes on Pingram's side apply
 *  per type, so sign-in mail never shares a type with alert mail. */
export const PINGRAM_TYPE: Record<OutboundEmail['kind'], string> = {
  'helper-invite': 'helper-invite',
  'magic-link': 'magic-link',
  'contact-code': 'contact-code',
  'field-alert': 'field-alerts'
};

export function isOptInEmail(email: OutboundEmail): email is AlertEmail {
  return EMAIL_KIND_CLASS[email.kind] === 'opt-in';
}

/** RFC 2369 List-Unsubscribe + RFC 8058 List-Unsubscribe-Post for opt-in
 *  mail; null for transactional mail. */
export function unsubscribeHeaders(email: OutboundEmail): Record<string, string> | null {
  if (!isOptInEmail(email)) return null;
  return {
    'List-Unsubscribe': `<${email.unsubscribe.oneClickUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
  };
}

function assertUnsubscribable(email: AlertEmail): void {
  for (const url of [email.unsubscribe.pageUrl, email.unsubscribe.oneClickUrl]) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new EmailTransportError('opt-in email needs absolute unsubscribe links');
    }
    const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
      throw new EmailTransportError('opt-in email unsubscribe links must use https');
    }
  }
}

export interface OutboxEntry {
  to: string;
  subject: string;
  body: string;
  headers: Record<string, string>;
  email: OutboundEmail;
  sentAt: number;
}

const OUTBOX_LIMIT = 200;
const memoryOutbox: OutboxEntry[] = [];

/** The in-memory outbox exists only for vitest (NODE_ENV=test) and the
 *  Playwright preview server (E2E_OUTBOX=1, set by playwright.config.ts).
 *  Anything else — including production — can neither write to it nor
 *  read it, because it holds live sign-in links. */
export function outboxEnabled(): boolean {
  return (
    process.env.EMAIL_TRANSPORT === 'memory' &&
    (process.env.NODE_ENV === 'test' || process.env.E2E_OUTBOX === '1')
  );
}

/** Test-only view of the `memory` transport. Always empty for any other
 *  transport, so callers can't read mail that went to a real provider. */
export function readOutbox(to?: string): OutboxEntry[] {
  if (!outboxEnabled()) return [];
  const norm = to?.trim().toLowerCase();
  return memoryOutbox.filter((e) => !norm || e.to.toLowerCase() === norm);
}

export function clearOutbox(): void {
  memoryOutbox.length = 0;
}

export const POSTMARK_TIMEOUT_MS = 10_000;
export const PINGRAM_TIMEOUT_MS = 10_000;

export class EmailTransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'EmailTransportError';
  }
}

/** Send an outbound email. Provider chosen at call-time via env. */
export async function dispatchEmail(email: OutboundEmail): Promise<void> {
  const transport = process.env.EMAIL_TRANSPORT ?? 'stdout';
  if (transport === 'none') return;

  if (isOptInEmail(email)) assertUnsubscribable(email);
  const subject = subjectFor(email);
  const body = bodyFor(email);
  const headers = unsubscribeHeaders(email) ?? {};

  if (transport === 'postmark') {
    await dispatchPostmark(email, subject, body, headers);
    return;
  }

  if (transport === 'pingram') {
    await dispatchPingram(email, subject, body);
    return;
  }

  if (transport === 'memory') {
    if (!outboxEnabled()) {
      throw new EmailTransportError(
        'EMAIL_TRANSPORT=memory requires NODE_ENV=test or E2E_OUTBOX=1'
      );
    }
    memoryOutbox.push({ to: email.to, subject, body, headers, email, sentAt: Date.now() });
    if (memoryOutbox.length > OUTBOX_LIMIT) memoryOutbox.shift();
    return;
  }

  // Default: stdout. Keeps the prior dev behavior so invite URLs are
  // grep-able in the container logs.
  // eslint-disable-next-line no-console
  const headerLines = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}\n`)
    .join('');
  console.log(`[email] to=${email.to} subject="${subject}"\n${headerLines}${body}\n[/email]`);
}

async function dispatchPostmark(
  email: OutboundEmail,
  subject: string,
  textBody: string,
  headers: Record<string, string>
): Promise<void> {
  const token = process.env.POSTMARK_TOKEN;
  const from = process.env.EMAIL_FROM ?? 'noreply@cropcard.farm';
  if (!token) {
    throw new EmailTransportError('POSTMARK_TOKEN not configured');
  }
  let res: Response;
  try {
    res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': token
      },
      body: JSON.stringify({
        From: from,
        To: email.to,
        Subject: subject,
        TextBody: textBody,
        MessageStream: process.env.POSTMARK_STREAM ?? 'outbound',
        ...(Object.keys(headers).length > 0
          ? { Headers: Object.entries(headers).map(([Name, Value]) => ({ Name, Value })) }
          : {})
      }),
      signal: AbortSignal.timeout(POSTMARK_TIMEOUT_MS)
    });
  } catch (e) {
    throw new EmailTransportError(
      'Postmark dispatch failed: request error or timeout',
      undefined,
      e
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '(no body)');
    throw new EmailTransportError(
      `Postmark dispatch failed: ${res.status} ${res.statusText} ${detail}`,
      res.status
    );
  }
}

/** Pingram requires an HTML body and returns HTTP 200 with an `error`
 *  object for some rejections, so both status and payload are checked.
 *  Without a verified sending domain Pingram substitutes its own
 *  noreply address, so EMAIL_FROM is only sent when explicitly set.
 *  POST /email takes no custom headers: Pingram adds its own RFC 8058
 *  List-Unsubscribe pointing at its hosted page, reports unsubscribes to
 *  /api/email/pingram-webhook, and the body carries our own link. */
async function dispatchPingram(
  email: OutboundEmail,
  subject: string,
  textBody: string
): Promise<void> {
  const apiKey = process.env.PINGRAM_API_KEY;
  if (!apiKey) {
    throw new EmailTransportError('PINGRAM_API_KEY not configured');
  }
  const from = process.env.EMAIL_FROM;
  let res: Response;
  try {
    res = await fetch('https://api.pingram.io/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        type: PINGRAM_TYPE[email.kind],
        to: email.to,
        subject,
        html: textToHtml(textBody),
        fromName: process.env.EMAIL_FROM_NAME ?? 'CropCard',
        ...(from ? { fromAddress: from } : {})
      }),
      signal: AbortSignal.timeout(PINGRAM_TIMEOUT_MS)
    });
  } catch (e) {
    throw new EmailTransportError(
      'Pingram dispatch failed: request error or timeout',
      undefined,
      e
    );
  }
  const detail = await res.text().catch(() => '');
  if (!res.ok) {
    throw new EmailTransportError(
      `Pingram dispatch failed: ${res.status} ${res.statusText} ${detail || '(no body)'}`,
      res.status
    );
  }
  let payload: { error?: { code?: string; message?: string } } = {};
  try {
    payload = detail ? JSON.parse(detail) : {};
  } catch {
    // A 2xx with a non-JSON body is treated as accepted.
  }
  if (payload.error) {
    throw new EmailTransportError(
      `Pingram dispatch failed: ${payload.error.code ?? 'error'} ${payload.error.message ?? ''}`.trim(),
      res.status
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain-text body → minimal HTML: escaped, URLs linked, newlines kept. */
export function textToHtml(text: string): string {
  const escaped = escapeHtml(text).replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}">${url}</a>`
  );
  return `<div style="font-family:sans-serif;white-space:pre-wrap">${escaped}</div>`;
}

function subjectFor(email: OutboundEmail): string {
  switch (email.kind) {
    case 'helper-invite':
      return `You've been invited to ${email.ownerName} on CropCard`;
    case 'magic-link':
      return `Your CropCard sign-in code is ${email.code}`;
    case 'contact-code':
      return `Your CropCard verification code is ${email.code}`;
    case 'field-alert':
      return `${email.title} · ${email.farmName}`;
  }
}

function alertBody(email: AlertEmail): string {
  const why = email.category
    ? `You're getting this because you turned on "${emailAlertLabel(email.category)}" emails for ${email.farmName} in CropCard.`
    : `You asked CropCard for a test email for ${email.farmName}.`;
  const stop = email.category
    ? `Stop "${emailAlertLabel(email.category)}" emails:`
    : 'Stop all alert emails from this farm:';
  return [
    email.body,
    ``,
    `Open in CropCard:`,
    email.actionUrl,
    ``,
    why,
    stop,
    email.unsubscribe.pageUrl,
    `Change which alerts you get:`,
    email.settingsUrl,
    ``,
    `CropCard`
  ].join('\n');
}

function bodyFor(email: OutboundEmail): string {
  switch (email.kind) {
    case 'helper-invite': {
      const expiresIn = Math.max(
        0,
        Math.round((email.expiresAt - Date.now()) / (24 * 3600 * 1000))
      );
      return [
        `Hi,`,
        ``,
        `${email.ownerName} has invited you to their CropCard farm.`,
        email.message ? `\nMessage: ${email.message}\n` : '',
        `Click to accept (expires in ${expiresIn} days):`,
        email.acceptUrl,
        ``,
        `— CropCard`
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'magic-link': {
      const expires = minutesInWords(email.expiresAt - Date.now());
      return withOriginBoundLine(
        [
          `Your CropCard sign-in code is ${email.code}.`,
          ``,
          `Tap this link on this device to sign in. It expires in ${expires} and works once:`,
          email.loginUrl,
          ``,
          `Opened this email somewhere else? Type the backup code above on the sign-in screen instead.`,
          ``,
          `If you didn't ask to sign in, you can ignore this email.`,
          ``,
          `— CropCard`
        ],
        new URL(email.loginUrl).origin,
        email.code
      );
    }
    case 'contact-code': {
      const expires = minutesInWords(email.expiresAt - Date.now());
      return withOriginBoundLine(
        [
          `Your CropCard verification code is ${email.code}.`,
          ``,
          `Enter it in CropCard to add this email to your account. It expires in ${expires}.`,
          ``,
          `If you didn't ask for this, you can ignore this email.`,
          ``,
          `— CropCard`
        ],
        email.origin,
        email.code
      );
    }
    case 'field-alert':
      return alertBody(email);
  }
}
