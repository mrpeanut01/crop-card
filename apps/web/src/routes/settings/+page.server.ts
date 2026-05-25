/**
 * Phase 25c (#88) — /settings index loader.
 *
 * Just the minimum needed for the 11-card grid: who the user is, which
 * cards they can see (owner-only ones), and per-card subtitle counts
 * (helpers count, blocks count, plugins count, etc.). Heavy data lives
 * at the subpage loaders.
 */

import { error, type ServerLoad } from '@sveltejs/kit';
import { listBlocks } from '$lib/db/blocks';
import { listEquipment } from '$lib/db/equipment';
import { listStockItems } from '$lib/db/stock';
import { usersForOwner } from '$lib/db/users';
import { spendSnapshot } from '$lib/server/aiGuard';

export const load: ServerLoad = ({ locals }) => {
  if (!locals.user) throw error(401, 'sign-in required');
  const isOwner = locals.user.role === 'owner';
  const ownerId = locals.user.activeOwnerId;

  // Per-card subtitle counts. Most are cheap counts; defer anything
  // expensive to the subpage loader.
  const blockCount = listBlocks().length;
  const equipmentCount = listEquipment().length;
  const stockCount = listStockItems().length;
  const helpersCount = ownerId ? usersForOwner(ownerId).length : 0;
  const ai = isOwner ? spendSnapshot() : null;

  return {
    isOwner,
    user: { email: locals.user.email, role: locals.user.role },
    counts: {
      blocks: blockCount,
      equipment: equipmentCount,
      stock: stockCount,
      helpers: helpersCount,
      aiMonthlyUsd: ai?.monthlyUsdSoFar ?? 0,
      aiMonthlyCapUsd: ai?.cap ?? null
    }
  };
};
