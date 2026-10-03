/**
 * GET /api/account/export.json
 *
 * GDPR-style account export (#205): one JSON file with every tenant-scoped
 * record and the operator's profile, built by `buildAccountExport` so the
 * ZIP export carries the identical file. Bigger objects (PDF audit pack,
 * plugin snapshot zip) are linked, not inlined.
 */

import { type RequestEvent, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { buildAccountExport } from '$lib/server/accountExport';
import { APP_VERSION } from '$lib/version';
import { identityLabel } from '$lib/identity';
import { runRenderJob } from '$lib/server/render/queue';
import { withRenderRefusal } from '$lib/server/render/refusal';

export const GET: RequestHandler = (event) => withRenderRefusal(event, () => exportJson(event));

async function exportJson(event: RequestEvent): Promise<Response> {
  const user = requireUser(event);
  const payload = await buildAccountExport(event);
  const rendered = await runRenderJob(
    { kind: 'json-bytes', value: payload, space: 2 },
    { ownerId: user.activeOwnerId ?? '', signal: event.request?.signal }
  );
  if (rendered.kind !== 'json-bytes') throw new Error(`render returned ${rendered.kind}`);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return new Response(rendered.bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="cropcard-account-export-${stamp}.json"`,
      'X-CropCard-Generator': `CropCard/${APP_VERSION}`,
      'X-CropCard-Exported-By': identityLabel(user)
    }
  });
}
