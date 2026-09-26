import { error, json, type RequestHandler } from '@sveltejs/kit';
import { outboxEnabled, readOutbox } from '$lib/server/email';
import { readSmsOutbox } from '$lib/server/sms';

/**
 * E2E-only mailbox for the `memory` email transport. 404 unless
 * EMAIL_TRANSPORT=memory AND (E2E_OUTBOX=1 or NODE_ENV=test) — it hands
 * out live sign-in links, so unlike /_dev/primitives there is no
 * dev-mode or superadmin bypass. Texts from the `memory` SMS transport
 * (same gate, SMS_TRANSPORT=memory) are listed alongside with
 * `channel: 'sms'` and no subject.
 */
export const GET: RequestHandler = ({ url }) => {
  if (!outboxEnabled()) throw error(404, 'Not found');
  const to = url.searchParams.get('to') ?? undefined;
  const mail = readOutbox(to).map(({ to, subject, body, headers, sentAt }) => ({
    channel: 'email' as const,
    to,
    subject,
    body,
    headers,
    sentAt
  }));
  const texts = readSmsOutbox(to).map(({ to, body, sentAt }) => ({
    channel: 'sms' as const,
    to,
    subject: null,
    body,
    headers: {},
    sentAt
  }));
  const messages = [...mail, ...texts].sort((a, b) => a.sentAt - b.sentAt);
  return json({ messages }, { headers: { 'cache-control': 'no-store' } });
};
