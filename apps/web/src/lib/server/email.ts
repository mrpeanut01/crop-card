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

export type OutboundEmail = InviteEmail;

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
  const res = await fetch('https://api.postmarkapp.com/email', {
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
    })
  });
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
  }
}
