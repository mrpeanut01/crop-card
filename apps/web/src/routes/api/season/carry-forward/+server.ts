/**
 * POST /api/season/carry-forward — UC-47 full-data carry-forward.
 *
 * Extends the philosophy-only `/api/season/setup/carry-forward` into
 * whole-operation next-season prep: rotation-aware block suggestions,
 * surviving-stock roll-forward (writes `reason='expiry'` movements when
 * `apply`), planting-template clone (tagged `sourceProvenance='fallback'`),
 * calibration-reset hand-off, and cover-crop N-credit re-key onto actual
 * terminated cover crops.
 *
 * Owner-only (mutations gate at the API layer per Invariant 8). Deterministic
 * — no AI, no RULES_VERSION bump.
 *
 * Body: { fromYear, toYear, apply? } — `apply` defaults to false (dry-run
 * preview). Surfaced from the UC-44 close-out hand-off + /settings/season.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireOwner } from '$lib/server/auth';
import { carryForwardSeasonAsync } from '$lib/season/carryForward.server';

const bodySchema = z.object({
  fromYear: z.number().int().min(2000).max(3000),
  toYear: z.number().int().min(2000).max(3000),
  apply: z.boolean().optional().default(false)
});

export async function POST(event) {
  const user = requireOwner(event);
  const raw = (await event.request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    error(400, parsed.error.issues[0]?.message ?? 'invalid body');
  }
  if (parsed.data.toYear < parsed.data.fromYear) {
    error(400, 'toYear must be >= fromYear');
  }

  const result = await carryForwardSeasonAsync({
    fromYear: parsed.data.fromYear,
    toYear: parsed.data.toYear,
    apply: parsed.data.apply,
    actingUserId: user.id
  });

  return json(result);
}
