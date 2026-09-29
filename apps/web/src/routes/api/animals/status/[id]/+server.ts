import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { ruleResponse, undoStatus } from '$lib/server/animals';
import { guardedHoldWrite } from '$lib/server/holdGuard';

/** Owner only: removes the latest status change while it can still change
 *  (a food-producing subject's change locks after 48 hours). */
export const DELETE: RequestHandler = async (event) => {
  const user = requireOwner(event);
  try {
    return json(
      await guardedHoldWrite(event, user, () =>
        undoStatus(event.params.id ?? '', Date.now(), user.id)
      )
    );
  } catch (e) {
    return ruleResponse(e);
  }
};
