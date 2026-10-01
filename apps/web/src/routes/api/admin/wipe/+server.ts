/**
 * POST /api/admin/wipe
 *
 * Owner-only "start from zero" reset (interactive owner only: no API
 * token, no impersonation). Wipes every farm-scoped row
 * (events, tasks, crops, blocks, equipment, stock, sprayers,
 * weather cache) but preserves users + plugins (which live on disk).
 *
 * Requires a confirmation token in the body to prevent accidents:
 *
 *   POST /api/admin/wipe
 *   { "confirm": "WIPE-EVERYTHING", "keepEquipment": false }
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { wipeAllData } from '$lib/db/admin';
import { currentUser } from '$lib/server/auth';
import { isInteractiveOwner } from '$lib/server/interactiveOwner';
import { drainBlobDeletions } from '$lib/server/vault/blobQueue';

const inputSchema = z.object({
  confirm: z.literal('WIPE-EVERYTHING'),
  keepEquipment: z.boolean().optional(),
  keepWeatherCache: z.boolean().optional()
});

export const POST: RequestHandler = async (event) => {
  const auth = currentUser(event);
  if (!auth) throw error(401, 'sign-in required');
  if (auth.role !== 'owner') throw error(403, 'owner role required for wipe');
  // C-35 §0: wiping erases every withdrawal and grazing hold with the
  // records, so an API token or an impersonating superadmin never can.
  if (!isInteractiveOwner(event, auth)) {
    return json(
      {
        error: 'Only the owner, signed in on their own account, can wipe the farm.',
        code: 'INTERACTIVE_OWNER_ONLY'
      },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'pass {"confirm":"WIPE-EVERYTHING"} to proceed',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }

  const result = wipeAllData({
    keepEquipment: parsed.data.keepEquipment,
    keepWeatherCache: parsed.data.keepWeatherCache
  });
  drainBlobDeletions().catch((err) => console.error('[vault] wipe cleanup failed', err));
  return json(result);
};
