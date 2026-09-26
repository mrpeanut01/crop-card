import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
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
    hasPhoto: !!row.photoRef,
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
        photoRef: input.photoRef ?? null,
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

export function getJournalPhoto(cropId: string, id: string): string | null {
  const row = db
    .select({ photoRef: plantingJournal.photoRef })
    .from(plantingJournal)
    .where(
      withTenant(
        plantingJournal,
        and(eq(plantingJournal.cropId, cropId), eq(plantingJournal.id, id))
      )
    )
    .get();
  return row?.photoRef ?? null;
}

export function deleteJournalEntry(cropId: string, id: string): boolean {
  const res = db
    .delete(plantingJournal)
    .where(
      withTenant(
        plantingJournal,
        and(eq(plantingJournal.cropId, cropId), eq(plantingJournal.id, id))
      )
    )
    .run();
  return res.changes > 0;
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
