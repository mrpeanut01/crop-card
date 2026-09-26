/**
 * Server-side plugin registry singleton.
 *
 * Lazy-loads the repo's `plugins/` directory on first access. Subsequent
 * calls return the same registry instance — no rebuild on every request.
 *
 * Server-only import; never expose to client bundles.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dev } from '$app/environment';
import { loadPluginsFromDirectory, PluginRegistry } from '$lib/plugins';
import { isTestPluginId } from '$lib/plugins/testPlugins';
import { currentOwnerId } from '$lib/db/tenant';
import { HIDDEN_PAYLOAD, listEffectiveOverrides, overridesRevision } from '$lib/db/pluginOverrides';

let cached: { registry: PluginRegistry; loadedAt: number; failures: string[] } | null = null;
const ownerViews = new Map<string, { key: string; registry: PluginRegistry }>();

function pluginsDir(): string {
  // In dev: /app/plugins (compose mount). In prod: alongside the build dir.
  // PLUGINS_DIR env var lets ops pin a different path.
  if (process.env.PLUGINS_DIR) return process.env.PLUGINS_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/lib/server → apps/web → repo root → plugins
  return path.resolve(here, '../../../../../plugins');
}

/** The active Owner's view: the shared library with that Owner's
 *  `plugin_overrides` applied (retired ids hidden, own uploads replacing
 *  same-id plugins). Outside a tenant context, the shared library. */
export async function getRegistry(): Promise<PluginRegistry> {
  const base = await getBaseRegistry();
  const ownerId = currentOwnerId();
  if (!ownerId || !cached) return base;
  const revision = overridesRevision(ownerId);
  if (revision === 0) return base;
  const key = `${cached.loadedAt}:${revision}`;
  const hit = ownerViews.get(ownerId);
  if (hit && hit.key === key) return hit.registry;
  const hidden: string[] = [];
  const payloads: unknown[] = [];
  for (const o of listEffectiveOverrides().values()) {
    if (o.payloadJson === HIDDEN_PAYLOAD) hidden.push(o.pluginId);
    else payloads.push(JSON.parse(o.payloadJson));
  }
  const { registry, failures } = base.withOverlay(hidden, payloads);
  if (failures.length > 0) {
    console.warn(`[registry] owner ${ownerId}: plugin overrides rejected`, failures);
  }
  ownerViews.set(ownerId, { key, registry });
  return registry;
}

/** Click-through test fixtures stay out of real farms' lists. */
function showTestPlugins(): boolean {
  return dev || process.env.VITEST === 'true' || process.env.SHOW_TEST_PLUGINS === '1';
}

/** The shared plugin library, ignoring every Owner's overrides. Global
 *  (superadmin) library operations validate against this. */
export async function getBaseRegistry(): Promise<PluginRegistry> {
  if (cached) return cached.registry;
  const loaded = new PluginRegistry();
  const result = await loadPluginsFromDirectory(loaded, pluginsDir());
  const registry = showTestPlugins()
    ? loaded
    : loaded.withOverlay(
        loaded
          .all()
          .map((r) => r.plugin.pluginId)
          .filter(isTestPluginId),
        []
      ).registry;
  cached = {
    registry,
    loadedAt: Date.now(),
    failures: result.failed.map((f) => `${path.basename(f.file)}: ${f.error.message}`)
  };
  if (cached.failures.length > 0) {
    console.warn('[registry] some plugins failed to load:', cached.failures);
  }
  return registry;
}

export function getRegistryStats(): { loadedAt?: number; failures: string[] } {
  if (!cached) return { failures: [] };
  return { loadedAt: cached.loadedAt, failures: cached.failures };
}

/** Force a full reload of the registry on next getRegistry() call. Used by
 *  the plugin authoring + upload flows after writing a new file to disk. */
export function resetRegistry(): void {
  cached = null;
  ownerViews.clear();
}
