import { json, type RequestHandler } from '@sveltejs/kit';
import { getField } from '$lib/db/fields';
import { animalMoveSchema } from '$lib/animals/apiSchemas';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { requireMutator } from '$lib/server/auth';
import { withClientRecordId } from '$lib/server/clientRecordId';
import {
  assertAnimalSubject,
  firstUnknownRef,
  rejectForeignRefs,
  type ForeignRef
} from '$lib/server/foreignRefs';
import { writeRecord } from '$lib/server/recordWrite';
import {
  applyMove,
  parseBody,
  planMove,
  ruleResponse,
  unknownSubjectMessage
} from '$lib/server/animals';

export const _requestSchema = animalMoveSchema;

/** Owners and helpers log moves. Replayable from the offline queue. The
 *  32C grazing gate runs on the resolved plan, before the write. */
export const POST: RequestHandler = withClientRecordId(async (event) => {
  const user = requireMutator(event);
  const body = await parseBody(event.request, animalMoveSchema);
  if (!body.ok) return body.response;
  const input = body.data;

  if (firstUnknownRef(assertAnimalSubject('subjectId', input.subjectType, input.subjectId))) {
    return json({ error: unknownSubjectMessage, code: 'UNKNOWN_SUBJECT' }, { status: 400 });
  }
  const foreign = rejectForeignRefs(
    ['fieldId', input.fieldId, getField],
    assertAnimalSubject('toGroupId', 'group', input.toGroupId),
    ...(input.animalIds ?? []).map((id): ForeignRef =>
      assertAnimalSubject('animalIds', 'animal', id)
    )
  );
  if (foreign) return foreign;

  try {
    const plan = planMove(input);
    const move = writeRecord(event, () =>
      applyMove(plan, {
        movedBy: user.id,
        clientRecordId: event.request.headers.get(CLIENT_RECORD_HEADER)
      })
    );
    return json({ move }, { status: 201 });
  } catch (e) {
    return ruleResponse(e);
  }
});
