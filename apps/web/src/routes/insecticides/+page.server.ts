/**
 * Phase 25b: `/insecticides` was folded into `/spray/insecticide` as part
 * of the 13→7 nav collapse. Keep the old path as a 308 redirect so any
 * bookmarked deep-links (block=, crop=, task=) survive the move.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
  const target = `/spray/insecticide${url.search}`;
  redirect(308, target);
};
