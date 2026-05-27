/**
 * Sprint 9 / Phase 27E (#257) — legacy `/stock` redirect.
 *
 * The unified inventory surface lives at `/inventory` (Phase 27B). The
 * legacy list shell shipped in Phase 25d has been removed; this loader
 * preserves bookmarks and external links by 308-permanent-redirecting
 * to the canonical surface, defaulting to the pesticide tab.
 *
 * Query passthrough: `?category=fertilizer|seed|herbicide|...` is
 * mapped to the new `?type=` taxonomy so `/stock?category=seed`
 * lands on `/inventory?type=seed` rather than the default pesticide tab.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const CATEGORY_TO_TYPE: Record<string, string> = {
  herbicide: 'pesticide',
  insecticide: 'pesticide',
  fungicide: 'pesticide',
  fertilizer: 'fertility',
  seed: 'seed'
};

export const load: PageServerLoad = ({ url }) => {
  const category = url.searchParams.get('category');
  const type = (category && CATEGORY_TO_TYPE[category]) ?? 'pesticide';
  throw redirect(308, `/inventory?type=${type}`);
};
