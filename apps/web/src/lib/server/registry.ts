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
import { loadPluginsFromDirectory, PluginRegistry } from '$lib/plugins';

let cached: { registry: PluginRegistry; loadedAt: number; failures: string[] } | null = null;

function pluginsDir(): string {
  // In dev: /app/plugins (compose mount). In prod: alongside the build dir.
  // PLUGINS_DIR env var lets ops pin a different path.
  if (process.env.PLUGINS_DIR) return process.env.PLUGINS_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/lib/server → apps/web → repo root → plugins
  return path.resolve(here, '../../../../../plugins');
}

export async function getRegistry(): Promise<PluginRegistry> {
  if (cached) return cached.registry;
  const registry = new PluginRegistry();
  const result = await loadPluginsFromDirectory(registry, pluginsDir());
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
}
