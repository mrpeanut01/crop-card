import { json } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { DEMO_BLOCKED_PARAM } from '$lib/demo/identity';

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
  '/api/session/switch-owner'
] as const;

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const DEMO_BLOCKED_MESSAGE =
  'Not available in the demo. Sign up with your email to use this on your own farm.';

export function demoBlocksWrite(method: string, pathname: string): boolean {
  if (!WRITE_METHODS.has(method)) return false;
  return DEMO_BLOCKED_WRITES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export { DEMO_BLOCKED_PARAM };

function isFormPost(method: string, contentType: string | null | undefined): boolean {
  if (method !== 'POST') return false;
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return type === 'application/x-www-form-urlencoded' || type === 'multipart/form-data';
}

/** The refusal, shaped for whoever asked: a form action submitted with
 *  `use:enhance` gets an action failure the page shows as `form.error`; a
 *  plain page form is sent back to its page, where the demo banner says
 *  why; everything else gets JSON. */
export function demoBlockedResponse(
  pathname: string,
  isActionRequest: boolean,
  locale?: string | null,
  request?: { method: string; contentType?: string | null }
): Response {
  const message = locale ? t(locale, 'entry.demo.blocked') : DEMO_BLOCKED_MESSAGE;
  if (!pathname.startsWith('/api/')) {
    if (isActionRequest) {
      return json(
        { type: 'failure', status: 403, data: JSON.stringify([{ error: 1 }, message]) },
        { headers: { 'cache-control': 'no-store' } }
      );
    }
    if (request && isFormPost(request.method, request.contentType)) {
      return new Response(null, {
        status: 303,
        headers: {
          location: `${pathname}?${DEMO_BLOCKED_PARAM}=1`,
          'cache-control': 'no-store'
        }
      });
    }
  }
  return json(
    { error: message, message, code: 'DEMO_DISABLED' },
    { status: 403, headers: { 'cache-control': 'no-store' } }
  );
}
