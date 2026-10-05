import { t } from '$lib/i18n';
/**
 * GET  /api/hay/cuttings?blockId=X&year=Y  — list cuttings.
 * POST /api/hay/cuttings                   — create a new cutting (status='mowing').
 *
 * Sprint E (FR-19). Inspector role can read; helper + owner can create.
 * The kernel (lib/hay/engine) re-validates the mow decision when a forecast
 * is supplied; if the kernel rejects, the cutting is still created so the
 * operator can review the override path on /hay.
 *
 * Phase 32C: the haying-interval gate runs first on every Area block
 * (C-21, C-28) and answers 422 GRAZING_* while a label haying interval runs
 * or is unknown. `overrideMowGate` is a weather override and never lifts it.
 */

import { withClientRecordId } from '$lib/server/clientRecordId';
import { closeTaskForRecord } from '$lib/server/recordTaskClose';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';
import { json, type RequestHandler } from '@sveltejs/kit';
import { hayCuttingSchema } from '$lib/records/apiSchemas';
import { getBlock } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { createCutting, listCuttings } from '$lib/db/hayCuttings';
import { ensureSystemUser } from '$lib/db/users';
import { evaluateMowDecision, type ForecastDay } from '$lib/hay';
import { RULES_VERSION } from '$lib/safety/version';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { getRegistry } from '$lib/server/registry';
import { rejectForeignRefs } from '$lib/server/foreignRefs';
import { hayCutGate } from '$lib/server/grazingGate';
import { farmTimeZone } from '$lib/db/userProfile';
import { MAX_FUTURE_SKEW_MS } from '$lib/animals/model';
import { checkSeasonClosed } from '$lib/server/seasonClose';

export const _requestSchema = hayCuttingSchema;
const inputSchema = hayCuttingSchema;

export const GET: RequestHandler = ({ url }) => {
  const blockId = url.searchParams.get('blockId') ?? undefined;
  const yearParam = url.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : undefined;
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  return json({ cuttings: listCuttings({ blockId, year, limit }) });
};

export const POST: RequestHandler = withClientRecordId(async (event) => {
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.inspectorReadOnly') },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidJsonShort') },
      { status: 400 }
    );
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: t(event.locals?.locale, 'stockui.api.invalidRequest'),
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message
        }))
      },
      { status: 400 }
    );
  }

  const foreign = rejectForeignRefs(
    ['blockId', parsed.data.blockId, getBlock],
    ['cropId', parsed.data.cropId, getCrop]
  );
  if (foreign) return foreign;

  const now = Date.now();
  if (parsed.data.mowAt !== undefined && parsed.data.mowAt > now + MAX_FUTURE_SKEW_MS) {
    return json(
      { error: t(event.locals?.locale, 'api.err.mowFuture'), code: 'IN_THE_FUTURE' },
      { status: 400 }
    );
  }
  // UC-44 — SEASON_CLOSED gate. A mow is a dated field record.
  const seasonClosed = checkSeasonClosed(parsed.data.mowAt ?? now);
  if (seasonClosed) {
    return json(
      { error: seasonClosed.code, message: seasonClosed.message, year: seasonClosed.year },
      { status: 422 }
    );
  }
  const hayGate = await hayCutGate(
    parsed.data.blockId,
    getBlock(parsed.data.blockId)?.fieldId ?? null,
    Math.min(parsed.data.mowAt ?? now, now),
    auth?.role ?? 'helper',
    farmTimeZone()
  );
  if (!hayGate.ok) return json(hayGate.body, { status: hayGate.status });

  const registry = await getRegistry();
  const cropRecord = registry.get(parsed.data.cropPluginId);
  if (!cropRecord || cropRecord.plugin.type !== 'crop' || !cropRecord.plugin.hayOperations) {
    return json(
      {
        error: t(event.locals?.locale, 'api.err.hayPluginRequired'),
        cropPluginId: parsed.data.cropPluginId
      },
      { status: 400 }
    );
  }
  const spec = cropRecord.plugin.hayOperations;

  // Kernel mow check (only if forecast supplied — otherwise UI-only flow).
  let mowDecision: ReturnType<typeof evaluateMowDecision> | undefined;
  if (parsed.data.forecast) {
    mowDecision = evaluateMowDecision({
      spec: {
        steps: [...spec.steps],
        weatherWindowDays: spec.weatherWindowDays,
        cuttingsPerSeason: spec.cuttingsPerSeason,
        cutIntervalDays: spec.cutIntervalDays,
        mowTrigger: spec.mowTrigger,
        baleMoistureGate: spec.baleMoistureGate,
        storageTempWatchF: spec.storageTempWatchF
      },
      forecast: parsed.data.forecast as ForecastDay[]
    });
    if (!mowDecision.ok && !parsed.data.overrideMowGate) {
      return json(
        {
          error: 'mow gate rejected; pass overrideMowGate:true to record anyway',
          violations: mowDecision.violations,
          warnings: mowDecision.warnings
        },
        { status: 422 }
      );
    }
  }

  const performer = auth ?? (await ensureSystemUser());
  const occurredAt = parsed.data.mowAt ?? Date.now();
  const year = parsed.data.year ?? new Date(occurredAt).getFullYear();

  const guarded = await tryGuardedHoldWrite(
    event,
    auth,
    () => {
      const persisted = createCutting({
        blockId: parsed.data.blockId,
        cropId: parsed.data.cropId,
        cropPluginId: parsed.data.cropPluginId,
        year,
        cuttingNumber: parsed.data.cuttingNumber,
        mowAt: occurredAt,
        weatherForecastJson: parsed.data.forecast
          ? JSON.stringify(parsed.data.forecast)
          : undefined,
        performedById: performer.id,
        rulesVersion: RULES_VERSION,
        notes: parsed.data.notes
      });

      const taskClose = closeTaskForRecord({
        taskId: parsed.data.taskId,
        record: {
          blockId: parsed.data.blockId,
          cropId: parsed.data.cropId,
          cropPluginId: parsed.data.cropPluginId
        },
        eventTable: 'hay_cutting',
        eventId: persisted.id,
        occurredAt
      });
      return { persisted, taskClose };
    },
    { dated: true }
  );
  if (!guarded.ok) return guarded.response;
  const { persisted, taskClose } = guarded.value;

  return json(
    {
      cutting: persisted,
      mowDecision,
      ruleVersion: RULES_VERSION,
      taskClose
    },
    { status: 201 }
  );
});
