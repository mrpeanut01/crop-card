import { t } from '$lib/i18n';
/**
 * GET    /api/documents/:id — metadata, for anyone who may read the file.
 * DELETE /api/documents/:id — the signed-in owner deletes the file.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getDocument } from '$lib/db/documents';
import { isPhotoKind } from '$lib/documents/kinds';
import { requireUser } from '$lib/server/auth';
import { isInteractiveOwner } from '$lib/server/interactiveOwner';
import {
  documentNotFound,
  documentRefusal,
  readableDocument,
  toDocumentMeta
} from '$lib/server/documentAccess';
import { discardDocument } from '$lib/server/vault/documents';

export const GET: RequestHandler = (event) => {
  const user = requireUser(event);
  const found = readableDocument(user.role, event.params.id ?? '', { includeDeleted: true });
  if (!found) return documentNotFound();
  return json({ document: found.meta }, { headers: { 'cache-control': 'private, no-store' } });
};

export const DELETE: RequestHandler = async (event) => {
  const user = requireUser(event);
  if (!isInteractiveOwner(event, user)) {
    return documentRefusal(
      403,
      'INTERACTIVE_OWNER_ONLY',
      t(event.locals?.locale, 'api.err.docDeleteOwner')
    );
  }
  const row = getDocument(event.params.id ?? '');
  if (!row) return documentNotFound();
  if (isPhotoKind(row.kind)) {
    return documentRefusal(
      409,
      'PHOTO_DOCUMENT',
      t(event.locals?.locale, 'api.err.removePhotoFirst')
    );
  }
  const deleted = await discardDocument(row.id, user.id);
  if (!deleted) return documentNotFound();
  const [meta] = toDocumentMeta([deleted]);
  return json({ document: meta }, { headers: { 'cache-control': 'private, no-store' } });
};
