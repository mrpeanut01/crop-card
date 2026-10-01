import { json } from '@sveltejs/kit';
import { identityLabel } from '$lib/identity';
import {
  documentPeople,
  getDocument,
  linksForDocuments,
  type DocumentRow
} from '$lib/db/documents';
import type { DocumentLinkMeta, DocumentMeta, DocumentPerson } from '$lib/documents/apiSchemas';
import { canReadDocument } from '$lib/documents/access';
import type { DocumentSubjectType } from '$lib/documents/kinds';
import { assertDocumentSubject } from './foreignRefs';

/** Whether a link's subject still exists for the active Owner. */
export function documentSubjectExists(
  subjectType: DocumentSubjectType,
  subjectId: string
): boolean {
  const [, , exists] = assertDocumentSubject('subject', subjectType, subjectId);
  return !!exists(subjectId);
}

/** Contract C-6 for each row, in order. Subject existence is resolved once
 *  per distinct subject. */
export function toDocumentMeta(rows: readonly DocumentRow[]): DocumentMeta[] {
  const links = linksForDocuments(rows.map((r) => r.id));
  const people = documentPeople(rows.flatMap((r) => [r.uploadedBy, r.deletedBy]));
  const seen = new Map<string, boolean>();
  const exists = (type: DocumentSubjectType, id: string) => {
    const key = `${type}\u0000${id}`;
    let hit = seen.get(key);
    if (hit === undefined) {
      hit = documentSubjectExists(type, id);
      seen.set(key, hit);
    }
    return hit;
  };
  const person = (id: string | null): DocumentPerson | null => {
    if (!id) return null;
    const p = people.get(id);
    return { id, label: p ? identityLabel(p) : 'a former member' };
  };
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    mime: r.mime,
    byteSize: r.byteSize,
    sha256: r.sha256,
    originalName: r.originalName,
    createdAt: r.createdAt.toISOString(),
    uploadedBy: person(r.uploadedBy),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
    deletedBy: person(r.deletedBy),
    links: (links.get(r.id) ?? []).map((l): DocumentLinkMeta => ({
      id: l.id,
      subjectType: l.subjectType,
      subjectId: l.subjectId,
      subjectExists: exists(l.subjectType, l.subjectId)
    }))
  }));
}

export function documentReadable(role: string, meta: DocumentMeta): boolean {
  return canReadDocument(role, meta);
}

/**
 * The document if this role may read it, else undefined. A missing,
 * foreign and unreadable id all look the same to the caller (A-32).
 */
export function readableDocument(
  role: string,
  id: string,
  opts: { includeDeleted?: boolean } = {}
): { row: DocumentRow; meta: DocumentMeta } | undefined {
  const row = getDocument(id, { includeDeleted: opts.includeDeleted });
  if (!row) return undefined;
  const [meta] = toDocumentMeta([row]);
  if (!canReadDocument(role, meta)) return undefined;
  return { row, meta };
}

const NOT_FOUND_BODY = JSON.stringify({ error: 'Document not found.', code: 'NOT_FOUND' });

/** One byte-identical 404 for missing, deleted, foreign and unreadable. */
export function documentNotFound(): Response {
  return new Response(NOT_FOUND_BODY, {
    status: 404,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' }
  });
}

export function documentRefusal(status: number, code: string, error: string): Response {
  return json({ error, code }, { status, headers: { 'cache-control': 'private, no-store' } });
}

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'text/csv; charset=utf-8': 'csv'
};

export function extensionFor(mime: string): string {
  return EXT[mime] ?? 'bin';
}

/** Lowercase `a-z0-9-`, at most 60 characters, never empty (A-40). */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'file';
}

/** Images open in the browser; PDF and CSV download (V-06). The name is
 *  built from the title and the stored type, never the uploaded name. */
export function contentDisposition(title: string, mime: string): string {
  const inline = mime.startsWith('image/');
  const ext = extensionFor(mime);
  const base =
    stripControl(title.trim())
      .replace(/["\\/]/g, '')
      .slice(0, 120) || 'file';
  const full = `${base}.${ext}`;
  const ascii = `${slugify(title)}.${ext}`;
  const encoded = encodeURIComponent(full).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** The plan's file-route headers (V-06, A-33). */
export const DOCUMENT_FILE_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
  'Cache-Control': 'private, no-store',
  'Cross-Origin-Resource-Policy': 'same-origin'
};

/** A title from a file name: no folders, no extension, spaces tidied. */
export function titleFromName(name: string | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const noExt = base.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const cleaned = stripControl(noExt)
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .trim();
  return cleaned || 'Untitled file';
}

function stripControl(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x20 && c !== 0x7f) out += ch;
  }
  return out;
}
