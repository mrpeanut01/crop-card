/**
 * POST /api/season/setup/carry-forward
 *
 * Copies a prior year's season setup into the current year. Owner-only.
 * Surfaced as the "Use last year's answers" button on the Plan wizard
 * Season Setup step.
 *
 * Body: { fromYear: number, toYear: number }
 *
 * Returns: { setup: SeasonSetup | null } — null when fromYear has nothing
 * saved (caller falls through to the empty form).
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireOwner } from '$lib/server/auth';
import { carryForward } from '$lib/season/setup.server';

const bodySchema = z.object({
  fromYear: z.number().int().min(2000).max(3000),
  toYear: z.number().int().min(2000).max(3000)
});

export async function POST(event) {
  requireOwner(event);
  const raw = (await event.request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    error(400, parsed.error.issues[0]?.message ?? 'invalid body');
  }
  const setup = carryForward(parsed.data.fromYear, parsed.data.toYear);
  return json({ setup });
}
