import { lateLabel } from '$lib/records/lateLabel';
import { json, type RequestHandler } from '@sveltejs/kit';
import { productionRecordSchema } from '$lib/animals/recordApiSchemas';
import { MAX_FUTURE_SKEW_MS } from '$lib/animals/model';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { insertProductionLog } from '$lib/db/animalProduction';
import { farmTimeZone } from '$lib/db/userProfile';
import { requireMutator } from '$lib/server/auth';
import { withClientRecordId } from '$lib/server/clientRecordId';
import { assertAnimalSubject, firstUnknownRef } from '$lib/server/foreignRefs';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';
import { parseBody, unknownSubjectMessage } from '$lib/server/animals';
import type { RecordWarning } from '$lib/server/animalRecords';
import {
  daysLate,
  gateProduction,
  milkFromMaleRefusal,
  stopResponse,
  warningsFor
} from '$lib/server/animalProductionGate';
import { RULES_VERSION } from '$lib/safety/version';

export const _requestSchema = productionRecordSchema;

/**
 * Owners and helpers log eggs, milk and weights. Eggs and milk declared as
 * food or for sale run the withdrawal and grazing exposure gate at the
 * moment they were
 * collected (C-05), with no override: a stop answers 422 with
 * `resubmitAs: 'discard'`, and the same count saved as discarded always
 * succeeds. The food_producing flag is not read (C-09). Replayable from the
 * offline queue; a replay that now hits a hold gets the same 422 and waits
 * in the queue, it is never saved as something else.
 */
export const POST: RequestHandler = withClientRecordId(async (event) => {
  const user = requireMutator(event);
  const body = await parseBody(event.request, productionRecordSchema);
  if (!body.ok) return body.response;
  const input = body.data;
  if (firstUnknownRef(assertAnimalSubject('subjectId', input.subjectType, input.subjectId))) {
    return json({ error: unknownSubjectMessage, code: 'UNKNOWN_SUBJECT' }, { status: 400 });
  }
  const now = Date.now();
  const occurredAt = input.occurredAt ?? now;
  if (occurredAt > now + MAX_FUTURE_SKEW_MS) {
    return json(
      { error: 'A log cannot be dated in the future.', code: 'IN_THE_FUTURE' },
      { status: 400 }
    );
  }
  const male = milkFromMaleRefusal(input);
  if (male) return male;
  const timeZone = farmTimeZone();
  const check = await gateProduction({ ...input, atMs: occurredAt, role: user.role, timeZone });
  if (check?.stop) return stopResponse(check.stop);

  const guarded = await tryGuardedHoldWrite(
    event,
    user,
    () =>
      insertProductionLog({
        ...input,
        occurredAt,
        rulesVersion: RULES_VERSION,
        performedById: user.id,
        clientRecordId: event.request.headers.get(CLIENT_RECORD_HEADER),
        createdAt: now,
        convertedFromUse: input.convertedFromUse
      }),
    { dated: true }
  );
  if (!guarded.ok) return guarded.response;
  const log = guarded.value;
  const warnings: RecordWarning[] = warningsFor(check);
  const late = daysLate(occurredAt, now);
  if (late !== null) {
    warnings.push({
      code: 'LOGGED_LATE',
      message: `${lateLabel(true, late)}.`
    });
  }
  return json({ log, warnings }, { status: 201 });
});
