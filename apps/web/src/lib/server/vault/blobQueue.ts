/**
 * Byte cleanup for the document vault (A-51): the farm-wipe deletion queue
 * (`blob_deletions`) and the orphan sweep. Both are deployment-wide jobs
 * and stop as soon as the deploy handoff fence rises.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { blobDeletions, documents } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';
import { isFenced } from '$lib/server/ops/handoff';
import { VAULT_ROOT_PREFIX, vaultStore, type VaultStore } from './store';

const DAY_MS = 86_400_000;
/** An unreferenced file younger than this may belong to an upload whose row
 *  is about to be written, so the sweep leaves it alone. */
export const ORPHAN_GRACE_MS = DAY_MS;
/** From this many failed attempts on one prefix, each failure is logged as
 *  an error so the alert rules see it. */
export const LOUD_FAILURE_ATTEMPTS = 5;

/** True when a live document row still points at this key. Checked right
 *  before each delete, so a row written after the run started keeps its
 *  file. */
function isLiveKey(key: string): boolean {
  unscopedQueryNote('vault cleanup checks a storage key against every farm');
  return (
    db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.storageKey, key), isNull(documents.deletedAt)))
      .get() !== undefined
  );
}

async function deleteUnreferenced(
  store: VaultStore,
  prefix: string,
  modifiedBefore: number
): Promise<{ deleted: number; leftOver: number; fenced: boolean }> {
  let deleted = 0;
  let leftOver = 0;
  for await (const obj of store.list(prefix)) {
    if (isFenced()) return { deleted, leftOver, fenced: true };
    if (obj.lastModified >= modifiedBefore) continue;
    if (isLiveKey(obj.key)) continue;
    try {
      await store.delete(obj.key);
      deleted++;
    } catch (err) {
      leftOver++;
      console.warn(`[vault] could not delete ${obj.key}: ${(err as Error)?.message ?? err}`);
    }
  }
  return { deleted, leftOver, fenced: false };
}

/**
 * Works the farm-wipe queue. For each queued prefix, deletes every file
 * under it that no live document row points at and that was last written
 * before the wipe was requested; newer files are left to the orphan sweep,
 * so an upload landing during a wipe keeps its file. A prefix that is clear
 * leaves the queue; one that is not is retried next run with `attempts` and
 * `last_error` updated, never dropped.
 */
export async function drainBlobDeletions(
  now: number = Date.now()
): Promise<{ cleared: number; failed: number }> {
  const store = vaultStore();
  if (!store || isFenced()) return { cleared: 0, failed: 0 };
  unscopedQueryNote('the wipe queue is deployment-wide; each row names one farm prefix');
  const queued = db.select().from(blobDeletions).all();
  let cleared = 0;
  let failed = 0;
  for (const row of queued) {
    if (isFenced()) break;
    const before = Math.min(row.requestedAt.getTime(), now);
    let problem: string | null = null;
    try {
      const pass = await deleteUnreferenced(store, row.storagePrefix, before);
      if (pass.fenced) break;
      if (pass.leftOver > 0) problem = `${pass.leftOver} file(s) could not be deleted`;
    } catch (err) {
      problem = (err as Error)?.message ?? String(err);
    }
    if (problem === null) {
      db.delete(blobDeletions).where(eq(blobDeletions.storagePrefix, row.storagePrefix)).run();
      cleared++;
      continue;
    }
    failed++;
    const attempts = row.attempts + 1;
    db.update(blobDeletions)
      .set({ attempts, lastError: problem.slice(0, 500) })
      .where(eq(blobDeletions.storagePrefix, row.storagePrefix))
      .run();
    const line = `[vault] wipe cleanup of ${row.storagePrefix} failed (attempt ${attempts}): ${problem}`;
    if (attempts >= LOUD_FAILURE_ATTEMPTS) console.error(line);
    else console.warn(line);
  }
  return { cleared, failed };
}

/**
 * Deletes any file under `owners/` that no live document row points at and
 * that is over a day old: bytes left behind by a failed delete, a crashed
 * upload or a document marked deleted while the store was down.
 */
export async function sweepOrphans(now: number = Date.now()): Promise<{ deleted: number }> {
  const store = vaultStore();
  if (!store || isFenced()) return { deleted: 0 };
  const pass = await deleteUnreferenced(store, VAULT_ROOT_PREFIX, now - ORPHAN_GRACE_MS);
  return { deleted: pass.deleted };
}
