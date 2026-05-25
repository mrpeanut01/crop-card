/**
 * Phase 25d (#89) — /stock/add loader.
 *
 * Resolves the operator-enabled methods from `STOCK_ADD_METHODS` env
 * var (default = manual,search,barcode,label; `photo` reserved for
 * Phase 26). Owner-only mutation gate is enforced at submit time by
 * the underlying /api/stock POST; load is allowed for any logged-in
 * user so helpers can see the surface even though they can't submit.
 */

import { redirect, type ServerLoad } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { parseEnabledMethods } from '$lib/stock/addMethods';

export const load: ServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  const methods = parseEnabledMethods(env.STOCK_ADD_METHODS);
  return {
    methods,
    canEdit: locals.user.role === 'owner'
  };
};
