/**
 * GET /api/organic/pack.zip?from=YYYY-MM-DD&to=YYYY-MM-DD[&documents=1]
 *
 * 33B (plan item 7): the certifier pack. Owner (cookie or Bearer) and
 * inspector; helpers 403 (B-48). Free on every plan and never gated by
 * the season close-out or a billing suspension. One build per farm at a
 * time: a second request while one is building answers 429 `PACK_BUSY`
 * with `Retry-After: 10` (B-49).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { prefsFor } from '$lib/db/userProfile';
import { organicPackQuerySchema } from '$lib/records/apiSchemas';
import { recordExportReader } from '$lib/records/exportAccess.server';
import { parseExportWindow, windowRefusal } from '$lib/records/exportWindow';
import { releaseWhenDone, streamOrganicPack, tryStartPack } from '$lib/server/organicPack';
import { RenderRefused } from '$lib/server/render/queue';
import { renderRefusalResponse } from '$lib/server/render/refusal';

export const _requestSchema = organicPackQuerySchema;

export const GET: RequestHandler = async (event) => {
  const access = recordExportReader(event);
  if (!access.ok) return access.response;
  const user = access.user;
  const prefs = prefsFor(user.id);
  const window = parseExportWindow(event.url.searchParams, prefs);
  if (!window.ok) return windowRefusal(window);
  const documents = event.url.searchParams.get('documents') === '1';
  const ownerId = user.activeOwnerId ?? '';
  const release = tryStartPack(ownerId);
  if (!release) {
    return json(
      {
        error: 'PACK_BUSY',
        message: t(event.locals?.locale, 'organic.api.packBusy')
      },
      { status: 429, headers: { 'Retry-After': '10' } }
    );
  }
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await streamOrganicPack({
      fromMs: window.fromMs,
      toMs: window.toMs,
      from: window.from,
      to: window.to,
      documents,
      viewer: user,
      prefs,
      signal: event.request?.signal
    });
  } catch (e) {
    release();
    if (e instanceof RenderRefused) {
      return renderRefusalResponse(event.request, event.locals?.locale, e);
    }
    throw e;
  }
  return new Response(releaseWhenDone(stream, release), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="cropcard-organic-pack-${window.from}-to-${window.to}.zip"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
};
