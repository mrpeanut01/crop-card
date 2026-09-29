import { isInteractiveOwner } from '$lib/server/interactiveOwner';
import { randomUUID } from 'node:crypto';
import { json, type RequestHandler } from '@sveltejs/kit';
import { healthRecordSchema } from '$lib/animals/recordApiSchemas';
import { MAX_FUTURE_SKEW_MS } from '$lib/animals/model';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { insertHealthEvent, type AnimalHealthEvent } from '$lib/db/animalHealth';
import { getStockItem } from '$lib/db/stock';
import { farmTimeZone } from '$lib/db/userProfile';
import { LOCK_WINDOW_MS } from '$lib/db/recordKinds';
import { requireMutator } from '$lib/server/auth';
import { withClientRecordId } from '$lib/server/clientRecordId';
import { assertAnimalSubject, firstUnknownRef, rejectForeignRefs } from '$lib/server/foreignRefs';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';
import { parseBody, unknownSubjectMessage } from '$lib/server/animals';
import {
  coveredRecordsAfter,
  deductHealthStock,
  healthPlugins,
  holdSummaryFor,
  planHealthStock,
  resolveSubject,
  toTreatment,
  type RecordWarning
} from '$lib/server/animalRecords';
import {
  carriesHold,
  computeWithdrawalClear,
  serializeWithdrawalClear
} from '$lib/safety/animalWithdrawal';
import { RULES_VERSION } from '$lib/safety/version';

export const _requestSchema = healthRecordSchema;

/**
 * Owners and helpers record treatments, vaccinations, deworms, vet visits,
 * injuries and notes. Treatments always save (Q2): the kernel's withdrawal
 * verdict is stored with `rules_version`, and the hold it puts on meat, milk
 * and eggs is enforced where food is declared. Replayable from the offline
 * queue.
 */
export const POST: RequestHandler = withClientRecordId(async (event) => {
  const user = requireMutator(event);
  const body = await parseBody(event.request, healthRecordSchema);
  if (!body.ok) return body.response;
  const input = body.data;

  if (firstUnknownRef(assertAnimalSubject('subjectId', input.subjectType, input.subjectId))) {
    return json({ error: unknownSubjectMessage, code: 'UNKNOWN_SUBJECT' }, { status: 400 });
  }
  const foreign = rejectForeignRefs(['stockItemId', input.stockItemId, getStockItem]);
  if (foreign) return foreign;

  const now = Date.now();
  if (input.administeredAt > now + MAX_FUTURE_SKEW_MS) {
    return json(
      { error: 'A treatment cannot be dated in the future.', code: 'IN_THE_FUTURE' },
      { status: 400 }
    );
  }
  const plugins = await healthPlugins();
  if (input.productPluginId && !plugins(input.productPluginId)) {
    return json(
      { error: 'That product is not in the library.', code: 'UNKNOWN_PRODUCT' },
      { status: 400 }
    );
  }
  const subject = resolveSubject(input.subjectType, input.subjectId);
  if (!subject) {
    return json({ error: unknownSubjectMessage, code: 'UNKNOWN_SUBJECT' }, { status: 400 });
  }
  const timeZone = farmTimeZone();
  const confirmsLabel = isInteractiveOwner(event, user);
  const stock = planHealthStock(input, (id) => plugins(id) !== undefined);

  const guarded = await tryGuardedHoldWrite(
    event,
    user,
    () => {
      const id = randomUUID();
      const base = {
        id,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        kind: input.kind,
        productPluginId: stock.productPluginId,
        productName: stock.productName,
        stockProductText: stock.stockProductText,
        stockItemId: stock.stockItemId,
        lotNumber: input.lotNumber ?? null,
        dose: input.dose ?? null,
        doseUnit: input.doseUnit ?? null,
        route: input.route ?? null,
        administeredAt: input.administeredAt,
        courseEndAt: input.courseEndAt ?? null,
        labelUse:
          !confirmsLabel && input.labelUse === 'label' ? 'unknown' : (input.labelUse ?? null),
        vetName: input.vetName ?? null,
        notes: input.notes ?? null,
        foodProducingAtRecord: subject.foodProducing,
        performedById: user.id,
        clientRecordId: event.request.headers.get(CLIENT_RECORD_HEADER),
        createdAt: now
      };
      const draft: AnimalHealthEvent = {
        ...base,
        vetDirectedWithdrawal: null,
        withdrawalClear: null,
        rulesVersion: RULES_VERSION,
        lockedAt: null,
        updatedAt: now
      };
      const treatment = {
        ...toTreatment(draft, { speciesId: subject.speciesId, sex: subject.sex }),
        courseOpen: input.courseOpen === true && !input.courseEndAt
      };
      const clear = computeWithdrawalClear(treatment, plugins, { timeZone });
      const row = insertHealthEvent({
        ...base,
        withdrawalClear: serializeWithdrawalClear(clear),
        rulesVersion: RULES_VERSION
      });
      const stockWarnings = deductHealthStock(stock, {
        eventId: row.id,
        performedById: user.id,
        occurredAt: input.administeredAt
      });
      return { row, clear, stockWarnings };
    },
    { dated: true }
  );
  if (!guarded.ok) return guarded.response;
  const saved = guarded.value;

  const warnings: RecordWarning[] = [...stock.warnings, ...saved.stockWarnings];
  if (!confirmsLabel && input.labelUse === 'label') {
    warnings.push({
      code: 'LABEL_USE_OWNER',
      message:
        'Saved as "not sure" how it was used. Only the owner, signed in, can confirm it was used as the label says.'
    });
  }
  const holds = carriesHold(saved.row);
  const { logs: covered, meat: coveredMeat } = holds
    ? coveredRecordsAfter(
        { subjectType: input.subjectType, subjectId: input.subjectId },
        plugins,
        timeZone
      )
    : { logs: [], meat: [] };
  if (covered.length > 0) {
    warnings.push({
      code: 'LOGS_COVERED',
      message: `${covered.length} earlier ${covered.length === 1 ? 'log was' : 'logs were'} saved as food or for sale inside this hold. If any of these were sold, tell the buyer.`
    });
  }
  if (coveredMeat.length > 0) {
    warnings.push({
      code: 'MEAT_COVERED',
      message: `${coveredMeat.length === 1 ? 'A slaughter or sale for meat was' : `${coveredMeat.length} slaughters or sales for meat were`} already recorded inside this hold. If the meat was sold or given away, tell the buyer.`
    });
  }
  return json(
    {
      event: saved.row,
      withdrawalClear: saved.clear,
      holds: holdSummaryFor(input.subjectType, input.subjectId, plugins, timeZone),
      carriesHold: holds,
      locksOnSave: holds && subject.foodProducing && now - input.administeredAt >= LOCK_WINDOW_MS,
      coveredLogs: covered,
      coveredMeat,
      warnings
    },
    { status: 201 }
  );
});
