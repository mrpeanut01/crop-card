import { error, json, type RequestHandler } from '@sveltejs/kit';
import { outboxEnabled, readOutbox } from '$lib/server/email';

/**
 * E2E-only mailbox for the `memory` email transport. 404 unless
 * EMAIL_TRANSPORT=memory AND (E2E_OUTBOX=1 or NODE_ENV=test) — it hands
 * out live sign-in links, so unlike /_dev/primitives there is no
 * dev-mode or superadmin bypass.
 */
export const GET: RequestHandler = ({ url }) => {
  if (!outboxEnabled()) throw error(404, 'Not found');
  const to = url.searchParams.get('to') ?? undefined;
  const messages = readOutbox(to).map(({ to, subject, body, sentAt }) => ({
    to,
    subject,
    body,
    sentAt
  }));
  return json({ messages }, { headers: { 'cache-control': 'no-store' } });
};
