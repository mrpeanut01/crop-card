/**
 * /settings/advanced: app info (build, rules version, plugin counts and
 * load failures) for everyone on the farm, plus the owner's bulk export and
 * danger zone.
 */

import { redirect } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { listStockItems } from '$lib/db/stock';
import { countPlantings, listBlocks } from '$lib/db/blocks';
import { listTokensForOwner } from '$lib/server/apiTokens';
import { getRegistry, getRegistryStats } from '$lib/server/registry';
import { RULES_VERSION } from '$lib/safety/version';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/');
  const isOwner = locals.user.role === 'owner';

  const ownerId = locals.user.activeOwnerId;
  const ownerRow = ownerId ? db.select().from(owners).where(eq(owners.id, ownerId)).get() : null;
  const registry = await getRegistry();
  const stats = getRegistryStats();
  const canSeeFailures = isOwner || locals.user.isSuperadmin === true;

  return {
    isOwner,
    stockItemCount: isOwner ? listStockItems().length : 0,
    apiTokenCount: isOwner && ownerId ? listTokensForOwner(ownerId).length : 0,
    advanced: {
      buildVersion: process.env.BUILD_SHA || 'dev',
      rulesVersion: RULES_VERSION,
      pluginFailures: stats.failures.length,
      tenantId: ownerRow?.slug ?? ownerRow?.id ?? '—',
      lastBackup: 'Litestream · live'
    },
    appData: {
      crops: registry.crops().length,
      herbicides: registry.herbicides().length,
      plugins: registry.all().length,
      blocks: listBlocks({ plantings: 'none' }).length,
      plantings: countPlantings()
    },
    pluginFailureList: canSeeFailures ? stats.failures : []
  };
};
