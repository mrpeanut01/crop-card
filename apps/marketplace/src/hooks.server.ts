import type { Handle, HandleServerError } from '@sveltejs/kit';

/**
 * Skeleton hooks. Sub-task C will add:
 *  - Bearer-auth branch on `/api/v1/**` (looks up app_credentials, populates locals.user)
 *  - Admin HMAC cookie session on `/admin/**` (mirrors apps/web session.ts)
 *  - `MARKETPLACE_MODE=intranet` GET pass-through
 */
export const handle: Handle = async ({ event, resolve }) => {
  return resolve(event);
};

/**
 * Structured server-error visibility — matches the apps/web pattern
 * (memory: feedback_error_visibility.md). Without this, SvelteKit's
 * default opaque "Internal error" hides the stack.
 */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const errId = crypto.randomUUID();
  console.error(
    JSON.stringify({
      tag: 'server-error',
      errId,
      route: event.route.id,
      method: event.request.method,
      url: event.url.pathname,
      status,
      message,
      stack: error instanceof Error ? error.stack : String(error)
    })
  );
  return { message, errId } as App.Error;
};
