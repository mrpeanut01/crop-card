/**
 * Phase 25c (#88) — /settings/plugins loader.
 *
 * Summary card for the plugin library: counts by type + recently-
 * updated rows. Browsing + upload + diff land at /plugins (which
 * stays where it is — this is the settings-landing summary that
 * deep-links into the full management UI).
 */

import { error, redirect, type ServerLoad } from '@sveltejs/kit';
import { getRegistry } from '$lib/server/registry';

export const load: ServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/');
  if (locals.user.role !== 'owner') throw error(403, 'owner-only');

  const registry = await getRegistry();
  const all = registry.all();

  const byType = new Map<string, number>();
  for (const r of all) {
    byType.set(r.plugin.type, (byType.get(r.plugin.type) ?? 0) + 1);
  }

  return {
    total: all.length,
    byType: Array.from(byType.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
  };
};
