import { RETRY_AFTER_S } from '../../../../scripts/lib/handoffProtocol.mjs';
import { UPDATING_CODE, updatingMessage } from '$lib/updating';
import { t } from '$lib/i18n';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * While this container is handing the database to a newer one, every write
 * is refused with 503 + Retry-After before any route code runs, shaped for
 * the three kinds of caller:
 *   - `use:enhance` form actions get an ActionResult `failure` so the page
 *     keeps its input and shows the message in `form.error`;
 *   - plain HTML form posts get a short page;
 *   - everything else (fetch, offline-queue replays, agents) gets JSON.
 * Nothing was written, so a retry is always safe.
 */
export function fenceResponse(
  request: Request,
  fenced: boolean,
  locale?: string | null
): Response | null {
  if (!fenced || SAFE_METHODS.has(request.method)) return null;
  const message = updatingMessage(locale);
  if (request.headers.get('x-sveltekit-action') === 'true') {
    const data = JSON.stringify([{ error: 1, message: 1, code: 2 }, message, UPDATING_CODE]);
    return new Response(JSON.stringify({ type: 'failure', status: 503, data }), {
      status: 200,
      headers: { ...updatingHeaders(), 'content-type': 'application/json' }
    });
  }
  return updatingResponse(request, locale);
}

function updatingHeaders() {
  return {
    'retry-after': String(RETRY_AFTER_S),
    'cache-control': 'no-store',
    'x-cropcard-updating': '1'
  };
}

/** The 503 "CropCard is updating" answer as a short page for a browser
 *  navigation or as JSON for everything else. Also used for an export
 *  asked for while this container hands over (R-12). */
export function updatingResponse(request: Request, locale?: string | null): Response {
  const message = updatingMessage(locale);
  const headers = updatingHeaders();
  const accept = request.headers.get('accept') ?? '';
  if (accept.includes('text/html') && !accept.includes('application/json')) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${locale ? t(locale, 'recui.updatingTitle') : 'Updating'}</title><p style="font:18px/1.5 system-ui;margin:2rem">${message}</p><p style="font:18px/1.5 system-ui;margin:2rem"><a href="javascript:history.back()">${locale ? t(locale, 'recui.updatingBack') : 'Go back'}</a></p>`,
      { status: 503, headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } }
    );
  }
  return new Response(JSON.stringify({ error: message, code: UPDATING_CODE }), {
    status: 503,
    headers: { ...headers, 'content-type': 'application/json' }
  });
}
