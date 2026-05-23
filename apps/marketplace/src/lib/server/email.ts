/**
 * Email transport stub for the marketplace.
 *
 * Logs to stdout so dev surfaces the magic-link URL. Production replaces
 * `dispatchEmail` with a real provider call (Postmark/SES/Resend) — same
 * call shape, no inline HTML at call sites.
 */

interface AdminMagicLinkEmail {
  kind: 'admin-magic-link';
  to: string;
  /** Full URL including the unguessable single-use token. */
  loginUrl: string;
  /** ms-epoch expiry. */
  expiresAt: number;
}

export type OutboundEmail = AdminMagicLinkEmail;

export async function dispatchEmail(email: OutboundEmail): Promise<void> {
  if (process.env.EMAIL_TRANSPORT === 'none') return;
  const subject = subjectFor(email);
  const body = bodyFor(email);
  // eslint-disable-next-line no-console
  console.log(`[marketplace email] to=${email.to} subject="${subject}"\n${body}\n[/email]`);
}

function subjectFor(email: OutboundEmail): string {
  switch (email.kind) {
    case 'admin-magic-link':
      return 'Marketplace admin sign-in link';
  }
}

function bodyFor(email: OutboundEmail): string {
  switch (email.kind) {
    case 'admin-magic-link': {
      const expiresMin = Math.max(0, Math.round((email.expiresAt - Date.now()) / 60_000));
      return [
        `Click to sign in to the CropCard plugin marketplace (expires in ${expiresMin} min):`,
        ``,
        email.loginUrl,
        ``,
        `If you did not request this, ignore the email.`,
        ``,
        `— CropCard Marketplace`
      ].join('\n');
    }
  }
}
