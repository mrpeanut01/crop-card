import { z } from 'zod';

/** First-use hint keys shipped in Phase 30 v1. New screens add keys here. */
export const HINT_KEYS = [
  'map_add',
  'map_draw_area',
  'map_filter',
  'garden_designer',
  'designer_scrubber',
  'plan_first_crop',
  'spray_first',
  'cards_offline',
  'soil_test_nudge',
  'alpha_welcome',
  'tip_today',
  'tip_plan',
  'tip_farm_map',
  'tip_designer',
  'tip_spray',
  'tip_scout',
  'tip_harvest',
  'tip_inventory',
  'tip_equipment',
  'tip_calibrate',
  'tip_records',
  'tip_cards',
  'tip_fertility',
  'tip_animals',
  'tip_calendar',
  'tip_site_finder',
  'tip_start_read'
] as const;

export type HintKey = (typeof HINT_KEYS)[number];

/** Beginner tips share the hint store; their keys start with this, and
 *  "Show all tips again" forgets every key that does. */
export const TIP_PREFIX = 'tip_';

export function isTipKey(key: string): boolean {
  return key.startsWith(TIP_PREFIX);
}

/** Keys are short snake_case identifiers. The pattern (rather than the list
 *  above) is what the API accepts, so a client built with a newer key can
 *  still record it against an older server. */
export const hintKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, 'invalid hint key');

/** `POST /api/me/hints`: one key, or a batch flushed from offline. */
export const hintsPostSchema = z.union([
  z.object({ key: hintKeySchema }),
  z.object({ keys: z.array(hintKeySchema).min(1).max(50) })
]);

export const MAX_HINTS_PER_USER = 200;

/** `POST /api/me/beginner-tips`: turn the tips on or off, forget which
 *  tips were dismissed, or both. */
export const beginnerTipsPostSchema = z
  .object({ enabled: z.boolean().optional(), reset: z.literal(true).optional() })
  .strict()
  .refine((v) => v.enabled !== undefined || v.reset === true, {
    message: 'send enabled, reset or both'
  });
