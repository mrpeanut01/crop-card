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

export interface LoadResult {
  registered: PluginRecord[];
  failed: { file: string; error: PluginRegistrationError | Error }[];
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

  return { registered, failed };
}

async function collectJsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectJsonFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out.sort();
}
