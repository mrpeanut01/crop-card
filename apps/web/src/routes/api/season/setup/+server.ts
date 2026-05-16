/**
 * POST /api/season/setup
 *
 * Saves (upserts) a per-Owner per-year season setup record. Owner-only.
 * Used by the Plan wizard's first step (`SeasonSetupStep.svelte`) and by
 * the standalone /settings/season page.
 *
 * Body: { year: number, philosophy, weedStrategy, pestStrategy,
 *         fertilityApproach, coverCropIntent, sprayCapacity,
 *         transitioningStartedYear?: number | null }
 *
 * Returns: { setup: SeasonSetup }
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireOwner } from '$lib/server/auth';
import { saveSeasonSetup } from '$lib/season/setup';

const bodySchema = z.object({
  year: z.number().int().min(2000).max(3000),
  philosophy: z.enum([
    'conventional',
    'non-gmo',
    'organic-transitioning',
    'certified-organic'
  ]),
  weedStrategy: z.enum([
    'cultivate-first',
    'pre-emergence-ok',
    'post-emergence-ok',
    'no-spray'
  ]),
  pestStrategy: z.enum(['preventive', 'ipm', 'minimal', 'no-spray']),
  fertilityApproach: z.enum([
    'synthetic',
    'compost-amendments',
    'cover-crop-credits',
    'mixed'
  ]),
  coverCropIntent: z.enum(['fall-cereal', 'vetch-clover', 'other', 'none']),
  sprayCapacity: z.enum([
    'backpack-4gal',
    'handheld-25gal',
    'boom-25-plus',
    'none'
  ]),
  transitioningStartedYear: z
    .union([z.number().int().min(1900).max(3000), z.null()])
    .optional()
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
  return json({ setup });
}
