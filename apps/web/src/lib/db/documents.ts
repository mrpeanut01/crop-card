import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { DOCUMENTS_PAGE_SIZE } from '$lib/documents/apiSchemas';
import { db } from './client';
import {
  type DocumentKind,
  type DocumentSubjectType,
  documentLinks,
  documents,
  soilTests,
  users
} from './schema';
import { tenantValues, unscopedQueryNote, withTenant } from './tenant';

export type DocumentRow = typeof documents.$inferSelect;

export interface NewDocument {
  id: string;
  kind: DocumentKind;
  title: string;
  mime: string;
  byteSize: number;
  sha256: string;
  crc32: number;
  storageKey: string;
  originalName: string | null;
  uploadedBy: string | null;
  createdAt?: number;
}

/** Every file of an Owner lives under this prefix (V-04), so a farm wipe is
 *  one prefix delete. */
export function ownerStoragePrefix(ownerId: string): string {
  if (!ownerId || ownerId.includes('/')) throw new Error('ownerStoragePrefix: bad owner id');
  return `owners/${ownerId}/`;
}

export function documentStorageKey(ownerId: string, documentId: string): string {
  if (!documentId || documentId.includes('/')) {
    throw new Error('documentStorageKey: bad document id');
  }
  return `${ownerStoragePrefix(ownerId)}${documentId}`;
}

export function insertDocument(input: NewDocument): DocumentRow {
  const { createdAt, ...rest } = input;
  return db
    .insert(documents)
    .values(
      tenantValues({
        ...rest,
        ...(createdAt !== undefined ? { createdAt: new Date(createdAt) } : {})
      })
    )
    .returning()
    .get();
}

export function getDocument(
  id: string,
  opts: { includeDeleted?: boolean } = {}
): DocumentRow | undefined {
  return db
    .select()
    .from(documents)
    .where(
      withTenant(
        documents,
        opts.includeDeleted
          ? eq(documents.id, id)
          : and(eq(documents.id, id), isNull(documents.deletedAt))
      )
    )
    .get();
}

/** Marks a live document deleted. Returns undefined for a missing, foreign
 *  or already-deleted id. */
export function markDocumentDeleted(
  id: string,
  deletedBy: string | null,
  now: number = Date.now()
): DocumentRow | undefined {
  return db
    .update(documents)
    .set({ deletedAt: new Date(now), deletedBy })
    .where(withTenant(documents, and(eq(documents.id, id), isNull(documents.deletedAt))))
    .returning()
    .get();
}

/** Bytes held by the active Owner's live documents. Read live, not cached,
 *  so an upload burst cannot overshoot the plan cap. */
export function liveDocumentBytes(): number {
  const row = db
    .select({ total: sql<number | null>`sum(${documents.byteSize})` })
    .from(documents)
    .where(withTenant(documents, isNull(documents.deletedAt)))
    .get();
  return Number(row?.total ?? 0);
}

export function documentExists(id: string): boolean {
  return (
    db
      .select({ id: documents.id })
      .from(documents)
      .where(withTenant(documents, and(eq(documents.id, id), isNull(documents.deletedAt))))
      .get() !== undefined
  );
}

// ─── A3: links, listing and soil test wiring ─────────────────────────────

export type DocumentLinkRow = typeof documentLinks.$inferSelect;

/** Adds a link; a repeated link is a no-op that returns the existing row
 *  (A-02). */
export function insertDocumentLink(input: {
  documentId: string;
  subjectType: DocumentSubjectType;
  subjectId: string;
  createdBy: string | null;
}): DocumentLinkRow {
  db.insert(documentLinks)
    .values(tenantValues({ id: randomUUID(), ...input }))
    .onConflictDoNothing()
    .run();
  return db
    .select()
    .from(documentLinks)
    .where(
      withTenant(
        documentLinks,
        eq(documentLinks.documentId, input.documentId),
        eq(documentLinks.subjectType, input.subjectType),
        eq(documentLinks.subjectId, input.subjectId)
      )
    )
    .get()!;
}

export function getDocumentLink(documentId: string, linkId: string): DocumentLinkRow | undefined {
  return db
    .select()
    .from(documentLinks)
    .where(
      withTenant(
        documentLinks,
        eq(documentLinks.id, linkId),
        eq(documentLinks.documentId, documentId)
      )
    )
    .get();
}

export function deleteDocumentLink(documentId: string, linkId: string): boolean {
  return (
    db
      .delete(documentLinks)
      .where(
        withTenant(
          documentLinks,
          eq(documentLinks.id, linkId),
          eq(documentLinks.documentId, documentId)
        )
      )
      .run().changes > 0
  );
}

/** Every link of the given documents, keyed by document id. */
export function linksForDocuments(ids: readonly string[]): Map<string, DocumentLinkRow[]> {
  const out = new Map<string, DocumentLinkRow[]>();
  if (ids.length === 0) return out;
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 500) {
    const rows = db
      .select()
      .from(documentLinks)
      .where(withTenant(documentLinks, inArray(documentLinks.documentId, unique.slice(i, i + 500))))
      .orderBy(documentLinks.createdAt, documentLinks.id)
      .all();
    for (const r of rows) {
      const list = out.get(r.documentId);
      if (list) list.push(r);
      else out.set(r.documentId, [r]);
    }
  }
  return out;
}

export interface ListDocumentsOptions {
  kinds?: readonly DocumentKind[];
  excludeKinds?: readonly DocumentKind[];
  subject?: { type: DocumentSubjectType; id: string };
  includeDeleted?: boolean;
  /** Only rows after this point in the (createdAt desc, id desc) order:
   *  created before this epoch ms, or at it with an id below `beforeId`. */
  before?: number;
  beforeId?: string;
  limit?: number;
}

/** The cursor for the page after `rows` (a full page of `listDocuments`). */
export function documentsCursor(rows: readonly DocumentRow[]): {
  nextBefore: number | null;
  nextBeforeId: string | null;
} {
  const last = rows.at(-1);
  if (rows.length !== DOCUMENTS_PAGE_SIZE || !last) return { nextBefore: null, nextBeforeId: null };
  return { nextBefore: last.createdAt.getTime(), nextBeforeId: last.id };
}

/** The active Owner's documents, newest first. */
export function listDocuments(opts: ListDocumentsOptions = {}): DocumentRow[] {
  const conds = [
    opts.includeDeleted ? undefined : isNull(documents.deletedAt),
    opts.kinds?.length ? inArray(documents.kind, [...opts.kinds]) : undefined,
    opts.excludeKinds?.length
      ? sql`${documents.kind} not in (${sql.join(
          opts.excludeKinds.map((k) => sql`${k}`),
          sql`, `
        )})`
      : undefined,
    opts.before !== undefined
      ? opts.beforeId !== undefined
        ? or(
            lt(documents.createdAt, new Date(opts.before)),
            and(eq(documents.createdAt, new Date(opts.before)), lt(documents.id, opts.beforeId))
          )
        : lt(documents.createdAt, new Date(opts.before))
      : undefined,
    opts.subject
      ? inArray(
          documents.id,
          db
            .select({ id: documentLinks.documentId })
            .from(documentLinks)
            .where(
              withTenant(
                documentLinks,
                eq(documentLinks.subjectType, opts.subject.type),
                eq(documentLinks.subjectId, opts.subject.id)
              )
            )
        )
      : undefined
  ];
  const q = db
    .select()
    .from(documents)
    .where(withTenant(documents, ...conds))
    .orderBy(desc(documents.createdAt), desc(documents.id));
  return opts.limit !== undefined ? q.limit(opts.limit).all() : q.all();
}

/** Count and bytes of live documents per kind, for /settings/documents. */
export function liveDocumentTotalsByKind(): Map<DocumentKind, { count: number; bytes: number }> {
  const rows = db
    .select({
      kind: documents.kind,
      count: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(${documents.byteSize}), 0)`
    })
    .from(documents)
    .where(withTenant(documents, isNull(documents.deletedAt)))
    .groupBy(documents.kind)
    .all();
  return new Map(rows.map((r) => [r.kind, { count: Number(r.count), bytes: Number(r.bytes) }]));
}

/** Display identities for uploader and deleter ids. Users are global rows;
 *  the ids come from this Owner's own documents. */
export function documentPeople(
  ids: readonly (string | null)[]
): Map<string, { email: string | null; phone: string | null }> {
  const wanted = [...new Set(ids.filter((i): i is string => !!i))];
  if (wanted.length === 0) return new Map();
  unscopedQueryNote('document uploader labels come from the global users table');
  const rows = db
    .select({ id: users.id, email: users.email, phone: users.phone })
    .from(users)
    .where(inArray(users.id, wanted))
    .all();
  return new Map(rows.map((r) => [r.id, { email: r.email, phone: r.phone }]));
}

export interface SoilTestLabReport {
  documentId: string;
  title: string;
  deletedAt: number | null;
  deletedBy: string | null;
}

/** The lab report each soil test points at, deleted ones included so the
 *  "deleted on" line can render (A-35). */
export function labReportForSoilTests(
  soilTestIds?: readonly string[]
): Map<string, SoilTestLabReport> {
  if (soilTestIds && soilTestIds.length === 0) return new Map();
  const rows = db
    .select({
      soilTestId: soilTests.id,
      documentId: documents.id,
      title: documents.title,
      deletedAt: documents.deletedAt,
      deletedBy: documents.deletedBy
    })
    .from(soilTests)
    .innerJoin(
      documents,
      and(eq(documents.id, soilTests.documentId), eq(documents.ownerId, soilTests.ownerId))
    )
    .where(
      withTenant(
        soilTests,
        isNotNull(soilTests.documentId),
        soilTestIds ? inArray(soilTests.id, [...soilTestIds]) : undefined
      )
    )
    .all();
  return new Map(
    rows.map((r) => [
      r.soilTestId,
      {
        documentId: r.documentId,
        title: r.title,
        deletedAt: r.deletedAt ? r.deletedAt.getTime() : null,
        deletedBy: r.deletedBy
      }
    ])
  );
}

/**
 * A-36. Points the soil test at its lab report and keeps the `soil-test`
 * link in step, in one transaction: the old report's link to this test is
 * removed, the new one is added. `null` removes the report. Returns false
 * when the soil test is not this Owner's.
 */
export function setSoilTestDocument(
  soilTestId: string,
  documentId: string | null,
  actingUserId: string | null
): boolean {
  return db.transaction(() => {
    const test = db
      .select({ id: soilTests.id, documentId: soilTests.documentId })
      .from(soilTests)
      .where(withTenant(soilTests, eq(soilTests.id, soilTestId)))
      .get();
    if (!test) return false;
    if (test.documentId && test.documentId !== documentId) {
      db.delete(documentLinks)
        .where(
          withTenant(
            documentLinks,
            eq(documentLinks.documentId, test.documentId),
            eq(documentLinks.subjectType, 'soil-test'),
            eq(documentLinks.subjectId, soilTestId)
          )
        )
        .run();
    }
    db.update(soilTests)
      .set({ documentId })
      .where(withTenant(soilTests, eq(soilTests.id, soilTestId)))
      .run();
    if (documentId) {
      insertDocumentLink({
        documentId,
        subjectType: 'soil-test',
        subjectId: soilTestId,
        createdBy: actingUserId
      });
    }
    return true;
  });
}

/** Removes one link. A `soil-test` link to the test's own lab report also
 *  clears `soil_tests.document_id`, so the pointer and the link stay
 *  together (A-36). */
export function removeDocumentLink(
  documentId: string,
  link: DocumentLinkRow,
  actingUserId: string | null
): void {
  db.transaction(() => {
    const pointsHere =
      link.subjectType === 'soil-test' &&
      db
        .select({ id: soilTests.id })
        .from(soilTests)
        .where(
          withTenant(
            soilTests,
            eq(soilTests.id, link.subjectId),
            eq(soilTests.documentId, documentId)
          )
        )
        .get() !== undefined;
    if (pointsHere) setSoilTestDocument(link.subjectId, null, actingUserId);
    else deleteDocumentLink(documentId, link.id);
  });
}
