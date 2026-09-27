import { json, type RequestHandler } from '@sveltejs/kit';
import { withdrawalEntrySchema } from '$lib/animals/recordApiSchemas';
import { getHealthEvent, saveWithdrawalEntries } from '$lib/db/animalHealth';
import { prefsFor } from '$lib/db/userProfile';
import { requireOwner } from '$lib/server/auth';
import { parseBody } from '$lib/server/animals';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';
import { interactiveOwnerRefusal, isInteractiveOwner } from '$lib/server/interactiveOwner';
import {
  healthPlugins,
  holdSummaryFor,
  resolveSubject,
  toTreatment
} from '$lib/server/animalRecords';
import {
  appendWithdrawalEntry,
  checkWithdrawalEntry,
  computeWithdrawalClear,
  serializeWithdrawalEntries,
  type WithdrawalEntry
} from '$lib/safety/animalWithdrawal';

export const _requestSchema = withdrawalEntrySchema;

/**
 * Owner only, signed in (Q11, C-01): not an API token or an impersonation. Appends one withdrawal entry to a treatment: a
 * number read from the label, a vet-directed number, the actual last dose
 * of a course, or the product that proves on-label use. Entries are never
 * edited or removed, so this works on locked records and can only lengthen
 * or resolve a hold, never shorten one the kernel already knows.
 */
export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  if (!isInteractiveOwner(event, user)) return interactiveOwnerRefusal();
  const body = await parseBody(event.request, withdrawalEntrySchema);
  if (!body.ok) return body.response;
  const record = getHealthEvent(event.params.id ?? '');
  if (!record) return json({ error: 'Health record not found.' }, { status: 404 });
  const subject = resolveSubject(record.subjectType, record.subjectId);
  if (!subject) return json({ error: 'Health record not found.' }, { status: 404 });

  const plugins = await healthPlugins();
  const timeZone = prefsFor(user.id).timeZone;
  const now = Date.now();
  const input = body.data;
  const base = { enteredAtMs: now, enteredById: user.id };
  const entry: WithdrawalEntry =
    input.kind === 'course-end'
      ? { ...base, kind: 'course-end', endedAtMs: input.endedAt }
      : { ...base, ...input };

  const treatment = toTreatment(record, { speciesId: subject.speciesId, sex: subject.sex });
  if (treatment.entries === 'invalid') {
    return json(
      {
        error:
          'The withdrawal entries on this record cannot be read. Ask your vet and contact support.',
        code: 'ENTRIES_UNREADABLE'
      },
      { status: 409 }
    );
  }
  const check = checkWithdrawalEntry(entry, treatment, plugins, user.role);
  if (!check.ok) return json({ error: check.message, code: check.code }, { status: 409 });

  const appended = appendWithdrawalEntry(treatment.entries, entry);
  const clear = computeWithdrawalClear({ ...treatment, entries: appended }, plugins, { timeZone });
  const entries = appendWithdrawalEntry(treatment.entries, { ...entry, verdict: clear });
  const guarded = await tryGuardedHoldWrite(
    event,
    user,
    () => saveWithdrawalEntries(record.id, serializeWithdrawalEntries(entries), now),
    { resolvesUnknown: true }
  );
  if (!guarded.ok) return guarded.response;
  const updated = guarded.value;
  return json(
    {
      event: updated,
      withdrawalClear: clear,
      holds: holdSummaryFor(record.subjectType, record.subjectId, plugins, timeZone)
    },
    { status: 201 }
  );
};
