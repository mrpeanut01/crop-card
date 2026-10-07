/**
 * The one writer behind `POST /api/animals/health/record` and a care task
 * closed with a treatment (32D ruling D0-5). `prepareHealthRecord` does the
 * async checks up front; `write` is the synchronous part that runs inside
 * the caller's guarded transaction (`tryGuardedHoldWrite`), and `respond`
 * builds the same answer the health endpoint gives.
 */

import { randomUUID } from 'node:crypto';
import { json, type RequestEvent } from '@sveltejs/kit';
import type { HealthRecordInput } from '$lib/animals/recordApiSchemas';
import { MAX_FUTURE_SKEW_MS } from '$lib/animals/model';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { insertHealthEvent, type AnimalHealthEvent } from '$lib/db/animalHealth';
import { getStockItem, lotNumbersForUse } from '$lib/db/stock';
import { farmTimeZone } from '$lib/db/userProfile';
import { LOCK_WINDOW_MS } from '$lib/db/recordKinds';
import type { AuthenticatedUser } from './auth';
import { isInteractiveOwner } from './interactiveOwner';
import { assertAnimalSubject, firstUnknownRef, rejectForeignRefs } from './foreignRefs';
import { unknownSubjectMessage } from './animals';
import {
  coveredRecordsAfter,
  deductHealthStock,
  healthPlugins,
  holdSummaryFor,
  planHealthStock,
  resolveSubject,
  toTreatment,
  type RecordWarning
} from './animalRecords';
import {
  carriesHold,
  computeWithdrawalClear,
  serializeWithdrawalClear,
  type WithdrawalClear
} from '$lib/safety/animalWithdrawal';
import { RULES_VERSION } from '$lib/safety/version';

export interface SavedHealth {
  row: AnimalHealthEvent;
  clear: WithdrawalClear;
  stockWarnings: RecordWarning[];
}

interface HealthContext {
  input: HealthRecordInput;
  userId: string;
  confirmsLabel: boolean;
  clientRecordId: string | null;
  now: number;
  timeZone: string;
  plugins: Awaited<ReturnType<typeof healthPlugins>>;
  subject: NonNullable<ReturnType<typeof resolveSubject>>;
  stock: ReturnType<typeof planHealthStock>;
}

/** Checked input for one health record, ready to write. */
export interface PreparedHealth {
  readonly ctx: HealthContext;
}

export type PrepareResult =
  { ok: true; prepared: PreparedHealth } | { ok: false; response: Response };

export async function prepareHealthRecord(
  event: Pick<RequestEvent, 'locals' | 'request'>,
  user: AuthenticatedUser,
  input: HealthRecordInput
): Promise<PrepareResult> {
  if (firstUnknownRef(assertAnimalSubject('subjectId', input.subjectType, input.subjectId))) {
    return fail(400, unknownSubjectMessage, 'UNKNOWN_SUBJECT');
  }
  const foreign = rejectForeignRefs(['stockItemId', input.stockItemId, getStockItem]);
  if (foreign) return { ok: false, response: foreign };

  const now = Date.now();
  if (input.administeredAt > now + MAX_FUTURE_SKEW_MS) {
    return fail(400, 'A treatment cannot be dated in the future.', 'IN_THE_FUTURE');
  }
  const plugins = await healthPlugins();
  if (input.productPluginId && !plugins(input.productPluginId)) {
    return fail(400, 'That product is not in the library.', 'UNKNOWN_PRODUCT');
  }
  const subject = resolveSubject(input.subjectType, input.subjectId);
  if (!subject) return fail(400, unknownSubjectMessage, 'UNKNOWN_SUBJECT');
  return {
    ok: true,
    prepared: {
      ctx: {
        input,
        userId: user.id,
        confirmsLabel: isInteractiveOwner(event, user),
        clientRecordId: event.request.headers.get(CLIENT_RECORD_HEADER),
        now,
        timeZone: farmTimeZone(),
        plugins,
        subject,
        stock: planHealthStock(input, (id) => plugins(id) !== undefined, event.locals?.locale)
      }
    }
  };
}

/** The synchronous writes: the event row with the kernel's verdict and the
 *  stock deduction.
 *  @holdWriter (C-35: callers run it inside guardedHoldWrite) */
export function writeHealthRecord(prepared: PreparedHealth): SavedHealth {
  const { input, subject, stock, plugins, timeZone, now, confirmsLabel } = prepared.ctx;
  const base = {
    id: randomUUID(),
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    kind: input.kind,
    productPluginId: stock.productPluginId,
    productName: stock.productName,
    stockProductText: stock.stockProductText,
    stockItemId: stock.stockItemId,
    lotNumber: input.lotNumber ?? stockLotNumber(stock, input.administeredAt),
    dose: input.dose ?? null,
    doseUnit: input.doseUnit ?? null,
    route: input.route ?? null,
    administeredAt: input.administeredAt,
    courseEndAt: input.courseEndAt ?? null,
    labelUse: !confirmsLabel && input.labelUse === 'label' ? 'unknown' : (input.labelUse ?? null),
    vetName: input.vetName ?? null,
    notes: input.notes ?? null,
    foodProducingAtRecord: subject.foodProducing,
    performedById: prepared.ctx.userId,
    clientRecordId: prepared.ctx.clientRecordId,
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
    performedById: prepared.ctx.userId,
    occurredAt: input.administeredAt
  });
  return { row, clear, stockWarnings };
}

/** #745: the lot of the bottle a dose was taken from, when none was typed. */
function stockLotNumber(
  stock: PreparedHealth['ctx']['stock'],
  administeredAt: number
): string | null {
  if (!stock.stockItemId) return null;
  const numbers = lotNumbersForUse({
    stockItemId: stock.stockItemId,
    amount: stock.deduct?.amount ?? null,
    unit: stock.deduct?.unit ?? null,
    occurredAt: administeredAt
  });
  return numbers.length > 0 ? numbers.join(', ').slice(0, 80) : null;
}

/** The health endpoint's 201 body for what `writeHealthRecord` saved. */
export function healthRecordResponse(
  prepared: PreparedHealth,
  saved: SavedHealth
): Record<string, unknown> {
  const { input, subject, stock, plugins, timeZone, now, confirmsLabel } = prepared.ctx;
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
  return {
    event: saved.row,
    withdrawalClear: saved.clear,
    holds: holdSummaryFor(input.subjectType, input.subjectId, plugins, timeZone),
    carriesHold: holds,
    locksOnSave: holds && subject.foodProducing && now - input.administeredAt >= LOCK_WINDOW_MS,
    coveredLogs: covered,
    coveredMeat,
    warnings
  };
}

function fail(status: number, error: string, code: string): PrepareResult {
  return { ok: false, response: json({ error, code }, { status }) };
}
