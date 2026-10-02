import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { carePlanPatchSchema } from '$lib/animals/carePlanApiSchemas';
import { getCarePlan } from '$lib/db/animalCarePlans';
import { farmTimeZone } from '$lib/db/userProfile';
import { requireOwner } from '$lib/server/auth';
import { parseBody } from '$lib/server/animals';
import { careRouteSubject } from '$lib/server/careSubject';
import { editCarePlan, removeCarePlan } from '$lib/server/carePlans';

export const _requestSchema = carePlanPatchSchema;

function planFor(id: string | undefined, planId: string | undefined) {
  const subject = careRouteSubject(id);
  const plan = planId ? getCarePlan(planId) : undefined;
  if (!subject || !plan) return null;
  if (plan.subjectType !== subject.subjectType || plan.subjectId !== subject.subjectId) return null;
  return plan;
}

const notFound = (locale?: string | null) =>
  json({ error: t(locale, 'animallib.api.carePlanNotFound') }, { status: 404 });

/** Owner only. Open tasks of the plan are rewritten from the edit. */
export const PATCH: RequestHandler = async (event) => {
  requireOwner(event);
  const plan = planFor(event.params.id, event.params.planId);
  if (!plan) return notFound(event.locals?.locale);
  const body = await parseBody(event.request, carePlanPatchSchema);
  if (!body.ok) return body.response;
  const input = body.data;
  if (input.lastDoneOn && !(input.intervalDays ?? plan.intervalDays)) {
    return json(
      { error: t(event.locals?.locale, 'animallib.api.noInterval'), code: 'NO_INTERVAL' },
      { status: 400 }
    );
  }
  const updated = editCarePlan(plan, input, farmTimeZone());
  if (!updated) return notFound(event.locals?.locale);
  return json({ plan: updated });
};

/** Owner only. Open tasks end (`plan-ended`); done tasks and the health
 *  records they wrote stay. */
export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  const plan = planFor(event.params.id, event.params.planId);
  if (!plan) return notFound(event.locals?.locale);
  removeCarePlan(plan);
  return json({ deleted: true });
};
