/**
 * Phase 25c (#88) — /settings index loader.
 *
 * Rebuilt to match the canonical mockup at
 * `docs/design/almanac/direction-almanac-pages.jsx` ASettingsScreen
 * (hero identity card + featured AI assistant + 2-column section
 * grid + cream advanced-diagnostics footer).
 *
 * Surfaces real data wherever available + sensible fallbacks for
 * fields the app doesn't track yet (last-sign-in time, plugin
 * failures, backup time).
 */

import { error, type ServerLoad } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { owners, users, aiCallLog } from '$lib/db/schema';
import { eq, gte, count, sql } from 'drizzle-orm';
import { listBlocks } from '$lib/db/blocks';
import { listEquipment } from '$lib/db/equipment';
import { listStockItems } from '$lib/db/stock';
import { usersForOwner } from '$lib/db/users';
import { listInvitesForOwner } from '$lib/server/invites';
import { listTokensForOwner } from '$lib/server/apiTokens';
import { spendSnapshot } from '$lib/server/aiGuard';
import { RULES_VERSION } from '$lib/safety/version';
import { getRegistry } from '$lib/server/registry';
import { getApiKey } from '$lib/server/scanResult';

const DAY_MS = 86_400_000;
const MONTH_MS = 30 * DAY_MS;

export const load: ServerLoad = async ({ locals }) => {
  if (!locals.user) throw error(401, 'sign-in required');
  const isOwner = locals.user.role === 'owner';
  const ownerId = locals.user.activeOwnerId;

  const userRow = db.select().from(users).where(eq(users.id, locals.user.id)).get();
  const ownerRow = ownerId ? db.select().from(owners).where(eq(owners.id, ownerId)).get() : null;

  // ─── Counts for the section subtitles ───────────────────────────────
  const blocks = listBlocks();
  const equipment = listEquipment({ type: 'sprayer' });
  const stock = listStockItems();
  const helpers = ownerId ? usersForOwner(ownerId) : [];
  const invites = ownerId ? listInvitesForOwner(ownerId) : [];
  const tokens = ownerId ? listTokensForOwner(ownerId) : [];

  const pendingInvites = invites.filter((i) => i.status === 'pending').length;

  const dirtySprayers = equipment.filter(
    (e) =>
      e.state.lastChemistryClass != null &&
      ['synthetic-auxin', 'sulfonylurea', 'imidazolinone'].includes(e.state.lastChemistryClass)
  ).length;

  // ─── Plugins — counts + failures ────────────────────────────────────
  const registry = await getRegistry();
  const allPlugins = registry.all();
  // Future: surface registry.failures() if we add a load-failure log;
  // today the loader filters before populating.

  // ─── AI snapshot (owner-only fields gated below) ────────────────────
  const ai = isOwner ? spendSnapshot() : null;
  const aiKey = isOwner ? getApiKey() : null;
  const aiCallsThisMonth = isOwner
    ? (db
        .select({ n: count() })
        .from(aiCallLog)
        .where(gte(aiCallLog.createdAt, new Date(Date.now() - MONTH_MS)))
        .get()?.n ?? 0)
    : 0;

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
      name: locals.user.email.split('@')[0],
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
      stock: stock.length,
      helpers: helpers.length,
      pendingInvites,
      dirtySprayers,
      apiTokens: tokens.length,
      plugins: allPlugins.length
    },
    ai: ai && {
      enabled: aiKey != null,
      keyMasked: aiKey
        ? `${aiKey.slice(0, 8)}${'•'.repeat(Math.max(0, aiKey.length - 12))}${aiKey.slice(-4)}`
        : null,
      model: 'claude-haiku-4-5',
      spendThisMonth: ai.monthlyUsdSoFar,
      monthlyCapUSD: ai.cap,
      pctUsed: ai.pctUsed,
      warnAt80: ai.warnAt80,
      callsThisMonth: aiCallsThisMonth,
      gatedFeatures: [
        'Allocation refinement chat',
        'Schedule re-derivation (e.g. 3-sisters offsets)',
        'Input plan substitutions',
        "Free-text 'ask the assistant' on Plan v2 + Today"
      ],
      keepWorking: [
        'All five wizard steps run fully manually — drag Gantt bars, click edit, fill forms',
        'Safety kernel + decon + retention logic are local and never call AI',
        `CSV import / export · ${allPlugins.length} plugins · all calendar derivations`
      ]
    },
    advanced: {
      buildVersion: 'phase-25c',
      rulesVersion: RULES_VERSION,
      pluginFailures: 0,
      tenantId: ownerRow?.slug ?? '—',
      lastBackup: 'Litestream · live'
    }
  };
};
