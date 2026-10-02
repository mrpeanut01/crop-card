/** DELETE /api/blocks/:id/protections/:pid (owner). Hard delete: a cover is
 *  planning data, not a record. */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { getBlock } from '$lib/db/blocks';
import { deleteBlockProtection } from '$lib/db/blockProtections';
import { currentUser, requireOwner } from '$lib/server/auth';

export const DELETE: RequestHandler = (event) => {
  const user = currentUser(event);
  if (user && user.role !== 'owner' && user.role !== 'inspector') {
    return json(
      { error: t(event.locals?.locale, 'climate.cover.err.ownerRemove') },
      { status: 403 }
    );
  }
  requireOwner(event);
  const block = getBlock(event.params.id!);
  if (!block) throw error(404, 'block not found');
  if (!deleteBlockProtection(block.id, event.params.pid!)) throw error(404, 'cover not found');
  return json({ ok: true });
};
