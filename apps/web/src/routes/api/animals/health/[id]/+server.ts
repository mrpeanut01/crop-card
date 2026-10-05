import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { deleteHealthEvent, evaluateHealthLock, getHealthEvent } from '$lib/db/animalHealth';
import { requireMutator } from '$lib/server/auth';
import { resolveSubject } from '$lib/server/animalRecords';
import { carriesHold } from '$lib/safety/animalWithdrawal';
import { interactiveOwnerRefusal, isInteractiveOwner } from '$lib/server/interactiveOwner';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';

/**
 * Deletes a health record. A record that carries a withdrawal hold can only
 * be removed by the owner (C-19), and on a food-producing subject it locks
 * 48 hours after the dose (FR-09); the owner can still force it with a
 * reason. Every delete leaves a tombstone in `record_deletions`, and a
 * deleted dose keeps its hold unless the owner says it was never given
 * (`neverGiven=true`, C-26), which only the signed-in owner can say.
 * C-35: dropping the hold is a void, so it is only open within 48 hours of
 * entry and needs the owner to confirm the diff (`confirmShorten`).
 */
export const DELETE: RequestHandler = async (event) => {
  const user = requireMutator(event);
  const record = getHealthEvent(event.params.id ?? '');
  if (!record)
    return json(
      { error: t(event.locals?.locale, 'animallib.api.healthNotFound') },
      { status: 404 }
    );
  const subject = resolveSubject(record.subjectType, record.subjectId);
  const holds = carriesHold(record);
  const force = event.url.searchParams.get('force') === 'true';
  const neverGiven = event.url.searchParams.get('neverGiven') === 'true';
  const reason = event.url.searchParams.get('reason')?.trim().slice(0, 500) || null;
  if (neverGiven && user.role === 'owner' && !isInteractiveOwner(event, user)) {
    return interactiveOwnerRefusal();
  }

  if ((holds || force || neverGiven) && user.role !== 'owner') {
    return json(
      {
        error:
          'Only the owner can remove a treatment, because it can change a withdrawal. Ask the owner.',
        code: 'OWNER_ONLY'
      },
      { status: 403 }
    );
  }
  const lockedAt = evaluateHealthLock(record, {
    carriesHold: holds,
    foodProducingNow: subject?.foodProducing ?? true
  });
  if (lockedAt !== undefined && !force) {
    return json(
      {
        error: t(event.locals?.locale, 'api.err.treatmentLocked'),
        code: 'RECORD_LOCKED'
      },
      { status: 409 }
    );
  }
  if (lockedAt !== undefined && !reason) {
    return json(
      { error: t(event.locals?.locale, 'animals.health.reasonLocked'), code: 'REASON_REQUIRED' },
      { status: 400 }
    );
  }
  const guarded = await tryGuardedHoldWrite(
    event,
    user,
    () => deleteHealthEvent(record, { deletedBy: user.id, reason, dosed: !neverGiven }),
    neverGiven
      ? {
          void: {
            recordKind: 'animal-health',
            recordId: record.id,
            createdAtMs: record.createdAt,
            reason: reason ?? 'Never given',
            confirmShorten: event.url.searchParams.get('confirmShorten')
          }
        }
      : {}
  );
  if (!guarded.ok) return guarded.response;
  return json({
    removed: record.id,
    holdKept: holds && !neverGiven
  });
};
