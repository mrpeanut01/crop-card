import { json, type RequestHandler } from '@sveltejs/kit';
import { healthRecordSchema } from '$lib/animals/recordApiSchemas';
import { requireMutator } from '$lib/server/auth';
import { withClientRecordId } from '$lib/server/clientRecordId';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';
import { parseBody } from '$lib/server/animals';
import {
  healthRecordResponse,
  prepareHealthRecord,
  writeHealthRecord
} from '$lib/server/healthRecordWrite';

export const _requestSchema = healthRecordSchema;

/**
 * Owners and helpers record treatments, vaccinations, deworms, vet visits,
 * injuries and notes. Treatments always save (Q2): the kernel's withdrawal
 * verdict is stored with `rules_version`, and the hold it puts on meat, milk
 * and eggs is enforced where food is declared. Replayable from the offline
 * queue. A care task closed with a treatment writes through the same
 * `writeHealthRecord` (32D).
 */
export const POST: RequestHandler = withClientRecordId(async (event) => {
  const user = requireMutator(event);
  const body = await parseBody(event.request, healthRecordSchema, event.locals?.locale);
  if (!body.ok) return body.response;
  const ready = await prepareHealthRecord(event, user, body.data);
  if (!ready.ok) return ready.response;
  const { prepared } = ready;
  const guarded = await tryGuardedHoldWrite(event, user, () => writeHealthRecord(prepared), {
    dated: true
  });
  if (!guarded.ok) return guarded.response;
  return json(healthRecordResponse(prepared, guarded.value), { status: 201 });
});
