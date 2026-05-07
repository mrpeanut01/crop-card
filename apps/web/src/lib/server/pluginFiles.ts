/**
 * Filesystem-side plugin authoring helper. Writes a validated plugin JSON
 * file under plugins/{type}s/ and returns the relative path. Re-loads the
 * registry afterward so the new plugin is queryable immediately.
 *
 * Server-only.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginRegistrationError, PluginRegistry, type Plugin, pluginSchema } from '$lib/plugins';
import { getRegistry, resetRegistry } from './registry';

export class PluginAuthorError extends Error {
  constructor(
    message: string,
    readonly code: 'schema' | 'bypass',
    readonly issues: { path: string; message: string }[]
  ) {
    super(message);
    this.name = 'PluginAuthorError';
  }
}

function pluginsRoot(): string {
  if (process.env.PLUGINS_DIR) return process.env.PLUGINS_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../../../../plugins');
}

function subdirFor(type: Plugin['type']): string {
  // Match the existing convention: plural folders.
  switch (type) {
    case 'crop':
      return 'crops';
    case 'herbicide':
      return 'herbicides';
    case 'insecticide':
      return 'insecticides';
    case 'companion':
      return 'companions';
  }
}

export async function writePluginFile(
  plugin: unknown
): Promise<{ path: string; pluginId: string }> {
  const parsed = pluginSchema.safeParse(plugin);
  if (!parsed.success) {
    throw new PluginAuthorError(
      'plugin failed schema validation',
      'schema',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    );
  }
  const data = parsed.data;

  // Dry-run register against a clone of the live registry so the bypass
  // check fires with full crop-family context. If it throws, we never touch
  // disk — no orphan files.
  const live = await getRegistry();
  const probe = new PluginRegistry();
  for (const r of live.all()) {
    if (r.plugin.pluginId !== data.pluginId) probe.register(r.plugin);
  }
  try {
    probe.register(data);
  } catch (err) {
    if (err instanceof PluginRegistrationError) {
      throw new PluginAuthorError(err.message, 'bypass', err.issues);
    }
    throw err;
  }

  const dir = path.join(pluginsRoot(), subdirFor(data.type));
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${data.pluginId}.json`);
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  resetRegistry();
  return { path: filePath, pluginId: data.pluginId };
}
