/**
 * Email transport stub (Phase 18e).
 *
 * Logs outbound mail to stdout so the dev environment surfaces invite
 * links + future verification mail without a Postmark/SES/Resend hookup.
 * Production replaces `dispatchEmail` with a real provider call; the
 * call shape (template-driven, no inline HTML at call sites) keeps
 * marketing-team authoring viable without code changes.
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

/** Send an outbound email. In v1 this just logs; replace with the chosen
 *  provider when the launch checklist is ready. */
export async function dispatchEmail(email: OutboundEmail): Promise<void> {
  if (process.env.EMAIL_TRANSPORT === 'none') return;
  const subject = subjectFor(email);
  const body = bodyFor(email);
  // eslint-disable-next-line no-console
  console.log(`[email] to=${email.to} subject="${subject}"\n${body}\n[/email]`);
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
