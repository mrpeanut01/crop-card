/**
 * GET    /api/hay/cuttings/:id
 * PATCH  /api/hay/cuttings/:id           — advance / abort the state machine.
 * DELETE not supported — cuttings are immutable history.
 *
 * Sprint E. Bale step is the only one that requires extra payload (bale
 * type + moisture %); the kernel evaluates the moisture gate and refuses
 * baling unless the operator passes `overrideBaleGate: true` on hard fail.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { abortCutting, advanceCutting, getCutting } from '$lib/db/hayCuttings';
import {
  canAdvance,
  evaluateBaleDecision,
  isTerminal,
  nextStep,
  statusAfter,
  type HayOperationsSpec,
  type HayStep
} from '$lib/hay';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { getRegistry } from '$lib/server/registry';
import { checkSeasonClosed } from '$lib/server/seasonClose';
import { getBlock } from '$lib/db/blocks';
import { farmTimeZone } from '$lib/db/userProfile';
import { MAX_FUTURE_SKEW_MS } from '$lib/animals/model';
import { hayCutGate } from '$lib/server/grazingGate';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';
import { LOCK_WINDOW_MS } from '$lib/db/recordKinds';
import { t } from '$lib/i18n';

const patchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('advance'),
    step: z.enum(['mow', 'ted', 'rake', 'bale', 'store']).optional(),
    occurredAt: z.number().int().optional(),
    baleType: z.enum(['small-square', 'large-round', 'large-square']).optional(),
    balesQuantity: z.number().int().nonnegative().optional(),
    baleMoisturePct: z.number().min(0).max(100).optional(),
    overrideBaleGate: z.boolean().optional(),
    notes: z.string().max(500).optional()
  }),
  z.object({
    action: z.literal('abort'),
    reason: z.string().max(500).optional()
  })
]);

export const GET: RequestHandler = ({ params, locals }) => {
  if (!params.id) throw error(400, t(locals?.locale, 'stockui.api.idRequired'));
  const c = getCutting(params.id);
  if (!c) throw error(404, t(locals?.locale, 'api.err.cuttingNotFound'));
  return json({ cutting: c });
};

export const PATCH: RequestHandler = async (event) => {
  if (!event.params.id) throw error(400, t(event.locals?.locale, 'stockui.api.idRequired'));
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.inspectorReadOnly') },
      { status: 403 }
    );
  }

  const cutting = getCutting(event.params.id);
  if (!cutting) throw error(404, t(event.locals?.locale, 'api.err.cuttingNotFound'));
  if (isTerminal(cutting.status)) {
    return json(
      { error: t(event.locals?.locale, 'api.err.cuttingAlready', { status: cutting.status }) },
      { status: 409 }
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
  const parsed = patchSchema.safeParse(body);
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

  if (parsed.data.action === 'abort') {
    const reason = parsed.data.reason;
    const aborted = await tryGuardedHoldWrite(event, auth, () => abortCutting(cutting.id, reason));
    if (!aborted.ok) return aborted.response;
    return json({ cutting: aborted.value });
  }

  // UC-44 — SEASON_CLOSED gate. An advance stamps a dated field operation;
  // refuse it when that date lands inside a closed season.
  const now = Date.now();
  const advanceAt = parsed.data.occurredAt ?? now;
  if (advanceAt > now + MAX_FUTURE_SKEW_MS) {
    return json(
      { error: t(event.locals?.locale, 'api.err.hayStepFuture'), code: 'IN_THE_FUTURE' },
      { status: 400 }
    );
  }
  const seasonClosed = checkSeasonClosed(advanceAt, event.locals?.locale);
  if (seasonClosed) {
    return json(
      { error: seasonClosed.code, message: seasonClosed.message, year: seasonClosed.year },
      { status: 422 }
    );
  }

  // advance — figure out the target step.
  const registry = await getRegistry();
  const cropRecord = registry.get(cutting.cropPluginId);
  if (!cropRecord || cropRecord.plugin.type !== 'crop' || !cropRecord.plugin.hayOperations) {
    return json({ error: t(event.locals?.locale, 'api.err.noHayOperations') }, { status: 500 });
  }
  const spec: HayOperationsSpec = {
    steps: [...cropRecord.plugin.hayOperations.steps],
    weatherWindowDays: cropRecord.plugin.hayOperations.weatherWindowDays,
    cuttingsPerSeason: cropRecord.plugin.hayOperations.cuttingsPerSeason,
    cutIntervalDays: cropRecord.plugin.hayOperations.cutIntervalDays,
    mowTrigger: cropRecord.plugin.hayOperations.mowTrigger,
    baleMoistureGate: cropRecord.plugin.hayOperations.baleMoistureGate,
    storageTempWatchF: cropRecord.plugin.hayOperations.storageTempWatchF
  };

  const proposed: HayStep | null =
    parsed.data.step ?? nextStep(spec.steps as HayStep[], cutting.status);
  if (!proposed) {
    return json({ error: t(event.locals?.locale, 'api.err.noFurtherSteps') }, { status: 409 });
  }
  if (!canAdvance(spec.steps as HayStep[], cutting.status, proposed)) {
    return json(
      {
        error: t(event.locals?.locale, 'api.err.cannotAdvance', {
          from: cutting.status,
          to: proposed
        })
      },
      { status: 409 }
    );
  }

  // Phase 32C (C-28): every step after the mow runs the haying-interval
  // gate again, so hay cut before a spray is not carried through inside it.
  const hayGate = await hayCutGate(
    cutting.blockId,
    getBlock(cutting.blockId)?.fieldId ?? null,
    Math.max(cutting.mowAt ?? 0, Math.min(advanceAt, now)),
    auth?.role ?? 'helper',
    farmTimeZone()
  );
  if (!hayGate.ok) return json(hayGate.body, { status: hayGate.status });

  // Bale gate enforcement.
  if (proposed === 'bale') {
    const decision = evaluateBaleDecision({
      spec,
      baleType: parsed.data.baleType ?? cutting.baleType ?? null!,
      moisturePct: parsed.data.baleMoisturePct ?? cutting.baleMoisturePct
    });
    if (!decision.ok) {
      // #323 — FR-21 / UC-14: a `danger`-severity violation (>dangerAbovePct
      // fire risk, MOISTURE_MISSING, BALE_TYPE_MISSING) is a hard STOP that
      // `overrideBaleGate` CANNOT bypass. The override only clears `warn`
      // severity. This closes the hole where a single boolean skipped the
      // >22% "cannot be bypassed" fire-risk STOP.
      const hardStop = decision.violations.some((v) => v.severity === 'danger');
      if (hardStop) {
        return json(
          {
            error: 'bale gate STOP — danger-severity violation cannot be overridden',
            violations: decision.violations,
            warnings: decision.warnings,
            overridable: false
          },
          { status: 422 }
        );
      }
      if (!parsed.data.overrideBaleGate) {
        return json(
          {
            error: 'bale gate rejected; pass overrideBaleGate:true to record anyway',
            violations: decision.violations,
            warnings: decision.warnings,
            overridable: true
          },
          { status: 422 }
        );
      }
    }
  }

  const targetStatus = proposed === 'store' ? 'complete' : statusAfter(proposed);
  const advance = parsed.data;
  const guarded = await tryGuardedHoldWrite(
    event,
    auth,
    () =>
      advanceCutting(cutting.id, {
        status: targetStatus,
        occurredAt: advance.occurredAt,
        baleType: advance.baleType,
        balesQuantity: advance.balesQuantity,
        baleMoisturePct: advance.baleMoisturePct,
        notes: advance.notes
      }),
    { dated: true }
  );
  if (!guarded.ok) return guarded.response;
  const updated = guarded.value;

  return json({ cutting: updated, advancedTo: proposed });
};

/**
 * DELETE /api/hay/cuttings/:id — hard delete a recorded cutting. Past the
 * FR-09 48-hour lock only the owner can, with `?force=true`.
 */
export const DELETE: RequestHandler = async (eventCtx) => {
  if (!eventCtx.params.id) throw error(400, t(eventCtx.locals?.locale, 'stockui.api.idRequired'));
  const auth = currentUser(eventCtx);
  if (auth && !canMutate(auth.role)) {
    return json(
      { error: t(eventCtx.locals?.locale, 'stockui.api.inspectorReadOnly') },
      { status: 403 }
    );
  }
  const existing = getCutting(eventCtx.params.id);
  if (!existing) throw error(404, t(eventCtx.locals?.locale, 'api.err.cuttingNotFound'));
  const locale = eventCtx.locals?.locale;
  if (Date.now() - (existing.mowAt ?? existing.createdAt) >= LOCK_WINDOW_MS) {
    if (auth?.role !== 'owner') {
      return json(
        { error: t(locale, 'hayui.api.deleteLockedOwnerOnly'), code: 'RECORD_LOCKED' },
        { status: 403 }
      );
    }
    if (eventCtx.url.searchParams.get('force') !== 'true') {
      return json(
        { error: t(locale, 'hayui.api.deleteLockedForce'), code: 'RECORD_LOCKED' },
        { status: 422 }
      );
    }
  }
  const { deleteHayCutting } = await import('$lib/db/admin');
  const id = existing.id;
  const guarded = await tryGuardedHoldWrite(eventCtx, auth, () => deleteHayCutting(id));
  if (!guarded.ok) return guarded.response;
  return json(guarded.value);
};
