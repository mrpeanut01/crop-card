import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { careRouteSubject } from '$lib/server/careSubject';
import { seedSpeciesCarePlans } from '$lib/server/carePlans';

/** Owner only. Adds the species plugin's care suggestions that are not on
 *  the animal yet, undated until the owner says when each was last done. */
export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  const subject = careRouteSubject(event.params.id);
  if (!subject) return json({ error: 'animal or group not found' }, { status: 404 });
  const added = await seedSpeciesCarePlans(
    subject.subjectType,
    subject.subjectId,
    subject.speciesId
  );
  return json({ added }, { status: added.length > 0 ? 201 : 200 });
};
