/**
 * Phase 25c (#88) — /settings index loader.
 *
 * Rebuilt to match the canonical mockup at
 * `docs/design/almanac/direction-almanac-pages.jsx` ASettingsScreen
 * (hero identity card + 2-column section
 * grid + cream advanced-diagnostics footer).
 *
 * Surfaces real data wherever available + sensible fallbacks for
 * fields the app doesn't track yet (last-sign-in time, plugin
 * failures, backup time).
 */

import { error, type ServerLoad } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { identityName } from '$lib/identity';
import { eq } from 'drizzle-orm';
import { listBlocks } from '$lib/db/blocks';
import { listEquipment } from '$lib/db/equipment';
import { listStockItems } from '$lib/db/stock';
import { usersForOwner } from '$lib/db/users';
import { listInvitesForOwner } from '$lib/server/invites';
import { listTokensForOwner } from '$lib/server/apiTokens';
import { RULES_VERSION } from '$lib/safety/version';
import { getRegistry } from '$lib/server/registry';
import { getApiKey } from '$lib/server/scanResult';

export const load: ServerLoad = async ({ locals }) => {
  if (!locals.user) throw error(401, 'sign-in required');
  const isOwner = locals.user.role === 'owner';
  const ownerId = locals.user.activeOwnerId;

  const userRow = db.select().from(users).where(eq(users.id, locals.user.id)).get();
  const ownerRow = ownerId ? db.select().from(owners).where(eq(owners.id, ownerId)).get() : null;

  // ─── Counts for the section subtitles ───────────────────────────────
  const blocks = listBlocks();
  const equipment = listEquipment().filter((e) => e.retiredAt == null);
  const sprayers = equipment.filter((e) => e.type === 'sprayer');
  const stock = listStockItems();
  const members = ownerId ? usersForOwner(ownerId).filter((a) => a.status === 'active') : [];
  const ownerCount = members.filter((a) => a.roleWithinOwner === 'owner').length;
  const invites = ownerId ? listInvitesForOwner(ownerId) : [];
  const tokens = ownerId ? listTokensForOwner(ownerId) : [];

  const pendingInvites = invites.filter((i) => i.status === 'pending').length;

  const dirtySprayers = sprayers.filter(
    (e) =>
      e.state.lastChemistryClass != null &&
      ['synthetic-auxin', 'sulfonylurea', 'imidazolinone'].includes(e.state.lastChemistryClass)
  ).length;

  // ─── Plugins — counts + failures ────────────────────────────────────
  const registry = await getRegistry();
  const allPlugins = registry.all();
  // Future: surface registry.failures() if we add a load-failure log;
  // today the loader filters before populating.

  const aiEnabled = isOwner && getApiKey() !== '';

  // ─── User identity metadata ─────────────────────────────────────────
  const memberSince = userRow?.createdAt
    ? userRow.createdAt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '—';
  // Last sign-in is the HMAC cookie's issuance time; we don't persist
  // sign-in events as DB rows yet, so use "today" as a placeholder
  // when the user is currently authenticated.
  const lastLogin = `today · ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

  return {
    isOwner,
    user: {
      id: locals.user.id,
      email: locals.user.email,
      role: locals.user.role,
      phone: locals.user.phone,
      name: identityName(locals.user),
      since: memberSince,
      lastLogin,
      // Active sessions — we don't track concurrent sessions yet; the
      // current cookie counts as 1.
      sessions: 1
    },
    owner: ownerRow
      ? {
          id: ownerRow.id,
          name: ownerRow.name,
          slug: ownerRow.slug,
          billingStatus: ownerRow.billingStatus
        }
      : null,
    counts: {
      blocks: blocks.length,
      equipment: equipment.length,
      sprayers: sprayers.length,
      stock: stock.length,
      owners: ownerCount,
      helpers: members.length - ownerCount,
      pendingInvites,
      dirtySprayers,
      apiTokens: tokens.length,
      plugins: allPlugins.length
    },
    aiEnabled,
    advanced: {
      buildVersion: 'phase-25c',
      rulesVersion: RULES_VERSION,
      pluginFailures: 0,
      tenantId: ownerRow?.slug ?? '—',
      lastBackup: 'Litestream · live'
    }
  };
};
