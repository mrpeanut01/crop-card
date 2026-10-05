import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { productionPatchSchema } from '$lib/animals/recordApiSchemas';
import {
  declaredFoodUse,
  deleteProductionLog,
  evaluateProductionLock,
  getProductionLog,
  setProductionUse
} from '$lib/db/animalProduction';
import { farmTimeZone } from '$lib/db/userProfile';
import { requireMutator } from '$lib/server/auth';
import { parseBody } from '$lib/server/animals';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';
import { resolveSubject } from '$lib/server/animalRecords';
import {
  gateProduction,
  milkFromMaleRefusal,
  stopResponse,
  warningsFor
} from '$lib/server/animalProductionGate';
import { GATED_USES, isSaferUseChange } from '$lib/safety/animalWithdrawal';
import { RULES_VERSION } from '$lib/safety/version';

export const _requestSchema = productionPatchSchema;

const locked = (locale: string | null | undefined) =>
  json(
    {
      error: t(locale, 'api.err.logLocked'),
      code: 'RECORD_LOCKED'
    },
    { status: 409 }
  );

/**
 * Changes what happened to the eggs or milk (C-07). A change toward
 * discard is never blocked, even on a locked log; any other change runs the
 * withdrawal gate and respects the lock. Each change keeps the previous
 * value in the record trail, and a log once saved as food or for sale keeps
 * that as its declared use, so the owner is still told about it (C-06).
 */
export const PATCH: RequestHandler = async (event) => {
  const user = requireMutator(event);
  const body = await parseBody(event.request, productionPatchSchema, event.locals?.locale);
  if (!body.ok) return body.response;
  const log = getProductionLog(event.params.id ?? '');
  if (!log)
    return json({ error: t(event.locals?.locale, 'animallib.api.logNotFound') }, { status: 404 });
  const { use, reason } = body.data;
  if (log.use === use) return json({ log, warnings: [] });

  const timeZone = farmTimeZone();
  let warnings: ReturnType<typeof warningsFor> = [];
  if (!isSaferUseChange(log.use, use)) {
    const subject = resolveSubject(log.subjectType, log.subjectId);
    if (evaluateProductionLock(log, subject?.foodProducing ?? true) !== undefined)
      return locked(event.locals?.locale);
    const male = milkFromMaleRefusal({ ...log, use });
    if (male) return male;
    const check = await gateProduction({
      ...log,
      use,
      atMs: log.occurredAt,
      role: user.role,
      timeZone
    });
    if (check?.stop) return stopResponse(check.stop);
    warnings = warningsFor(check);
  }
  const guarded = await tryGuardedHoldWrite(event, user, () =>
    setProductionUse(log, use, {
      by: user.id,
      reason: reason ?? null,
      rulesVersion: RULES_VERSION
    })
  );
  if (!guarded.ok) return guarded.response;
  return json({ log: guarded.value, warnings });
};

/** Deletes a log. A food-producing subject's log locks after 48 hours;
 *  only the owner can then remove it, with a reason. Every delete leaves a
 *  tombstone. A log saved as food or for sale, even one changed to
 *  discarded since, that a withdrawal or grazing hold now covers (C-06) is
 *  the record that the buyer has to be told, so only the owner can remove
 *  it. */
export const DELETE: RequestHandler = async (event) => {
  const user = requireMutator(event);
  const log = getProductionLog(event.params.id ?? '');
  if (!log)
    return json({ error: t(event.locals?.locale, 'animallib.api.logNotFound') }, { status: 404 });
  const subject = resolveSubject(log.subjectType, log.subjectId);
  const lockedAt = evaluateProductionLock(log, subject?.foodProducing ?? true);
  const force = event.url.searchParams.get('force') === 'true';
  const reason = event.url.searchParams.get('reason')?.trim().slice(0, 500) || null;
  if (lockedAt !== undefined) {
    if (!force) return locked(event.locals?.locale);
    if (user.role !== 'owner') {
      return json(
        { error: t(event.locals?.locale, 'api.err.lockedLogOwner'), code: 'OWNER_ONLY' },
        { status: 403 }
      );
    }
    if (!reason) {
      return json(
        {
          error: t(event.locals?.locale, 'animallib.api.logReasonLocked'),
          code: 'REASON_REQUIRED'
        },
        { status: 400 }
      );
    }
  }
  const declared = declaredFoodUse(log);
  if (user.role !== 'owner' && GATED_USES.includes(declared)) {
    const check = await gateProduction({
      ...log,
      use: declared,
      atMs: log.occurredAt,
      role: user.role,
      timeZone: farmTimeZone()
    });
    if (check?.stop) {
      return json(
        {
          error:
            'This was saved as food or for sale while a hold was on, so the buyer may need to be told. Only the owner can remove it. Ask the owner.',
          code: 'LOG_UNDER_HOLD'
        },
        { status: 403 }
      );
    }
  }
  const guarded = await tryGuardedHoldWrite(event, user, () =>
    deleteProductionLog(log, { by: user.id, reason, tombstone: true })
  );
  if (!guarded.ok) return guarded.response;
  return json({ removed: log.id });
};
