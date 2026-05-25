/**
 * Phase 25c (#88) — /settings/advanced loader.
 *
 * Diagnostics (build/rules/tenant/backup) + bulk-export menu + danger
 * zone landing. Matches the canonical mockup at
 * `docs/design/almanac/direction-almanac-settings.jsx` ASettingsAdvancedScreen.
 */

import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { listStockItems } from '$lib/db/stock';
import { listTokensForOwner } from '$lib/server/apiTokens';
import { RULES_VERSION } from '$lib/safety/version';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) throw redirect(303, '/');
  if (locals.user.role !== 'owner') throw error(403, 'owner-only');

  const ownerId = locals.user.activeOwnerId;
  const ownerRow = ownerId ? db.select().from(owners).where(eq(owners.id, ownerId)).get() : null;

  return {
    stockItemCount: listStockItems().length,
    apiTokenCount: ownerId ? listTokensForOwner(ownerId).length : 0,
    advanced: {
      buildVersion: 'phase-25c',
      rulesVersion: RULES_VERSION,
      pluginFailures: 0,
      tenantId: ownerRow?.slug ?? ownerRow?.id ?? '—',
      lastBackup: 'Litestream · live'
    }
  };
};
