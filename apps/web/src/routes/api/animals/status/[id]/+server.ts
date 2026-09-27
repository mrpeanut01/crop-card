import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { ruleResponse, undoStatus } from '$lib/server/animals';

/** Owner only: removes the latest status change while it can still change
 *  (a food-producing subject's change locks after 48 hours). */
export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  try {
    return json(undoStatus(event.params.id ?? ''));
  } catch (e) {
    return ruleResponse(e);
  }
};
