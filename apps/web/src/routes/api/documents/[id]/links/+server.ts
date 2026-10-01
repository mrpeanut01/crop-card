/** POST /api/documents/:id/links — the owner attaches a file to a subject. */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getDocument, insertDocumentLink } from '$lib/db/documents';
import { documentLinkCreateSchema } from '$lib/documents/apiSchemas';
import { isPhotoKind } from '$lib/documents/kinds';
import { requireOwner } from '$lib/server/auth';
import { assertDocumentSubject, firstUnknownRef } from '$lib/server/foreignRefs';
import { documentNotFound, documentRefusal, toDocumentMeta } from '$lib/server/documentAccess';

export const _requestSchema = documentLinkCreateSchema;

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return documentRefusal(400, 'INVALID', 'invalid JSON');
  }
  const parsed = documentLinkCreateSchema.safeParse(body);
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
  const row = getDocument(event.params.id ?? '', { includeDeleted: true });
  if (!row) return documentNotFound();
  if (row.deletedAt) {
    return documentRefusal(
      409,
      'DOCUMENT_DELETED',
      'This file was deleted, so it cannot be attached.'
    );
  }
  if (isPhotoKind(row.kind)) {
    return documentRefusal(
      409,
      'PHOTO_DOCUMENT',
      'Photos stay with their journal entry or animal.'
    );
  }
  const { subjectType, subjectId } = parsed.data;
  const bad = firstUnknownRef(assertDocumentSubject('subjectId', subjectType, subjectId));
  if (bad) return documentRefusal(400, 'FOREIGN_REF', `unknown ${bad}`);
  insertDocumentLink({ documentId: row.id, subjectType, subjectId, createdBy: user.id });
  const [meta] = toDocumentMeta([row]);
  const made = meta.links.find((l) => l.subjectType === subjectType && l.subjectId === subjectId);
  return json(
    { link: made, document: meta },
    { status: 201, headers: { 'cache-control': 'private, no-store' } }
  );
};
