/**
 * POST /api/documents — upload one file (raw body) into the farm's vault.
 * GET  /api/documents — list the documents the caller may read.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwnerId } from '$lib/db/tenant';
import { documentsCursor, insertDocumentLink, listDocuments } from '$lib/db/documents';
import {
  DOCUMENTS_PAGE_SIZE,
  documentListQuerySchema,
  documentUploadQuerySchema
} from '$lib/documents/apiSchemas';
import { PHOTO_DOCUMENT_KINDS, isPhotoKind, type DocumentKind } from '$lib/documents/kinds';
import { readerRole } from '$lib/documents/access';
import { requireUser } from '$lib/server/auth';
import { storageCapBytes } from '$lib/server/billing/plans';
import { assertDocumentSubject, firstUnknownRef } from '$lib/server/foreignRefs';
import {
  documentReadable,
  documentRefusal,
  titleFromName,
  toDocumentMeta
} from '$lib/server/documentAccess';
import { VAULT_FENCED_RETRY_AFTER_S, saveDocument } from '$lib/server/vault/documents';
import { vaultStatus } from '$lib/server/vault/store';
import { isInteractiveOwner } from '$lib/server/interactiveOwner';

export const _requestSchema = documentUploadQuerySchema;

function queryObject(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of url.searchParams) out[k] = v;
  return out;
}

export const POST: RequestHandler = async (event) => {
  const user = requireUser(event);
  if (user.role !== 'owner') {
    return documentRefusal(403, 'OWNER_ONLY', 'Only the farm owner can upload documents.');
  }
  const parsed = documentUploadQuerySchema.safeParse(queryObject(event.url));
  if (!parsed.success) {
    return json(
      {
        error: 'invalid request',
        code: 'INVALID',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }
  const q = parsed.data;
  if (q.subjectType && q.subjectId) {
    const bad = firstUnknownRef(assertDocumentSubject('subjectId', q.subjectType, q.subjectId));
    if (bad) return documentRefusal(400, 'FOREIGN_REF', `unknown ${bad}`);
  }

  const lengthHeader = event.request.headers.get('content-length');
  const declaredLength =
    lengthHeader !== null && /^\d+$/.test(lengthHeader.trim()) ? Number(lengthHeader) : null;
  const name = q.name ? q.name : null;
  const title = q.title || titleFromName(name ?? undefined);

  const result = await saveDocument({
    kind: q.kind as DocumentKind,
    title,
    originalName: name,
    uploadedBy: user.id,
    body: event.request.body ?? new Uint8Array(0),
    declaredLength,
    capBytes: storageCapBytes(requireOwnerId()),
    inTransaction:
      q.subjectType && q.subjectId
        ? (doc) => {
            insertDocumentLink({
              documentId: doc.id,
              subjectType: q.subjectType!,
              subjectId: q.subjectId!,
              createdBy: user.id
            });
          }
        : undefined
  });
  if (!result.ok) {
    const res = documentRefusal(result.status, result.code, result.message);
    if (result.code === 'FENCED')
      res.headers.set('Retry-After', String(VAULT_FENCED_RETRY_AFTER_S));
    return res;
  }
  const [meta] = toDocumentMeta([result.document]);
  return json(
    { document: meta },
    { status: 201, headers: { 'cache-control': 'private, no-store' } }
  );
};

export const GET: RequestHandler = (event) => {
  const user = requireUser(event);
  const role = readerRole(user.role);
  const vault = { enabled: vaultStatus().enabled };
  const canDelete = isInteractiveOwner(event, user);
  if (!role) return json({ documents: [], nextBefore: null, vault, canDelete });
  const parsed = documentListQuerySchema.safeParse(queryObject(event.url));
  if (!parsed.success) {
    return json(
      {
        error: 'invalid request',
        code: 'INVALID',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }
  const q = parsed.data;
  const isOwner = role === 'owner';
  if (q.kind && isPhotoKind(q.kind) && !isOwner) {
    return json({ documents: [], nextBefore: null, nextBeforeId: null, vault, canDelete });
  }
  const rows = listDocuments({
    kinds: q.kind ? [q.kind] : undefined,
    excludeKinds: q.kind ? undefined : PHOTO_DOCUMENT_KINDS,
    subject: q.subjectType && q.subjectId ? { type: q.subjectType, id: q.subjectId } : undefined,
    includeDeleted: isOwner && q.includeDeleted === '1',
    before: q.before,
    beforeId: q.before !== undefined ? q.beforeId : undefined,
    limit: DOCUMENTS_PAGE_SIZE
  });
  const metas = toDocumentMeta(rows).filter((m) => documentReadable(user.role, m));
  return json(
    {
      documents: metas,
      vault,
      canDelete,
      ...documentsCursor(rows)
    },
    { headers: { 'cache-control': 'private, no-store' } }
  );
};
