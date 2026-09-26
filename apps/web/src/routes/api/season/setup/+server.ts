/**
 * POST /api/season/setup
 *
 * Saves (upserts) a per-Owner per-year season setup record. Owner-only.
 * Used by the Plan wizard's first step (`SeasonSetupStep.svelte`) and by
 * the standalone /settings/season page.
 *
 * Body: { year: number, philosophy, weedStrategy, pestStrategy,
 *         fertilityApproach, coverCropIntent,
 *         transitioningStartedYear?: number | null }
 *
 * Returns: { setup: SeasonSetup }
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireOwner } from '$lib/server/auth';
import { saveSeasonSetup } from '$lib/season/setup.server';
import { listSprayers } from '$lib/server/sprayers';
import { deriveWinterizeAlerts, startOfSeason } from '$lib/today/winterizeAlert';
import { equipmentIdsActiveBefore } from '$lib/db/equipment';

const bodySchema = z.object({
  year: z.number().int().min(2000).max(3000),
  philosophy: z.enum([
    'conventional',
    'no-till',
    'non-gmo',
    'organic-transitioning',
    'certified-organic'
  ]),
  weedStrategy: z.enum(['cultivate-first', 'pre-emergence-ok', 'post-emergence-ok']),
  pestStrategy: z.enum(['preventive', 'ipm', 'minimal']),
  fertilityApproach: z.enum(['synthetic', 'compost-amendments', 'cover-crop-credits', 'mixed']),
  coverCropIntent: z.enum(['fall-cereal', 'vetch-clover', 'other', 'none']),
  transitioningStartedYear: z.union([z.number().int().min(1900).max(3000), z.null()]).optional()
});

export async function POST(event) {
  requireOwner(event);
  const raw = (await event.request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    error(400, parsed.error.issues[0]?.message ?? 'invalid body');
  }
  const { year, ...fields } = parsed.data;
  const setup = saveSeasonSetup(year, fields);
  // UC-45 — informational (assists, never gates): flag active sprayers that
  // were used this season but not winterized after the prior one so the
  // operator sees the spring reminder right after saving setup.
  const winterizeAlerts = deriveWinterizeAlerts(
    listSprayers(),
    Date.now(),
    equipmentIdsActiveBefore(startOfSeason(Date.now()))
  );
  return json({ setup, winterizeAlerts });
}
