import { json, type RequestHandler } from '@sveltejs/kit';
import { animalStatusSchema } from '$lib/animals/apiSchemas';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { prefsFor } from '$lib/db/userProfile';
import { isMeatDeclaration } from '$lib/safety/animalWithdrawal';
import { RULES_VERSION } from '$lib/safety/version';
import { checkFoodUse, latestDoseFor } from '$lib/server/animalFoodGate';
import { formatClearDate } from '$lib/safety/animalWithdrawal';
import { requireMutator } from '$lib/server/auth';
import { withClientRecordId } from '$lib/server/clientRecordId';
import { assertAnimalSubject, firstUnknownRef } from '$lib/server/foreignRefs';
import { guardedHoldWrite } from '$lib/server/holdGuard';
import { meatMoveOrderRefusal } from '$lib/server/animalOrder';
import { meatCutRefusal } from '$lib/server/grazingGate';
import { parseBody, recordStatus, ruleResponse, unknownSubjectMessage } from '$lib/server/animals';

export const _requestSchema = animalStatusSchema;

const CULL_INSTEAD = 'You can still record it as culled, with the meat not used.';

/** Owners and helpers record a death, sale, cull or rehoming, a slaughter or
 *  sale for meat, a correction back to `active`, or a group addition. A
 *  change that declares meat as food runs the withdrawal and grazing
 *  exposure gate first (C-17); nobody can override it. */
export const POST: RequestHandler = withClientRecordId(async (event) => {
  const user = requireMutator(event);
  const body = await parseBody(event.request, animalStatusSchema);
  if (!body.ok) return body.response;
  const input = body.data;
  if (firstUnknownRef(assertAnimalSubject('subjectId', input.subjectType, input.subjectId))) {
    return json({ error: unknownSubjectMessage, code: 'UNKNOWN_SUBJECT' }, { status: 400 });
  }
  const occurredAt = input.occurredAt ?? Date.now();
  const meat = isMeatDeclaration(input.status, input.meatUsed);
  if (meat) {
    const tz = prefsFor(user.id).timeZone;
    const dose = latestDoseFor(input.subjectType, input.subjectId);
    if (dose && occurredAt < dose.atMs) {
      return json(
        {
          error: `${dose.product} was given on ${formatClearDate(dose.atMs, tz)}, after this date, so the ${input.subjectType === 'group' ? 'animals were' : 'animal was'} still alive then. Date it on or after that treatment.`,
          code: 'OUT_OF_ORDER'
        },
        { status: 409 }
      );
    }
    const moved = meatMoveOrderRefusal(input.subjectType, input.subjectId, occurredAt, tz);
    if (moved) return moved.toResponse();
    const cut = await meatCutRefusal(input.subjectType, input.subjectId, occurredAt, tz);
    if (cut) return json(cut, { status: 409 });
    const check = await checkFoodUse({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      food: 'meat',
      use: 'food',
      atMs: occurredAt,
      role: user.role,
      timeZone: tz,
      instead: CULL_INSTEAD
    });
    if (check.stop) {
      return json(
        { ...check.stop, resubmitAs: { status: 'culled', meatUsed: false } },
        { status: 422 }
      );
    }
  }
  try {
    const result = await guardedHoldWrite(
      event,
      user,
      () =>
        recordStatus(
          { ...input, occurredAt },
          {
            recordedBy: user.id,
            clientRecordId: event.request.headers.get(CLIENT_RECORD_HEADER),
            rulesVersion: meat ? RULES_VERSION : null
          }
        ),
      { dated: true }
    );
    return json(result, { status: 201 });
  } catch (e) {
    return ruleResponse(e);
  }
});
