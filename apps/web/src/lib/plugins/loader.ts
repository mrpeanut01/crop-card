/**
 * Filesystem plugin loader.
 *
 * Walks a directory tree (typically the repo's `plugins/` folder), reads
 * every `.json` file, and registers it with a PluginRegistry. Validation
 * and bypass checks happen inside the registry — the loader only handles
 * filesystem traversal and JSON parsing.
 *
 * Server-only. Do NOT import from client code (uses node:fs).
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PluginRegistrationError, PluginRegistry, type PluginRecord } from './registry';
import { unresolvedKeepApartIds } from './companionRelations';
import type { CompanionPlugin } from './schemas';

/** Folders under plugins/ that hold other data kinds with their own
 *  registry pass (bed recipes), not library plugins. */
export const NON_LIBRARY_PLUGIN_DIRS: ReadonlySet<string> = new Set(['bed-recipes']);

export interface LoadResult {
  registered: PluginRecord[];
  failed: { file: string; error: PluginRegistrationError | Error }[];
  /** Loaded, but a companion `keepApart` member names no crop plugin, so
   *  that member never matches. */
  warnings: string[];
}

export async function loadPluginsFromDirectory(
  registry: PluginRegistry,
  rootDir: string
): Promise<LoadResult> {
  const files = await collectJsonFiles(rootDir);
  const registered: PluginRecord[] = [];
  const failed: LoadResult['failed'] = [];

  for (const file of files) {
    try {
      const raw = await readFile(file, 'utf-8');
      const parsed = JSON.parse(raw);
      registered.push(registry.register(parsed));
    } catch (error) {
      failed.push({
        file,
        error: error instanceof Error ? error : new Error(String(error))
      });
    }
  }

  const warnings = unresolvedKeepApartIds(
    registry
      .all()
      .map((r) => r.plugin)
      .filter((p): p is CompanionPlugin => p.type === 'companion'),
    (id) => registry.get(id)?.plugin.type === 'crop'
  ).map((u) => `${u.pluginId}: keepApart member '${u.cropPluginId}' is not a crop plugin`);

  return { registered, failed, warnings };
}

export async function collectJsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // `_retired/` (pluginLifecycle's soft-retire target) and any other
      // `_`-prefixed directory are parked plugins, not part of the library.
      if (entry.name.startsWith('_')) continue;
      if (NON_LIBRARY_PLUGIN_DIRS.has(entry.name)) continue;
      out.push(...(await collectJsonFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out.sort();
}
