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

export const GET: RequestHandler = ({ params }) => {
  if (!params.id) throw error(400, 'id required');
  const c = getCutting(params.id);
  if (!c) throw error(404, 'cutting not found');
  return json({ cutting: c });
};

export const PATCH: RequestHandler = async (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }

  const cutting = getCutting(event.params.id);
  if (!cutting) throw error(404, 'cutting not found');
  if (isTerminal(cutting.status)) {
    return json({ error: `cutting is already ${cutting.status}` }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid request',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message
        }))
      },
      { status: 400 }
    );
  }

  if (parsed.data.action === 'abort') {
    return json({ cutting: abortCutting(cutting.id, parsed.data.reason) });
  }

  // advance — figure out the target step.
  const registry = await getRegistry();
  const cropRecord = registry.get(cutting.cropPluginId);
  if (!cropRecord || cropRecord.plugin.type !== 'crop' || !cropRecord.plugin.hayOperations) {
    return json({ error: 'crop plugin missing or no hayOperations declared' }, { status: 500 });
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
    return json({ error: 'no further steps in plugin steps[]' }, { status: 409 });
  }
  if (!canAdvance(spec.steps as HayStep[], cutting.status, proposed)) {
    return json({ error: `cannot advance from ${cutting.status} to ${proposed}` }, { status: 409 });
  }

  // Bale gate enforcement.
  if (proposed === 'bale') {
    const decision = evaluateBaleDecision({
      spec,
      baleType: parsed.data.baleType ?? cutting.baleType ?? null!,
      moisturePct: parsed.data.baleMoisturePct ?? cutting.baleMoisturePct
    });
    if (!decision.ok && !parsed.data.overrideBaleGate) {
      return json(
        {
          error: 'bale gate rejected; pass overrideBaleGate:true to record anyway',
          violations: decision.violations,
          warnings: decision.warnings
        },
        { status: 422 }
      );
    }
  }

  const targetStatus = proposed === 'store' ? 'complete' : statusAfter(proposed);
  const updated = advanceCutting(cutting.id, {
    status: targetStatus,
    occurredAt: parsed.data.occurredAt,
    baleType: parsed.data.baleType,
    balesQuantity: parsed.data.balesQuantity,
    baleMoisturePct: parsed.data.baleMoisturePct,
    notes: parsed.data.notes
  });

  return json({ cutting: updated, advancedTo: proposed });
};

/**
 * DELETE /api/hay/cuttings/:id — hard delete a recorded cutting.
 */
export const DELETE: RequestHandler = async (eventCtx) => {
  if (!eventCtx.params.id) throw error(400, 'id required');
  const auth = currentUser(eventCtx);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  const { deleteHayCutting } = await import('$lib/db/admin');
  return json(deleteHayCutting(eventCtx.params.id));
};
