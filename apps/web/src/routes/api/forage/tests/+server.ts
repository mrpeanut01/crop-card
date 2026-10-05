/**
 * Forage lab results (Phase 33C, M-58, M-60). POST: owner, helper and
 * custom operator; attaching a lab report is owner only. GET: every role.
 * Online only, free on every plan, never gated by the season close-out.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getBlock } from '$lib/db/blocks';
import { insertForageTest, listForageTests, stockLotCategory } from '$lib/db/forageTests';
import { farmTimeZone } from '$lib/db/userProfile';
import { zonedDayStartMs } from '$lib/exports/dateRange';
import { forageTestCreateSchema } from '$lib/forage/apiSchemas';
import { DEFAULT_PREFS, todayYmd } from '$lib/prefs';
import { requireMutator, requireUser } from '$lib/server/auth';
import { assertHayCutting, assertStockLot, rejectForeignRefs } from '$lib/server/foreignRefs';
import { checkLabReport } from '$lib/server/soilTestDocument';
import { localIssues } from '$lib/server/amendmentRoutes';
import { t } from '$lib/i18n';

export const _requestSchema = forageTestCreateSchema;

function refusal(status: number, error: string, message: string): Response {
  return json({ error, message }, { status });
}

function realDay(ymd: string): { y: number; m: number; d: number } | null {
  const [y, m, d] = ymd.split('-').map(Number);
  const real = new Date(Date.UTC(y, m - 1, d));
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== m - 1 || real.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

export const POST: RequestHandler = async (event) => {
  const user = requireMutator(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return refusal(400, 'INVALID', t(event.locals?.locale, 'stockui.api.invalidJsonShort'));
  }
  const parsed = forageTestCreateSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: t(event.locals?.locale, 'stockui.api.invalidRequest'),
        issues: localIssues(parsed.error.issues, event.locals?.locale).map((i) => ({
          path: i.path.join('.'),
          message: i.message
        }))
      },
      { status: 400 }
    );
  }
  const input = parsed.data;
  if (input.documentId && user.role !== 'owner') {
    return refusal(403, 'OWNER_ONLY', t(event.locals?.locale, 'forage.api.ownerAttach'));
  }
  const foreign = rejectForeignRefs(
    ['blockId', input.blockId, getBlock],
    assertHayCutting('hayCuttingId', input.hayCuttingId),
    assertStockLot('stockLotId', input.stockLotId)
  );
  if (foreign) return foreign;
  if (input.stockLotId && stockLotCategory(input.stockLotId) !== 'feed') {
    return refusal(400, 'NOT_FEED_LOT', t(event.locals?.locale, 'forage.api.notFeedLot'));
  }
  const day = realDay(input.sampledOn);
  if (!day) {
    return json(
      {
        error: t(event.locals?.locale, 'stockui.api.invalidRequest'),
        issues: [{ path: 'sampledOn', message: t(event.locals?.locale, 'amend.api.useRealDate') }]
      },
      { status: 400 }
    );
  }
  const timeZone = farmTimeZone();
  if (input.sampledOn > todayYmd({ ...DEFAULT_PREFS, timeZone })) {
    return refusal(400, 'IN_THE_FUTURE', t(event.locals?.locale, 'amend.api.future'));
  }
  if (input.documentId) {
    const refused = checkLabReport(input.documentId, event.locals?.locale);
    if (refused) return refused;
  }
  const test = insertForageTest({
    blockId: input.blockId ?? null,
    hayCuttingId: input.hayCuttingId ?? null,
    stockLotId: input.stockLotId ?? null,
    sampledAt: zonedDayStartMs(day.y, day.m, day.d, timeZone),
    lab: input.lab ?? null,
    nitrateValue: input.nitrateValue ?? null,
    nitrateUnits: input.nitrateUnits ?? null,
    hcnPpm: input.hcnPpm ?? null,
    labRating: input.labRating ?? null,
    documentId: input.documentId ?? null,
    createdBy: user.id
  });
  return json({ test }, { status: 201 });
};

export const GET: RequestHandler = (event) => {
  requireUser(event);
  const q = event.url.searchParams;
  const blockId = q.get('blockId') ?? undefined;
  const hayCuttingId = q.get('hayCuttingId') ?? undefined;
  const stockLotId = q.get('stockLotId') ?? undefined;
  if (!blockId && !hayCuttingId && !stockLotId) {
    return refusal(400, 'INVALID', t(event.locals?.locale, 'api.err.forageNameSubject'));
  }
  return json(
    { tests: listForageTests({ blockId, hayCuttingId, stockLotId }) },
    { headers: { 'cache-control': 'private, no-store' } }
  );
};
