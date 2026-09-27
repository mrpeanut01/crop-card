import { json, type RequestHandler } from '@sveltejs/kit';
import { animalStatusSchema } from '$lib/animals/apiSchemas';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { requireMutator } from '$lib/server/auth';
import { withClientRecordId } from '$lib/server/clientRecordId';
import { assertAnimalSubject, firstUnknownRef } from '$lib/server/foreignRefs';
import { writeRecord } from '$lib/server/recordWrite';
import { parseBody, recordStatus, ruleResponse, unknownSubjectMessage } from '$lib/server/animals';

export const _requestSchema = animalStatusSchema;

/** Owners and helpers record a death, sale, cull or rehoming, a correction
 *  back to `active`, or a group addition. */
export const POST: RequestHandler = withClientRecordId(async (event) => {
  const user = requireMutator(event);
  const body = await parseBody(event.request, animalStatusSchema);
  if (!body.ok) return body.response;
  const input = body.data;
  if (firstUnknownRef(assertAnimalSubject('subjectId', input.subjectType, input.subjectId))) {
    return json({ error: unknownSubjectMessage, code: 'UNKNOWN_SUBJECT' }, { status: 400 });
  }
  try {
    const result = writeRecord(event, () =>
      recordStatus(input, {
        recordedBy: user.id,
        clientRecordId: event.request.headers.get(CLIENT_RECORD_HEADER)
      })
    );
    return json(result, { status: 201 });
  } catch (e) {
    return ruleResponse(e);
  }
});
