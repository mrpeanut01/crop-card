import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { carePlanCreateSchema } from '$lib/animals/carePlanApiSchemas';
import { listCarePlansForSubject } from '$lib/db/animalCarePlans';
import { requireOwner, requireUser } from '$lib/server/auth';
import { parseBody } from '$lib/server/animals';
import { careRouteSubject } from '$lib/server/careSubject';
import { createCarePlan } from '$lib/server/carePlans';

export const _requestSchema = carePlanCreateSchema;

const notFound = (locale?: string | null) =>
  json({ error: t(locale, 'animallib.api.subjectNotFound') }, { status: 404 });

/** Care plans of an animal or a group. Anyone on the farm can read them. */
export const GET: RequestHandler = (event) => {
  requireUser(event);
  const subject = careRouteSubject(event.params.id);
  if (!subject) return notFound(event.locals?.locale);
  return json({ plans: listCarePlansForSubject(subject.subjectType, subject.subjectId) });
};

/** Owner only. With no due date and no last date the plan is saved
 *  undated and waits for the owner ("ask your vet"). */
export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  const subject = careRouteSubject(event.params.id);
  if (!subject) return notFound(event.locals?.locale);
  if (!subject.active) {
    return json(
      { error: t(event.locals?.locale, 'animallib.api.notActive'), code: 'NOT_ACTIVE' },
      { status: 409 }
    );
  }
  const body = await parseBody(event.request, carePlanCreateSchema);
  if (!body.ok) return body.response;
  const plan = createCarePlan(subject.subjectType, subject.subjectId, body.data);
  return json({ plan }, { status: 201 });
};
