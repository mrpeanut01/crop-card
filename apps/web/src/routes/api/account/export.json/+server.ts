/**
 * GET /api/account/export.json
 *
 * GDPR-style account export (#205): one JSON file with every tenant-scoped
 * record and the operator's profile, built by `buildAccountExport` so the
 * ZIP export carries the identical file. Bigger objects (PDF audit pack,
 * plugin snapshot zip) are linked, not inlined.
 */

import { type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { buildAccountExport } from '$lib/server/accountExport';
import { APP_VERSION } from '$lib/version';
import { identityLabel } from '$lib/identity';

export const GET: RequestHandler = async (event) => {
  const user = requireUser(event);
  const payload = await buildAccountExport(event);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="cropcard-account-export-${stamp}.json"`,
      'X-CropCard-Generator': `CropCard/${APP_VERSION}`,
      'X-CropCard-Exported-By': identityLabel(user)
    }
  });
};
