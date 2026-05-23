/**
 * Filesystem-side plugin authoring helper. Writes a validated plugin JSON
 * file under plugins/{type}s/ and returns the relative path. Re-loads the
 * registry afterward so the new plugin is queryable immediately.
 *
 * Phase 22 — every write also appends a row to `plugin_versions`,
 * superseding the prior current row. The on-disk JSON always reflects
 * the latest row. Byte-identical payloads are a no-op.
 *
 * Server-only.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginRegistrationError, PluginRegistry, type Plugin, pluginSchema } from '$lib/plugins';
import { diffPlugins, type PluginDiff } from '$lib/plugins/diff';
import {
  appendVersion,
  bumpPatch,
  currentVersionOf,
  isVersionAhead,
  type PluginVersionRow
} from '$lib/db/pluginVersions';
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
  switch (type) {
    case 'crop':
      return 'crops';
    case 'herbicide':
      return 'herbicides';
    case 'insecticide':
      return 'insecticides';
    case 'fungicide':
      return 'fungicides';
    case 'fertilizer':
      return 'fertilizers';
    case 'companion':
      return 'companions';
  }
}

function hashPayload(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex');
}

export interface WritePluginResult {
  path: string;
  pluginId: string;
  version: string;
  hash: string;
  noChange: boolean;
  bumped: boolean;
  diff: PluginDiff;
  priorVersion?: string;
}

/**
 * Validate a candidate, dry-run register, write to disk, append a
 * `plugin_versions` row, and reset the registry cache.
 *
 *   - byte-identical payload → no-op (`noChange: true`, no row written)
 *   - new pluginId → first row at candidate.version (default 1.0.0)
 *   - existing pluginId, candidate.version <= current → server auto-bumps
 *     the patch and writes that version (`bumped: true`)
 *   - existing pluginId, candidate.version > current → use as-is
 */
export async function writePluginFile(
  plugin: unknown,
  options: { changedByUserId?: string; changeReason?: string } = {}
): Promise<WritePluginResult> {
  const parsed = pluginSchema.safeParse(plugin);
  if (!parsed.success) {
    throw new PluginAuthorError(
      'plugin failed schema validation',
      'schema',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    );
  }
  const data = parsed.data;

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

  const prior = currentVersionOf(data.pluginId);
  const priorPayload: Plugin | null = prior
    ? (safeParse(prior.payloadJson) as Plugin | null)
    : null;

  if (prior && priorPayload && isSameIgnoringVersion(priorPayload, data)) {
    return {
      path: filePathFor(data),
      pluginId: data.pluginId,
      version: prior.version,
      hash: prior.hash,
      noChange: true,
      bumped: false,
      diff: { addedKeys: [], removedKeys: [], changedKeys: [] },
      priorVersion: prior.version
    };
  }

  const candidateVersion = data.version || '1.0.0';
  let effectiveVersion = candidateVersion;
  let bumped = false;
  if (prior) {
    if (!isVersionAhead(candidateVersion, prior.version)) {
      effectiveVersion = bumpPatch(prior.version);
      bumped = true;
    }
  }

  const payloadForWrite: Plugin = { ...data, version: effectiveVersion };
  const canonical = JSON.stringify(payloadForWrite);
  const hash = hashPayload(canonical);
  const diff = diffPlugins(priorPayload, payloadForWrite);

  appendVersion({
    pluginId: data.pluginId,
    version: effectiveVersion,
    kind: data.type,
    hash,
    payloadJson: canonical,
    changedByUserId: options.changedByUserId,
    changeReason: options.changeReason,
    diffSummary: diff
  });

  const filePath = filePathFor(data);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payloadForWrite, null, 2) + '\n', 'utf-8');
  resetRegistry();

  return {
    path: filePath,
    pluginId: data.pluginId,
    version: effectiveVersion,
    hash,
    noChange: false,
    bumped,
    diff,
    priorVersion: prior?.version
  };
}

function filePathFor(meta: Plugin): string {
  return path.join(pluginsRoot(), subdirFor(meta.type), `${meta.pluginId}.json`);
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Compare two plugins ignoring the `version` field. Used to suppress
 *  re-writes when the operator uploads a byte-identical payload with the
 *  same content but a different version, OR the same version. */
function isSameIgnoringVersion(a: Plugin, b: Plugin): boolean {
  const stripA = JSON.stringify({ ...a, version: '' });
  const stripB = JSON.stringify({ ...b, version: '' });
  return stripA === stripB;
}

/** Used by the rollback endpoint: write a copy of a historical payload as
 *  a new forward version. Reuses the same validate → dry-run → append
 *  pipeline so a rollback cannot bypass schema or safety checks. */
export async function rollbackTo(
  historical: PluginVersionRow,
  options: { changedByUserId: string }
): Promise<WritePluginResult> {
  const payload = JSON.parse(historical.payloadJson) as Plugin;
  return writePluginFile(payload, {
    changedByUserId: options.changedByUserId,
    changeReason: `rollback to ${historical.version}`
  });
}
