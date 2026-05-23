/**
 * Bulk-import library. Walks a directory tree of plugin JSON files,
 * runs each through the Sub-task E scan pipeline, and persists.
 *
 * Idempotent via the (pluginId, hash) dedup in persist.ts — re-running
 * on an unchanged tree imports 0 versions. Edited files produce one new
 * version each; semver promotion lives in the listing.
 *
 * Shared between the CLI (scripts/import-catalog.ts) and the future
 * /admin/import upload route. The caller owns the credential id; the
 * CLI auto-provisions `seed-import` (see ensureSeedImportCredential).
 *
 * NOTE: relative imports (not $lib) so the catalog runs under both
 * tsx (CLI) and SvelteKit (admin upload).
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db';
import { appCredentials } from '../../db/schema';
import type { AppCredential } from '../appCreds';
import { audit } from '../audit';
import { persistVersion } from '../persist';
import { scanUpload, ScannerUnavailableError } from '../scan';

const SUBDIRS = ['crops', 'herbicides', 'insecticides', 'fungicides', 'fertilizers', 'companions'];

export interface PerFileReport {
  path: string;
  verdict: 'imported' | 'deduped' | 'quarantined' | 'rejected' | 'scanner_unavailable' | 'read_error';
  pluginId?: string;
  version?: string;
  hash?: string;
  reasons?: string[];
}

export interface ImportReport {
  rootDir: string;
  credentialId: string;
  startedAt: number;
  finishedAt: number;
  imported: number;
  deduped: number;
  quarantined: number;
  rejected: number;
  scannerUnavailable: number;
  readErrors: number;
  perFile: PerFileReport[];
}

export interface ImportOptions {
  rootDir: string;
  credentialId: string;
  /** Walk only these subdirectories. Defaults to SUBDIRS. */
  subdirs?: string[];
  /** When true, skip persistence — useful for previews. */
  dryRun?: boolean;
}

export async function importCatalog(opts: ImportOptions): Promise<ImportReport> {
  const startedAt = Date.now();
  const root = resolve(opts.rootDir);
  const sub = opts.subdirs ?? SUBDIRS;

  const credential = lookupCredential(opts.credentialId);
  if (!credential) throw new Error(`unknown credential ${opts.credentialId}`);
  if (credential.revokedAt) {
    console.warn(`[import] credential ${credential.id} (${credential.label}) is revoked`);
  }

  const files = await collectJsonFiles(root, sub);
  const perFile: PerFileReport[] = [];
  let imported = 0;
  let deduped = 0;
  let quarantined = 0;
  let rejected = 0;
  let scannerUnavailable = 0;
  let readErrors = 0;

  for (const filePath of files) {
    const rel = relative(root, filePath);
    let bytes: Buffer;
    try {
      bytes = await readFile(filePath);
    } catch (err) {
      readErrors++;
      perFile.push({
        path: rel,
        verdict: 'read_error',
        reasons: [err instanceof Error ? err.message : String(err)]
      });
      continue;
    }
    try {
      const scan = await scanUpload(bytes);
      if (scan.verdict === 'reject') {
        rejected++;
        perFile.push({
          path: rel,
          verdict: 'rejected',
          reasons: scan.rejectReasons
        });
        continue;
      }
      if (!scan.plugin || !scan.hash) {
        rejected++;
        perFile.push({
          path: rel,
          verdict: 'rejected',
          reasons: ['scan returned pass but no plugin payload']
        });
        continue;
      }
      if (opts.dryRun) {
        perFile.push({
          path: rel,
          verdict: scan.verdict === 'quarantine' ? 'quarantined' : 'imported',
          pluginId: scan.plugin.pluginId,
          version: scan.plugin.version,
          hash: scan.hash
        });
        if (scan.verdict === 'quarantine') quarantined++;
        else imported++;
        continue;
      }
      const outcome = persistVersion({
        scan: { ...scan, plugin: scan.plugin, hash: scan.hash },
        credential
      });
      if (outcome.status === 'noChange') {
        deduped++;
        perFile.push({
          path: rel,
          verdict: 'deduped',
          pluginId: outcome.pluginId,
          version: outcome.version,
          hash: outcome.hash
        });
      } else if (outcome.reviewStatus === 'approved') {
        imported++;
        perFile.push({
          path: rel,
          verdict: 'imported',
          pluginId: outcome.pluginId,
          version: outcome.version,
          hash: outcome.hash
        });
      } else {
        quarantined++;
        perFile.push({
          path: rel,
          verdict: 'quarantined',
          pluginId: outcome.pluginId,
          version: outcome.version,
          hash: outcome.hash,
          reasons: outcome.quarantinedByHeuristic
            ? ['prompt-injection heuristic flagged']
            : ['caller is community-tier credential']
        });
      }
    } catch (err) {
      if (err instanceof ScannerUnavailableError) {
        scannerUnavailable++;
        perFile.push({
          path: rel,
          verdict: 'scanner_unavailable',
          reasons: [err.message]
        });
        continue;
      }
      throw err;
    }
  }

  const finishedAt = Date.now();
  const report: ImportReport = {
    rootDir: root,
    credentialId: credential.id,
    startedAt,
    finishedAt,
    imported,
    deduped,
    quarantined,
    rejected,
    scannerUnavailable,
    readErrors,
    perFile
  };
  audit({
    actorType: opts.dryRun ? 'system' : 'app',
    actorId: credential.id,
    action: opts.dryRun ? 'catalog.import.dry_run' : 'catalog.import',
    payload: {
      rootDir: report.rootDir,
      imported,
      deduped,
      quarantined,
      rejected,
      scannerUnavailable,
      readErrors,
      durationMs: finishedAt - startedAt
    }
  });
  return report;
}

/**
 * Auto-provision (or fetch) the `seed-import` credential. Stored with a
 * random unlookable hash so the credential is attribution-only — no
 * Bearer token will ever match it.
 */
export function ensureSeedImportCredential(): AppCredential {
  const db = getDb();
  const existing = db
    .select()
    .from(appCredentials)
    .where(eq(appCredentials.label, 'seed-import'))
    .get();
  if (existing) return rowToCred(existing);
  const id = `cred_seed_import_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const now = new Date();
  // Random 64-byte hex string — no Bearer token will preimage this (256-bit space).
  const unlookableHash = createHash('sha256').update(randomBytes(32)).digest('hex');
  db.insert(appCredentials)
    .values({
      id,
      label: 'seed-import',
      trustLevel: 'trusted',
      credentialHash: unlookableHash,
      createdAt: now,
      requestCount: 0
    })
    .run();
  return {
    id,
    label: 'seed-import',
    trustLevel: 'trusted',
    createdAt: now.getTime(),
    lastUsedAt: null,
    requestCount: 0,
    revokedAt: null
  };
}

function lookupCredential(id: string): AppCredential | null {
  const row = getDb().select().from(appCredentials).where(eq(appCredentials.id, id)).get();
  return row ? rowToCred(row) : null;
}

function rowToCred(row: {
  id: string;
  label: string;
  trustLevel: 'trusted' | 'community';
  createdAt: Date;
  lastUsedAt: Date | null;
  requestCount: number;
  revokedAt: Date | null;
}): AppCredential {
  return {
    id: row.id,
    label: row.label,
    trustLevel: row.trustLevel,
    createdAt: row.createdAt.getTime(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.getTime() : null,
    requestCount: row.requestCount,
    revokedAt: row.revokedAt ? row.revokedAt.getTime() : null
  };
}

async function collectJsonFiles(root: string, subdirs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const sub of subdirs) {
    const dir = join(root, sub);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const full = join(dir, name);
      const s = await stat(full);
      if (s.isFile()) out.push(full);
    }
  }
  // Stable order for deterministic semver promotion across re-runs.
  out.sort();
  return out;
}
