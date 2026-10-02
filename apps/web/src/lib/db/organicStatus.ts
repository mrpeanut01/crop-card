import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from './client';
import { documentLinks, documents, organicStatusEvents } from './schema';
import { tenantValues, withTenant } from './tenant';
import type { OrganicStatus, OrganicStatusEntry, OrganicSubjectType } from '$lib/organic/status';

type Row = typeof organicStatusEvents.$inferSelect;

function rowTo(row: Row, documentIds: string[] = []): OrganicStatusEntry {
  return {
    id: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    status: row.status,
    effectiveAt: row.effectiveAt.getTime(),
    certifier: row.certifier ?? null,
    note: row.note ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.getTime(),
    documentIds
  };
}

export interface NewOrganicStatusEntry {
  subjectType: OrganicSubjectType;
  subjectId: string;
  status: OrganicStatus;
  effectiveAt: number;
  certifier: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt?: number;
}

/** Append-only (B-11): there is no update or delete. */
export function insertOrganicStatusEntry(input: NewOrganicStatusEntry): OrganicStatusEntry {
  const row = db
    .insert(organicStatusEvents)
    .values(
      tenantValues({
        id: randomUUID(),
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        status: input.status,
        effectiveAt: new Date(input.effectiveAt),
        certifier: input.certifier,
        note: input.note,
        createdBy: input.createdBy,
        createdAt: new Date(input.createdAt ?? Date.now())
      })
    )
    .returning()
    .get();
  return rowTo(row);
}

function liveDocumentIds(entryIds: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (entryIds.length === 0) return out;
  const rows = db
    .select({ subjectId: documentLinks.subjectId, documentId: documentLinks.documentId })
    .from(documentLinks)
    .innerJoin(documents, eq(documents.id, documentLinks.documentId))
    .where(
      withTenant(
        documentLinks,
        eq(documentLinks.subjectType, 'organic-status'),
        inArray(documentLinks.subjectId, [...entryIds]),
        eq(documents.ownerId, documentLinks.ownerId),
        isNull(documents.deletedAt)
      )
    )
    .orderBy(asc(documentLinks.createdAt))
    .all();
  for (const r of rows) {
    const list = out.get(r.subjectId) ?? [];
    list.push(r.documentId);
    out.set(r.subjectId, list);
  }
  return out;
}

/** Every entry of the farm, or of one subject, oldest first, with the live
 *  documents linked to each. */
export function listOrganicStatusEntries(
  filter: { subjectType?: OrganicSubjectType; subjectId?: string } = {}
): OrganicStatusEntry[] {
  const rows = db
    .select()
    .from(organicStatusEvents)
    .where(
      withTenant(
        organicStatusEvents,
        and(
          filter.subjectType ? eq(organicStatusEvents.subjectType, filter.subjectType) : undefined,
          filter.subjectId ? eq(organicStatusEvents.subjectId, filter.subjectId) : undefined
        )
      )
    )
    .orderBy(
      asc(organicStatusEvents.effectiveAt),
      asc(organicStatusEvents.createdAt),
      asc(organicStatusEvents.id)
    )
    .all();
  const docs = liveDocumentIds(rows.map((r) => r.id));
  return rows.map((r) => rowTo(r, docs.get(r.id) ?? []));
}

export function getOrganicStatusEntry(id: string): OrganicStatusEntry | undefined {
  const row = db
    .select()
    .from(organicStatusEvents)
    .where(withTenant(organicStatusEvents, eq(organicStatusEvents.id, id)))
    .get();
  return row ? rowTo(row, liveDocumentIds([row.id]).get(row.id) ?? []) : undefined;
}

/** B-15: one existence check for the chrome level. */
export function hasOrganicStatusRows(): boolean {
  return (
    db
      .select({ id: organicStatusEvents.id })
      .from(organicStatusEvents)
      .where(withTenant(organicStatusEvents))
      .limit(1)
      .get() !== undefined
  );
}
