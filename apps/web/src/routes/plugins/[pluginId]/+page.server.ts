import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getRegistry } from '$lib/server/registry';
import { historyOf } from '$lib/db/pluginVersions';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { unscopedQueryNote } from '$lib/db/tenant';

export const load: PageServerLoad = async ({ params, locals }) => {
  const pluginId = params.pluginId;
  if (!pluginId) throw error(404, 'plugin id required');

  const registry = await getRegistry();
  const liveRecord = registry.get(pluginId);
  const history = historyOf(pluginId);

  if (!liveRecord && history.length === 0) {
    throw error(404, `no plugin '${pluginId}' on record`);
  }

  // Lookup map for cross-plugin references (companion good-with, herbicide
  // label-safe crops, etc.). Server-side build keeps the client payload
  // small + avoids hitting the registry over JSON-serialized data.
  const pluginLookup: Record<string, { displayName: string; type: string }> = {};
  for (const r of registry.all()) {
    pluginLookup[r.plugin.pluginId] = {
      displayName: r.plugin.displayName,
      type: r.plugin.type
    };
  }

  unscopedQueryNote('joining changed-by user for plugin history is a global lookup');
  const userIds = Array.from(
    new Set(history.map((r) => r.changedByUserId).filter((id): id is string => !!id))
  );
  const emailMap = new Map<string, string>();
  if (userIds.length > 0) {
    for (const id of userIds) {
      const u = db.select().from(users).where(eq(users.id, id)).get();
      if (u) emailMap.set(u.id, u.email);
    }
  }

  const rows = history.map((r) => ({
    id: r.id,
    version: r.version,
    hash: r.hash,
    changedByEmail: r.changedByUserId ? emailMap.get(r.changedByUserId) : undefined,
    changeReason: r.changeReason,
    diffSummary: r.diffSummary,
    createdAt: r.createdAt,
    supersededAt: r.supersededAt ?? null,
    retiredAt: r.retiredAt ?? null
  }));

  return {
    pluginId,
    live: liveRecord
      ? {
          displayName: liveRecord.plugin.displayName,
          type: liveRecord.plugin.type,
          version: liveRecord.plugin.version,
          hash: liveRecord.hash,
          plugin: liveRecord.plugin
        }
      : null,
    history: rows,
    pluginLookup,
    canEdit: locals.user?.role === 'owner'
  };
};
