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
 *   - `memory`                     → appends to an in-process outbox the
 *                                     e2e suite reads via /_dev/outbox.
 *                                     Refused unless NODE_ENV=test or
 *                                     E2E_OUTBOX=1 (see outboxEnabled).
 *
 * The Postmark path is a direct REST POST so we don't take on the
 * `postmark` SDK dependency for one endpoint. Other providers (SES,
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
  /** ms-epoch expiry. */
  expiresAt: number;
}

export type OutboundEmail = InviteEmail | MagicLinkEmail;

export interface OutboxEntry {
  to: string;
  subject: string;
  body: string;
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

  const subject = subjectFor(email);
  const body = bodyFor(email);

  if (transport === 'postmark') {
    await dispatchPostmark(email, subject, body);
    return;
  }

  if (transport === 'memory') {
    if (!outboxEnabled()) {
      throw new EmailTransportError(
        'EMAIL_TRANSPORT=memory requires NODE_ENV=test or E2E_OUTBOX=1'
      );
    }
    memoryOutbox.push({ to: email.to, subject, body, email, sentAt: Date.now() });
    if (memoryOutbox.length > OUTBOX_LIMIT) memoryOutbox.shift();
    return;
  }

  // Default: stdout. Keeps the prior dev behavior so invite URLs are
  // grep-able in the container logs.
  // eslint-disable-next-line no-console
  console.log(`[email] to=${email.to} subject="${subject}"\n${body}\n[/email]`);
}

async function dispatchPostmark(
  email: OutboundEmail,
  subject: string,
  textBody: string
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
        MessageStream: process.env.POSTMARK_STREAM ?? 'outbound'
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

function subjectFor(email: OutboundEmail): string {
  switch (email.kind) {
    case 'helper-invite':
      return `You've been invited to ${email.ownerName} on CropCard`;
    case 'magic-link':
      return 'Your CropCard sign-in link';
  }
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
      const minutes = Math.max(1, Math.round((email.expiresAt - Date.now()) / 60_000));
      return [
        `Hi,`,
        ``,
        `Use this link to sign in to CropCard (expires in ${minutes} minutes, works once):`,
        email.loginUrl,
        ``,
        `If you didn't ask to sign in, you can ignore this email.`,
        ``,
        `— CropCard`
      ].join('\n');
    }
  }
}
