/**
 * Phase 25c (#88) — /settings/integrations loader.
 *
 * External-system integrations. Today this is just the Phase 24
 * Bearer-token surface (lets external Claude agents drive /api/**
 * non-interactively). Webhook + provider integrations land in
 * Phase 26 (NEWA weather, FHB forecast, Stripe billing, etc.).
 */

import { error, redirect, type ServerLoad } from '@sveltejs/kit';
import { listTokensForOwner } from '$lib/server/apiTokens';

export const load: ServerLoad = ({ locals }) => {
  if (!locals.user) throw redirect(303, '/');
  if (locals.user.role !== 'owner') throw error(403, 'owner-only');
  const ownerId = locals.user.activeOwnerId;
  return {
    tokenCount: ownerId ? listTokensForOwner(ownerId).length : 0
  };
};
