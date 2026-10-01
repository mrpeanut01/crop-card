import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from './client';
import { plantingJournal } from './schema';
import { tenantValues, withTenant } from './tenant';
import type {
  JournalAnswer,
  JournalEntry,
  JournalKind,
  JournalProvenance
} from '$lib/journal/model';

export interface JournalInput {
  cropId: string;
  blockId: string;
  createdBy: string | null;
  kind: JournalKind;
  text: string;
  photoRef?: string | null;
  /** The photo in the vault; when set, `photoRef` is left empty. */
  photoDocumentId?: string | null;
  answer?: JournalAnswer | null;
  provenance: JournalProvenance;
  createdAt?: number;
}

type Row = typeof plantingJournal.$inferSelect;

function parseAnswer(raw: string | null): JournalAnswer | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as JournalAnswer;
  } catch {
    return null;
  }
}

function toEntry(row: Row): JournalEntry {
  return {
    id: row.id,
    cropId: row.cropId,
    blockId: row.blockId,
    createdAt: row.createdAt.getTime(),
    createdBy: row.createdBy ?? null,
    kind: row.kind,
    text: row.text,
    hasPhoto: !!row.photoRef || !!row.photoDocumentId,
    photoDocumentId: row.photoDocumentId ?? null,
    answer: parseAnswer(row.answerJson),
    provenance: row.provenance
  };
}

export function insertJournalEntry(input: JournalInput): JournalEntry {
  const row = db
    .insert(plantingJournal)
    .values(
      tenantValues({
        id: randomUUID(),
        cropId: input.cropId,
        blockId: input.blockId,
        createdBy: input.createdBy,
        kind: input.kind,
        text: input.text,
        photoRef: input.photoDocumentId ? null : (input.photoRef ?? null),
        photoDocumentId: input.photoDocumentId ?? null,
        answerJson: input.answer ? JSON.stringify(input.answer) : null,
        provenance: input.provenance,
        ...(input.createdAt !== undefined ? { createdAt: new Date(input.createdAt) } : {})
      })
    )
    .returning()
    .get();
  return toEntry(row);
}

export function listJournalForCrop(cropId: string, limit = 50): JournalEntry[] {
  return db
    .select()
    .from(plantingJournal)
    .where(withTenant(plantingJournal, eq(plantingJournal.cropId, cropId)))
    .orderBy(desc(plantingJournal.createdAt), desc(sql`rowid`))
    .limit(limit)
    .all()
    .map(toEntry);
}

export function getJournalEntry(cropId: string, id: string): JournalEntry | undefined {
  const row = db
    .select()
    .from(plantingJournal)
    .where(
      withTenant(
        plantingJournal,
        and(eq(plantingJournal.cropId, cropId), eq(plantingJournal.id, id))
      )
    )
    .get();
  return row ? toEntry(row) : undefined;
}

export type StoredPhoto = { documentId: string } | { inline: string };

/** Where an entry's photo lives: the vault document, or the inline data URL
 *  of a row the migration has not moved yet. */
export function getJournalPhoto(cropId: string, id: string): StoredPhoto | null {
  const row = db
    .select({
      photoRef: plantingJournal.photoRef,
      photoDocumentId: plantingJournal.photoDocumentId
    })
    .from(plantingJournal)
    .where(
      withTenant(
        plantingJournal,
        and(eq(plantingJournal.cropId, cropId), eq(plantingJournal.id, id))
      )
    )
    .get();
  if (!row) return null;
  if (row.photoDocumentId) return { documentId: row.photoDocumentId };
  return row.photoRef ? { inline: row.photoRef } : null;
}

/** Moves one inline photo to its vault document (A-47). Changes the row only
 *  while `photo_ref` still holds `expectedRef` and no document is set, so a
 *  photo changed during the move is never overwritten. */
export function moveJournalPhotoToDocument(
  id: string,
  expectedRef: string,
  documentId: string
): boolean {
  return (
    db
      .update(plantingJournal)
      .set({ photoDocumentId: documentId, photoRef: null })
      .where(
        withTenant(
          plantingJournal,
          and(
            eq(plantingJournal.id, id),
            eq(plantingJournal.photoRef, expectedRef),
            isNull(plantingJournal.photoDocumentId)
          )
        )
      )
      .run().changes > 0
  );
}

/** Deletes the entry. Returns the vault document its photo was in (null
 *  when it had none or it was inline), or undefined when nothing matched. */
export function deleteJournalEntry(
  cropId: string,
  id: string
): { photoDocumentId: string | null } | undefined {
  const row = db
    .delete(plantingJournal)
    .where(
      withTenant(
        plantingJournal,
        and(eq(plantingJournal.cropId, cropId), eq(plantingJournal.id, id))
      )
    )
    .returning({ photoDocumentId: plantingJournal.photoDocumentId })
    .get();
  return row ? { photoDocumentId: row.photoDocumentId ?? null } : undefined;
}

/** Every entry for the GDPR export, photos included. */
export function listJournalForExport(): Array<JournalEntry & { photoRef: string | null }> {
  return db
    .select()
    .from(plantingJournal)
    .where(withTenant(plantingJournal))
    .orderBy(desc(plantingJournal.createdAt))
    .all()
    .map((row) => ({ ...toEntry(row), photoRef: row.photoRef ?? null }));
}
