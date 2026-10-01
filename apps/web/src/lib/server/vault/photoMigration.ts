/**
 * Moves journal and animal photos out of SQLite into the document vault
 * (A-46 to A-50). Runs from `runDbMaintenance` while the vault is on.
 */

import { and, gt, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { moveAnimalPhotoToDocument } from '$lib/db/animals';
import { moveJournalPhotoToDocument } from '$lib/db/plantingJournal';
import { animals, documents, plantingJournal, PHOTO_DOCUMENT_KINDS } from '$lib/db/schema';
import { runWithTenantAsync, unscopedQueryNote } from '$lib/db/tenant';
import { isFenced } from '$lib/server/ops/handoff';
import { saveDocument } from './documents';
import { animalPhotoTitle, photoDataUrlBytes, type PhotoDocumentKind } from './photoWrite';
import { vaultStore } from './store';

const DAY_MS = 86_400_000;
export const PHOTO_MIGRATION_BATCH = 100;
export const PHOTO_MIGRATION_BUDGET_MS = 120_000;
/** A photo document no row points at is retired after this long, so a
 *  photo saved a moment before its row is never caught mid-write. */
export const UNREFERENCED_PHOTO_GRACE_MS = DAY_MS;

export interface PhotoMigrationResult {
  moved: number;
  skipped: number;
  remaining: number;
}

export interface PhotoMigrationOptions {
  budgetMs?: number;
  batchSize?: number;
  now?: number;
}

interface Candidate {
  rowid: number;
  id: string;
  ownerId: string;
  photoRef: string;
  createdAt: number | null;
  uploadedBy: string | null;
  title: string;
}

type Source = {
  kind: PhotoDocumentKind;
  next(afterRowid: number, limit: number): Candidate[];
  move(c: Candidate, documentId: string): boolean;
  remaining(): number;
};

function journalBatch(afterRowid: number, limit: number): Candidate[] {
  unscopedQueryNote('photo migration walks every farm; each row is moved in its own tenant');
  return db
    .select({
      rowid: sql<number>`${plantingJournal}.rowid`,
      id: plantingJournal.id,
      ownerId: plantingJournal.ownerId,
      photoRef: plantingJournal.photoRef,
      createdAt: plantingJournal.createdAt,
      createdBy: plantingJournal.createdBy
    })
    .from(plantingJournal)
    .where(
      and(
        isNotNull(plantingJournal.photoRef),
        isNull(plantingJournal.photoDocumentId),
        gt(sql`${plantingJournal}.rowid`, afterRowid)
      )
    )
    .orderBy(sql`${plantingJournal}.rowid`)
    .limit(limit)
    .all()
    .map((r) => ({
      rowid: Number(r.rowid),
      id: r.id,
      ownerId: r.ownerId,
      photoRef: r.photoRef as string,
      createdAt: r.createdAt ? r.createdAt.getTime() : null,
      uploadedBy: r.createdBy ?? null,
      title: 'Journal photo'
    }));
}

function animalBatch(afterRowid: number, limit: number): Candidate[] {
  unscopedQueryNote('photo migration walks every farm; each row is moved in its own tenant');
  return db
    .select({
      rowid: sql<number>`${animals}.rowid`,
      id: animals.id,
      ownerId: animals.ownerId,
      photoRef: animals.photoRef,
      name: animals.name,
      tag: animals.tag
    })
    .from(animals)
    .where(
      and(
        isNotNull(animals.photoRef),
        isNull(animals.photoDocumentId),
        gt(sql`${animals}.rowid`, afterRowid)
      )
    )
    .orderBy(sql`${animals}.rowid`)
    .limit(limit)
    .all()
    .map((r) => ({
      rowid: Number(r.rowid),
      id: r.id,
      ownerId: r.ownerId,
      photoRef: r.photoRef as string,
      createdAt: null,
      uploadedBy: null,
      title: animalPhotoTitle(r)
    }));
}

function countInline(table: typeof plantingJournal | typeof animals): number {
  unscopedQueryNote('photo migration progress counts every farm');
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(table)
    .where(and(isNotNull(table.photoRef), isNull(table.photoDocumentId)))
    .get();
  return Number(row?.n ?? 0);
}

const SOURCES: Source[] = [
  {
    kind: 'journal-photo',
    next: journalBatch,
    move: (c, documentId) => moveJournalPhotoToDocument(c.id, c.photoRef, documentId),
    remaining: () => countInline(plantingJournal)
  },
  {
    kind: 'animal-photo',
    next: animalBatch,
    move: (c, documentId) => moveAnimalPhotoToDocument(c.id, c.photoRef, documentId),
    remaining: () => countInline(animals)
  }
];

class PhotoChanged extends Error {}
class StopRun extends Error {}

const yieldToEventLoop = () => new Promise<void>((r) => setImmediate(r));

type Outcome = 'moved' | 'skipped' | 'changed';

async function moveOne(source: Source, c: Candidate, now: number): Promise<Outcome> {
  const bytes = photoDataUrlBytes(c.photoRef);
  if (!bytes || bytes.length === 0) return 'skipped';
  return runWithTenantAsync(c.ownerId, async () => {
    const saved = await saveDocument({
      kind: source.kind,
      title: c.title,
      originalName: null,
      uploadedBy: c.uploadedBy,
      body: bytes,
      declaredLength: bytes.length,
      allow: ['image/jpeg'],
      capBytes: null,
      createdAt: c.createdAt ?? now,
      inTransaction: (doc) => {
        if (!source.move(c, doc.id)) throw new PhotoChanged();
      }
    });
    if (saved.ok) return 'moved';
    if (saved.code === 'UNSUPPORTED_TYPE' || saved.code === 'TRUNCATED') return 'skipped';
    if (saved.code === 'ABORTED') return 'changed';
    throw new StopRun(saved.code);
  });
}

/**
 * Moves inline photos into the vault in batches of `batchSize` rows read at a
 * time, until none remain, the deploy handoff fence rises or `budgetMs`
 * passes. Each row commits in its own short transaction (the document row
 * plus a compare-and-set on the source row, A-47), so the write lock is held
 * for milliseconds. A row whose data URL is not a JPEG stays inline and is
 * counted as skipped. A store failure or vault refusal ends the run; the
 * next run picks up where it stopped.
 */
export async function migrateInlinePhotos(
  opts: PhotoMigrationOptions = {}
): Promise<PhotoMigrationResult> {
  const budgetMs = opts.budgetMs ?? PHOTO_MIGRATION_BUDGET_MS;
  const batchSize = Math.max(1, opts.batchSize ?? PHOTO_MIGRATION_BATCH);
  const now = opts.now ?? Date.now();
  const started = performance.now();
  const result = { moved: 0, skipped: 0, changed: 0 };
  let stopped: string | null = null;

  if (!vaultStore()) {
    return { moved: 0, skipped: 0, remaining: SOURCES.reduce((n, s) => n + s.remaining(), 0) };
  }

  outer: for (const source of SOURCES) {
    let cursor = 0;
    for (;;) {
      if (isFenced()) {
        stopped = 'fenced';
        break outer;
      }
      if (performance.now() - started >= budgetMs) {
        stopped = 'budget';
        break outer;
      }
      const batch = source.next(cursor, batchSize);
      if (batch.length === 0) break;
      for (const c of batch) {
        cursor = c.rowid;
        if (isFenced()) {
          stopped = 'fenced';
          break outer;
        }
        try {
          result[await moveOne(source, c, now)]++;
        } catch (err) {
          stopped =
            err instanceof StopRun ? err.message : `error: ${(err as Error)?.message ?? err}`;
          break outer;
        }
      }
      await yieldToEventLoop();
    }
  }

  const remaining = SOURCES.reduce((n, s) => n + s.remaining(), 0);
  const ms = Math.round(performance.now() - started);
  if (result.moved || result.skipped || result.changed || stopped) {
    console.log('[vault] photo migration', JSON.stringify({ ...result, remaining, stopped, ms }));
  }
  return { moved: result.moved, skipped: result.skipped, remaining };
}

/**
 * Retires live photo documents that no journal entry or animal points at
 * any more and that are older than a day (A-50): planting deletes cascade
 * journal rows in SQL, where no code sees them. The row is marked deleted
 * with `deleted_by` null ("Removed with its record") and its bytes deleted.
 */
export async function retireUnreferencedPhotos(now = Date.now()): Promise<number> {
  const store = vaultStore();
  if (!store || isFenced()) return 0;
  unscopedQueryNote('photo sweep walks every farm for photo documents no row points at');
  const cutoff = new Date(now - UNREFERENCED_PHOTO_GRACE_MS);
  const retired = db
    .update(documents)
    .set({ deletedAt: new Date(now), deletedBy: null })
    .where(
      and(
        isNull(documents.deletedAt),
        inArray(documents.kind, [...PHOTO_DOCUMENT_KINDS]),
        lt(documents.createdAt, cutoff),
        sql`${documents.id} NOT IN (SELECT ${plantingJournal.photoDocumentId} FROM ${plantingJournal} WHERE ${plantingJournal.photoDocumentId} IS NOT NULL)`,
        sql`${documents.id} NOT IN (SELECT ${animals.photoDocumentId} FROM ${animals} WHERE ${animals.photoDocumentId} IS NOT NULL)`
      )
    )
    .returning({ storageKey: documents.storageKey })
    .all();
  for (const doc of retired) {
    if (isFenced()) break;
    await store
      .delete(doc.storageKey)
      .catch((e) =>
        console.error(`[vault] could not delete ${doc.storageKey}: ${(e as Error)?.message ?? e}`)
      );
  }
  return retired.length;
}
