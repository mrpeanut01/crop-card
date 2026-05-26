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
import { getUserAiEnabled } from '$lib/server/aiTry';

export const load: ServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  const methods = parseEnabledMethods(env.STOCK_ADD_METHODS);
  // #250 / CT-ST-009 — Invariant 7. The AI-dependent tabs (Scan Label,
  // future AI Photo) render a pre-flight empty-state when no key is
  // configured rather than letting the operator hit a dead-end after
  // capturing a photo. getUserAiEnabled is the canonical resolver
  // shared with the wizard + /today AI variants.
  const aiEnabled = getUserAiEnabled(locals.user.id);
  return {
    methods,
    canEdit: locals.user.role === 'owner',
    aiEnabled
  };
};
