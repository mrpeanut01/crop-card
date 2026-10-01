/** DELETE /api/documents/:id/links/:linkId — the owner detaches a file. */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getDocument, getDocumentLink, removeDocumentLink } from '$lib/db/documents';
import { requireOwner } from '$lib/server/auth';
import { documentNotFound, toDocumentMeta } from '$lib/server/documentAccess';

export const DELETE: RequestHandler = (event) => {
  const user = requireOwner(event);
  const id = event.params.id ?? '';
  const row = getDocument(id, { includeDeleted: true });
  if (!row) return documentNotFound();
  const link = getDocumentLink(id, event.params.linkId ?? '');
  if (!link) return documentNotFound();
  removeDocumentLink(id, link, user.id);
  const [meta] = toDocumentMeta([row]);
  return json({ document: meta }, { headers: { 'cache-control': 'private, no-store' } });
};
