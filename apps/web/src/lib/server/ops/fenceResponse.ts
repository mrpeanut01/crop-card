import { RETRY_AFTER_S } from '../../../../scripts/lib/handoffProtocol.mjs';
import { UPDATING_CODE, UPDATING_MESSAGE } from '$lib/updating';

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
export function fenceResponse(request: Request, fenced: boolean): Response | null {
  if (!fenced || SAFE_METHODS.has(request.method)) return null;
  const headers = {
    'retry-after': String(RETRY_AFTER_S),
    'cache-control': 'no-store',
    'x-cropcard-updating': '1'
  };
  if (request.headers.get('x-sveltekit-action') === 'true') {
    const data = JSON.stringify([
      { error: 1, message: 1, code: 2 },
      UPDATING_MESSAGE,
      UPDATING_CODE
    ]);
    return new Response(JSON.stringify({ type: 'failure', status: 503, data }), {
      status: 200,
      headers: { ...headers, 'content-type': 'application/json' }
    });
  }
  const accept = request.headers.get('accept') ?? '';
  if (accept.includes('text/html') && !accept.includes('application/json')) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Updating</title><p style="font:18px/1.5 system-ui;margin:2rem">${UPDATING_MESSAGE}</p><p style="font:18px/1.5 system-ui;margin:2rem"><a href="javascript:history.back()">Go back</a></p>`,
      { status: 503, headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } }
    );
  }
  return new Response(JSON.stringify({ error: UPDATING_MESSAGE, code: UPDATING_CODE }), {
    status: 503,
    headers: { ...headers, 'content-type': 'application/json' }
  });
}
