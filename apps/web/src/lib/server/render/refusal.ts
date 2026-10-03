/**
 * The answer to a render the queue refused (R-06): a short page with a way
 * back for a browser navigation (exports are usually plain link clicks),
 * JSON `{ error, code }` for everything else.
 */

import { t } from '$lib/i18n';
import { escapeHtml } from '$lib/html';
import { updatingResponse } from '$lib/server/ops/fenceResponse';
import { RenderRefused } from './queue';

export function renderRefusalResponse(
  request: Request,
  locale: string | null | undefined,
  err: RenderRefused
): Response {
  if (err.code === 'UPDATING') return updatingResponse(request, locale);
  const message = t(
    locale,
    err.code === 'RENDER_BUSY' ? 'recui.render.busy' : 'recui.render.failed'
  );
  const headers = { 'retry-after': String(err.retryAfterS), 'cache-control': 'no-store' };
  const accept = request.headers.get('accept') ?? '';
  if (accept.includes('text/html') && !accept.includes('application/json')) {
    const lang = locale === 'es' ? 'es' : 'en';
    return new Response(
      `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(t(locale, 'recui.render.busyTitle'))}</title><p style="font:18px/1.5 system-ui;margin:2rem">${escapeHtml(message)}</p><p style="font:18px/1.5 system-ui;margin:2rem"><a href="javascript:history.back()" style="display:inline-block;min-height:48px;line-height:48px">${escapeHtml(t(locale, 'recui.render.back'))}</a></p></html>`,
      { status: err.status, headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } }
    );
  }
  return new Response(JSON.stringify({ error: message, code: err.code }), {
    status: err.status,
    headers: { ...headers, 'content-type': 'application/json' }
  });
}

/** Runs an export handler, turning a refused render into its answer. */
export async function withRenderRefusal(
  event: { request: Request; locals?: { locale?: string | null } },
  fn: () => Promise<Response>
): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RenderRefused)
      return renderRefusalResponse(event.request, event.locals?.locale, e);
    throw e;
  }
}
