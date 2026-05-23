/**
 * Retire / Unretire / Uninstall flow for plugins (Phase 22 / PR4).
 *
 * Tier 1 — RETIRE (soft, reversible):
 *   - Sets `retired_at = now` on the current `plugin_versions` row.
 *   - Moves the on-disk file from `plugins/<kind>s/<id>.json` to
 *     `plugins/_retired/<kind>s/<id>.json` so the registry stops
 *     surfacing it. Prior superseded rows are untouched, so historical
 *     event replay via `getPluginByHash` keeps working.
 *
 * Tier 2 — UNINSTALL (hard, irreversible):
 *   - Refuses (409) if any event row references the pluginId in its
 *     `pluginHashesJson` — keeps the audit trail intact.
 *   - On accept: deletes the payload-bearing `plugin_versions` rows,
 *     removes the on-disk file (live OR retired location), writes a
 *     tombstone row (empty payload, `change_reason = 'uninstall'`,
 *     `retired_at` set) so we keep an audit record of who uninstalled
 *     what + when.
 *
 * Server-only.
 */

import { mkdir, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { eq, like, sql } from 'drizzle-orm';
import { db } from '$lib/db/client';
import {
  pluginVersions,
  sprayEvents,
  insecticideEvents,
  fungicideEvents,
  crops
} from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';
import {
  currentVersionOf,
  historyOf,
  retire as setRetired,
  unretire as clearRetired,
  type PluginKind
} from '$lib/db/pluginVersions';
import { resetRegistry } from './registry';

export class PluginLifecycleError extends Error {
  constructor(
    message: string,
    readonly code: 'not-found' | 'still-referenced' | 'fs-error',
    readonly references?: ReferenceSummary
  ) {
    super(message);
    this.name = 'PluginLifecycleError';
  }
}

export interface ReferenceSummary {
  sprayEvents: number;
  insecticideEvents: number;
  fungicideEvents: number;
  cropRows: number;
  total: number;
}

function pluginsRoot(): string {
  if (process.env.PLUGINS_DIR) return process.env.PLUGINS_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../../../../plugins');
}

function subdirFor(kind: PluginKind): string {
  switch (kind) {
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

function livePath(kind: PluginKind, pluginId: string): string {
  return path.join(pluginsRoot(), subdirFor(kind), `${pluginId}.json`);
}
function retiredPath(kind: PluginKind, pluginId: string): string {
  return path.join(pluginsRoot(), '_retired', subdirFor(kind), `${pluginId}.json`);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Count event-row references to this pluginId. Uses LIKE on the JSON
 *  column since SQLite doesn't have native JSON object-key probes that
 *  Drizzle exposes; the column is a JSON map of `{pluginId: hash}` so a
 *  substring match on `"pluginId":` is safe and over-counts at worst
 *  (which is the conservative direction for the refusal check). */
export function countReferences(pluginId: string, kind: PluginKind): ReferenceSummary {
  unscopedQueryNote('counting event references for plugin lifecycle is a global lookup');
  const needle = `%"${pluginId}"%`;
  const spray = db
    .select({ n: sql<number>`count(*)` })
    .from(sprayEvents)
    .where(like(sprayEvents.pluginHashesJson, needle))
    .get();
  const insec = db
    .select({ n: sql<number>`count(*)` })
    .from(insecticideEvents)
    .where(like(insecticideEvents.pluginHashesJson, needle))
    .get();
  const fung = db
    .select({ n: sql<number>`count(*)` })
    .from(fungicideEvents)
    .where(like(fungicideEvents.pluginHashesJson, needle))
    .get();
  // Crops carry cropPluginId directly (not a hash map) — relevant only
  // for the 'crop' kind. Filtering by kind keeps the count tight.
  const cropCount =
    kind === 'crop'
      ? (db
          .select({ n: sql<number>`count(*)` })
          .from(crops)
          .where(eq(crops.cropPluginId, pluginId))
          .get()?.n ?? 0)
      : 0;
  const sprayN = Number(spray?.n ?? 0);
  const insecN = Number(insec?.n ?? 0);
  const fungN = Number(fung?.n ?? 0);
  const cropN = Number(cropCount);
  return {
    sprayEvents: sprayN,
    insecticideEvents: insecN,
    fungicideEvents: fungN,
    cropRows: cropN,
    total: sprayN + insecN + fungN + cropN
  };
}

export async function retirePlugin(pluginId: string): Promise<void> {
  const current = currentVersionOf(pluginId);
  if (!current) {
    throw new PluginLifecycleError(`no plugin '${pluginId}' on record`, 'not-found');
  }
  if (current.retiredAt) return; // already retired — no-op

  // Move file from live → _retired. If the file is missing (manual
  // delete out-of-band) we still set the DB flag.
  const from = livePath(current.kind as PluginKind, pluginId);
  const to = retiredPath(current.kind as PluginKind, pluginId);
  if (await fileExists(from)) {
    try {
      await mkdir(path.dirname(to), { recursive: true });
      await rename(from, to);
    } catch (e) {
      throw new PluginLifecycleError(
        `could not move file: ${e instanceof Error ? e.message : String(e)}`,
        'fs-error'
      );
    }
  }
  setRetired(pluginId);
  resetRegistry();
}

export async function unretirePlugin(pluginId: string): Promise<void> {
  const current = currentVersionOf(pluginId);
  if (!current) {
    throw new PluginLifecycleError(`no plugin '${pluginId}' on record`, 'not-found');
  }
  if (!current.retiredAt) return; // already active — no-op

  const from = retiredPath(current.kind as PluginKind, pluginId);
  const to = livePath(current.kind as PluginKind, pluginId);
  if (await fileExists(from)) {
    try {
      await mkdir(path.dirname(to), { recursive: true });
      await rename(from, to);
    } catch (e) {
      throw new PluginLifecycleError(
        `could not restore file: ${e instanceof Error ? e.message : String(e)}`,
        'fs-error'
      );
    }
  }
  clearRetired(pluginId);
  resetRegistry();
}

export interface UninstallResult {
  pluginId: string;
  removedRows: number;
  tombstoneId: string;
}

export async function uninstallPlugin(
  pluginId: string,
  options: { changedByUserId: string }
): Promise<UninstallResult> {
  const current = currentVersionOf(pluginId);
  const history = historyOf(pluginId);
  if (!current && history.length === 0) {
    throw new PluginLifecycleError(`no plugin '${pluginId}' on record`, 'not-found');
  }

  const kind = (current?.kind ?? (history[0]?.kind as PluginKind)) as PluginKind;

  const refs = countReferences(pluginId, kind);
  if (refs.total > 0) {
    throw new PluginLifecycleError(
      `Cannot uninstall '${pluginId}': ${refs.total} event row${refs.total === 1 ? '' : 's'} reference it. Retire it instead so historical records keep working.`,
      'still-referenced',
      refs
    );
  }

  // Remove the on-disk file from wherever it lives.
  const liveTarget = livePath(kind, pluginId);
  const retiredTarget = retiredPath(kind, pluginId);
  for (const f of [liveTarget, retiredTarget]) {
    if (await fileExists(f)) {
      try {
        await unlink(f);
      } catch (e) {
        throw new PluginLifecycleError(
          `could not delete file ${f}: ${e instanceof Error ? e.message : String(e)}`,
          'fs-error'
        );
      }
    }
  }

  // Hard-delete payload-bearing rows; write tombstone.
  const removed = db.delete(pluginVersions).where(eq(pluginVersions.pluginId, pluginId)).run();

  const tombstoneId = randomUUID();
  db.insert(pluginVersions)
    .values({
      id: tombstoneId,
      pluginId,
      version: current?.version ?? history[0]?.version ?? '0.0.0',
      kind,
      hash: '',
      payloadJson: '',
      changedByUserId: options.changedByUserId,
      changeReason: 'uninstall',
      diffSummaryJson: null,
      retiredAt: new Date(Date.now())
    })
    .run();

  resetRegistry();

  return {
    pluginId,
    removedRows: Number(removed.changes ?? 0),
    tombstoneId
  };
}
