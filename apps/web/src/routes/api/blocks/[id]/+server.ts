/**
 * DELETE /api/blocks/:id
 *
 * Heavy cascade: deletes all crops on the block (which itself cascades
 * through every event type), then any block-only events / fertility
 * credits / soil tests / tasks, then the block row itself.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { deleteBlockCascade } from '$lib/db/admin';
import { getBlock } from '$lib/db/blocks';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

export const DELETE: RequestHandler = (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  const block = getBlock(event.params.id);
  if (!block) throw error(404, 'block not found');
  return json(deleteBlockCascade(event.params.id));
};
