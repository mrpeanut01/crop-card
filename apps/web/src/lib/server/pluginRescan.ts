/**
 * Bulk rescan of the on-disk plugin catalog.
 *
 * Walks `plugins/{kind}s/*.json`, validates each file via the same Zod
 * + bypass pipeline that `writePluginFile` uses, and writes a new
 * `plugin_versions` row ONLY when the file's content has meaningfully
 * changed against the current row. "Meaningfully changed" is decided
 * by Zod-canonical equality (re-parse both sides through the schema,
 * stringify ignoring `version`, compare) — NOT by byte-level hash of
 * the on-disk text. That isolates real edits from canonicalization
 * drift (field order, applied defaults), which is what produced the
 * spurious v1.0.0 → v1.0.1 history entries when the table was first
 * seeded by `migrate.mjs` with raw-JSON canonicalization.
 *
 * When a real diff is detected:
 *   - the next semver patch is computed if the file's `version` field
 *     doesn't move strictly ahead of the prior row;
 *   - the row is written with that effective version;
 *   - the on-disk file is rewritten so its `version` field matches what
 *     we just persisted (so a follow-up rescan doesn't loop trying to
 *     bump again).
 *
 * After the forward pass, a cleanup pass walks each scanned pluginId's
 * history and collapses adjacent rows that are Zod-canonically equal
 * (i.e. they differ only in serialization, not in content). This is
 * the one-time repair for the spurious-history situation described
 * above; on a healthy catalog it's a no-op.
 *
 * Server-only. Owner-gated at the route layer.
 */

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadPluginsFromDirectory,
  PluginRegistrationError,
  PluginRegistry,
  pluginSchema,
  type Plugin
} from '$lib/plugins';
import {
  appendVersion,
  bumpPatch,
  currentVersionOf,
  deleteVersion,
  historyOf,
  isVersionAhead,
  setSupersededAt
} from '$lib/db/pluginVersions';
import { resetRegistry } from './registry';

export interface RescanFailure {
  file: string;
  error: string;
  issues?: Array<{ path: string; message: string }>;
}

export interface RescanResult {
  totalFilesScanned: number;
  added: string[];
  updated: string[];
  unchanged: number;
  collapsed: string[];
  failed: RescanFailure[];
  ranAt: number;
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

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Strip the `version` field so functional equality isn't masked by
 *  whatever semver the file happens to declare. */
function stripVersion(p: Plugin): string {
  return JSON.stringify({ ...p, version: '' });
}

/** Re-parse a stored payload through Zod so we can compare it to a
 *  freshly-parsed candidate in the same canonical form (matching field
 *  order, defaults applied). Returns null if the stored payload no
 *  longer validates against the current schema — that's a real diff
 *  and the caller should treat it as such. */
function zodReparse(payloadJson: string): Plugin | null {
  try {
    const obj = JSON.parse(payloadJson);
    const r = pluginSchema.safeParse(obj);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export async function rescanPluginsFromDisk(
  options: { changedByUserId?: string } = {}
): Promise<RescanResult> {
  const probe = new PluginRegistry();
  const load = await loadPluginsFromDirectory(probe, pluginsRoot());

  const failed: RescanFailure[] = load.failed.map((f) => {
    const base: RescanFailure = {
      file: path.basename(f.file),
      error: f.error.message
    };
    if (f.error instanceof PluginRegistrationError) {
      base.issues = f.error.issues;
    }
    return base;
  });

  const added: string[] = [];
  const updated: string[] = [];
  let unchanged = 0;

  for (const r of load.registered) {
    const prior = currentVersionOf(r.plugin.pluginId);

    if (!prior) {
      const candidateVersion = r.plugin.version || '1.0.0';
      const payloadForWrite: Plugin = { ...r.plugin, version: candidateVersion };
      const canonical = JSON.stringify(payloadForWrite);
      appendVersion({
        pluginId: r.plugin.pluginId,
        version: candidateVersion,
        kind: r.plugin.type,
        hash: sha256(canonical),
        payloadJson: canonical,
        changedByUserId: options.changedByUserId,
        changeReason: 'rescan: new plugin'
      });
      added.push(r.plugin.pluginId);
      continue;
    }

    // Functional equality via Zod-canonical compare. The prior row may
    // have been serialized with a different canonicalization (raw vs
    // Zod-output), so a naive hash compare would falsely report
    // "changed" on every rescan. Re-parsing both sides through the
    // schema produces matching field order + applied defaults, so the
    // comparison reflects content only.
    const priorCanonical = zodReparse(prior.payloadJson);
    if (priorCanonical && stripVersion(priorCanonical) === stripVersion(r.plugin)) {
      unchanged++;
      continue;
    }

    // Real diff — pick a version, write the row, rewrite the file's
    // version field if we had to auto-bump.
    const candidateVersion = r.plugin.version;
    let effectiveVersion = candidateVersion;
    if (!isVersionAhead(candidateVersion, prior.version)) {
      effectiveVersion = bumpPatch(prior.version);
    }
    const payloadForWrite: Plugin = { ...r.plugin, version: effectiveVersion };
    const canonical = JSON.stringify(payloadForWrite);

    appendVersion({
      pluginId: r.plugin.pluginId,
      version: effectiveVersion,
      kind: r.plugin.type,
      hash: sha256(canonical),
      payloadJson: canonical,
      changedByUserId: options.changedByUserId,
      changeReason: 'rescan: payload changed on disk'
    });

    if (effectiveVersion !== candidateVersion) {
      const fp = path.join(
        pluginsRoot(),
        subdirFor(payloadForWrite.type),
        `${payloadForWrite.pluginId}.json`
      );
      await writeFile(fp, JSON.stringify(payloadForWrite, null, 2) + '\n', 'utf-8');
    }

    updated.push(r.plugin.pluginId);
  }

  // Cleanup pass — collapse the most-recent pair of Zod-canonically
  // equal adjacent rows per plugin. This repairs the spurious v1.0.0
  // → v1.0.1 history rows that the previous rescan implementation
  // wrote when the table was still seeded with raw-canonical payloads.
  // No-op on a healthy catalog. Conservative: one collapse per plugin
  // per call; a subsequent rescan will collapse the next pair if a
  // deeper chain exists.
  const collapsed: string[] = [];
  const scannedIds = new Set(load.registered.map((r) => r.plugin.pluginId));
  for (const pluginId of scannedIds) {
    const rows = historyOf(pluginId);
    for (let i = 0; i < rows.length - 1; i++) {
      const newer = rows[i];
      const older = rows[i + 1];
      const newerCanonical = zodReparse(newer.payloadJson);
      const olderCanonical = zodReparse(older.payloadJson);
      if (
        newerCanonical &&
        olderCanonical &&
        stripVersion(newerCanonical) === stripVersion(olderCanonical)
      ) {
        deleteVersion(newer.id);
        setSupersededAt(older.id, newer.supersededAt ?? null);
        collapsed.push(`${pluginId}: ${newer.version} → ${older.version}`);
        break;
      }
    }
  }

  if (added.length > 0 || updated.length > 0 || collapsed.length > 0) {
    resetRegistry();
  }

  return {
    totalFilesScanned: load.registered.length + load.failed.length,
    added,
    updated,
    unchanged,
    collapsed,
    failed,
    ranAt: Date.now()
  };
}
