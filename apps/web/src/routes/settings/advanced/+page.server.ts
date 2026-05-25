/**
 * Phase 25c (#88) — /settings/advanced loader.
 *
 * Power-user surfaces:
 *   - Types taxonomy (currently in /settings/system Types tab)
 *   - Inventory maintenance — short-name regen (in /settings/system)
 *   - API tokens (folded in from /settings/api-tokens)
 *   - Danger zone (currently in /settings/system Danger Zone tab)
 *
 * This page is the navigational landing — the actual forms still live
 * at /settings/system + /settings/api-tokens until they get migrated.
 * Folding them visually keeps the 11-card IA intact.
 */

import { error, redirect, type ServerLoad } from '@sveltejs/kit';
import { listStockItems } from '$lib/db/stock';
import { listTokensForOwner } from '$lib/server/apiTokens';

export const load: ServerLoad = ({ locals }) => {
  if (!locals.user) throw redirect(303, '/');
  if (locals.user.role !== 'owner') throw error(403, 'owner-only');

  const stockItems = listStockItems();
  const ownerId = locals.user.activeOwnerId;
  return {
    stockItemCount: stockItems.length,
    apiTokenCount: ownerId ? listTokensForOwner(ownerId).length : 0
  };
};
