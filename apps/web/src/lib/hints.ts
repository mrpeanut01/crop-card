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
  'cards_offline'
] as const;

export type HintKey = (typeof HINT_KEYS)[number];

/** Keys are short snake_case identifiers. The pattern (rather than the list
 *  above) is what the API accepts, so a client built with a newer key can
 *  still record it against an older server. */
export const hintKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, 'invalid hint key');

export const MAX_HINTS_PER_USER = 200;
