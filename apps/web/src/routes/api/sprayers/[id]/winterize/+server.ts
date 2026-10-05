/**
 * POST /api/sprayers/:id/winterize (UC-45)
 *
 * Records an end-of-season winterization for a sprayer. Writes one
 * equipment_log row per confirmed wizard step, stamps
 * `equipment_state.winterized_at`, clears chemistry via decon semantics,
 * and nulls calibration so `/calibrate` shows "Uncalibrated" next spring.
 *
 * Owner only: it clears the tank's chemistry and decon state and the
 * calibration, the same safety-state reset that the owner-only decon
 * record makes (Invariant 8), so a helper gets "Ask the owner".
 * Server enforces the timestamp; client cannot fabricate the log history.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireMutator } from '$lib/server/auth';
import { t } from '$lib/i18n';
import { getSprayer, recordWinterization, type WinterizeStep } from '$lib/server/sprayers';

const ALLOWED_KINDS = new Set(['decon', 'maintenance', 'inspection']);

export const POST: RequestHandler = async (event) => {
  const user = requireMutator(event);
  if (user.role !== 'owner') {
    return json(
      { error: t(event.locals?.locale, 'equip.api.winterizeOwnerOnly'), askOwner: true },
      { status: 403 }
    );
  }
  const id = event.params.id;
  if (!id || !getSprayer(id)) {
    return json({ error: t(event.locals?.locale, 'api.errB.unknownSprayerId') }, { status: 404 });
  }

  const body = (await event.request.json().catch(() => ({}))) as {
    steps?: unknown;
  };

  const rawSteps = Array.isArray(body.steps) ? body.steps : [];
  const steps: WinterizeStep[] = [];
  for (const raw of rawSteps) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    const kind = typeof s.kind === 'string' && ALLOWED_KINDS.has(s.kind) ? s.kind : 'maintenance';
    const key = typeof s.key === 'string' && s.key ? s.key : `step-${steps.length + 1}`;
    const label = typeof s.label === 'string' ? s.label : key;
    steps.push({
      key,
      kind: kind as WinterizeStep['kind'],
      label,
      notes: typeof s.notes === 'string' ? s.notes : undefined,
      payload:
        s.payload && typeof s.payload === 'object'
          ? (s.payload as Record<string, unknown>)
          : undefined
    });
  }

  if (steps.length === 0) {
    return json({ error: t(event.locals?.locale, 'api.errB.noWinterizeSteps') }, { status: 400 });
  }

  const updated = recordWinterization(id, steps, { performedById: user.id });
  return json({ sprayer: updated });
};
