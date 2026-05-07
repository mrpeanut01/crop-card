/**
 * GET  /api/hay/cuttings?blockId=X&year=Y  — list cuttings.
 * POST /api/hay/cuttings                   — create a new cutting (status='mowing').
 *
 * Sprint E (FR-19). Inspector role can read; helper + owner can create.
 * The kernel (lib/hay/engine) re-validates the mow decision when a forecast
 * is supplied; if the kernel rejects, the cutting is still created so the
 * operator can review the override path on /hay.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { createCutting, listCuttings } from '$lib/db/hayCuttings';
import { ensureSystemUser } from '$lib/db/users';
import { evaluateMowDecision, type ForecastDay } from '$lib/hay';
import { RULES_VERSION } from '$lib/safety/version';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { getRegistry } from '$lib/server/registry';

const inputSchema = z.object({
  blockId: z.string().min(1),
  cropPluginId: z.string().min(1),
  year: z.number().int().min(1900).max(3000).optional(),
  cuttingNumber: z.number().int().positive().optional(),
  mowAt: z.number().int().optional(),
  forecast: z
    .array(
      z.object({
        date: z.string().min(1),
        popPct: z.number().min(0).max(100),
        highF: z.number(),
        lowF: z.number(),
        windMph: z.number().nonnegative().optional(),
        shortForecast: z.string().optional()
      })
    )
    .optional(),
  /** Set true when the operator chooses to mow despite a kernel "no-go". */
  overrideMowGate: z.boolean().optional(),
  notes: z.string().max(500).optional()
});

export const GET: RequestHandler = ({ url }) => {
  const blockId = url.searchParams.get('blockId') ?? undefined;
  const yearParam = url.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : undefined;
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  return json({ cuttings: listCuttings({ blockId, year, limit }) });
};

export const POST: RequestHandler = async (event) => {
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = inputSchema.safeParse(body);
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

  const registry = await getRegistry();
  const cropRecord = registry.get(parsed.data.cropPluginId);
  if (!cropRecord || cropRecord.plugin.type !== 'crop' || !cropRecord.plugin.hayOperations) {
    return json(
      {
        error: `cropPluginId must reference a crop plugin with hayOperations declared`,
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

  const persisted = createCutting({
    blockId: parsed.data.blockId,
    cropPluginId: parsed.data.cropPluginId,
    year,
    cuttingNumber: parsed.data.cuttingNumber,
    mowAt: occurredAt,
    weatherForecastJson: parsed.data.forecast ? JSON.stringify(parsed.data.forecast) : undefined,
    performedById: performer.id,
    rulesVersion: RULES_VERSION,
    notes: parsed.data.notes
  });

  return json(
    {
      cutting: persisted,
      mowDecision,
      ruleVersion: RULES_VERSION
    },
    { status: 201 }
  );
};
