import { json } from '@sveltejs/kit';
import { t } from '$lib/i18n';

/** Writes a demo visitor may not make: anything that reaches past the
 *  throwaway farm (email, texts, push, payments, API tokens, invites,
 *  sign-in identities, AI keys and limits) or stores large files. Matched
 *  on the path and every path under it. */
export const DEMO_BLOCKED_WRITES = [
  '/api/invites',
  '/settings/helpers',
  '/api/auth/token',
  '/settings/api-tokens',
  '/api/account/identity',
  '/api/billing/checkout',
  '/api/billing/portal',
  '/settings/billing',
  '/api/email/prefs',
  '/api/email/test',
  '/settings/notifications',
  '/api/push/subscribe',
  '/api/push/test',
  '/settings/ai',
  '/settings/integrations',
  '/api/plugins/upload',
  '/api/documents',
  '/api/scan-url',
  '/onboarding',
  '/api/session/switch-owner'
] as const;

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const DEMO_BLOCKED_MESSAGE =
  'Not available in the demo. Sign up with your email to use this on your own farm.';

export function demoBlocksWrite(method: string, pathname: string): boolean {
  if (!WRITE_METHODS.has(method)) return false;
  return DEMO_BLOCKED_WRITES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/** The refusal, shaped for whoever asked: a form action submitted with
 *  `use:enhance` gets an action failure the page shows as `form.error`;
 *  everything else gets JSON. */
export function demoBlockedResponse(
  pathname: string,
  isActionRequest: boolean,
  locale?: string | null
): Response {
  const message = locale ? t(locale, 'entry.demo.blocked') : DEMO_BLOCKED_MESSAGE;
  if (isActionRequest && !pathname.startsWith('/api/')) {
    return json(
      { type: 'failure', status: 403, data: JSON.stringify([{ error: 1 }, message]) },
      { headers: { 'cache-control': 'no-store' } }
    );
  }
  return json(
    { error: message, message, code: 'DEMO_DISABLED' },
    { status: 403, headers: { 'cache-control': 'no-store' } }
  );
}
