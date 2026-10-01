/**
 * GET /api/documents/:id/file — the stored bytes, streamed. Access is
 * checked through the subjects the file is linked to (A-31); a missing,
 * deleted, foreign or unreadable id is the same 404 (A-32).
 */

import type { RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import {
  DOCUMENT_FILE_HEADERS,
  contentDisposition,
  documentNotFound,
  documentRefusal,
  readableDocument
} from '$lib/server/documentAccess';
import { openDocument } from '$lib/server/vault/documents';
import { vaultStatus } from '$lib/server/vault/store';
import { VAULT_OFF_COPY } from '$lib/documents/kinds';

export const GET: RequestHandler = async (event) => {
  const user = requireUser(event);
  const found = readableDocument(user.role, event.params.id ?? '');
  if (!found) return documentNotFound();
  if (!vaultStatus().enabled) return documentRefusal(503, 'VAULT_OFF', VAULT_OFF_COPY);
  const body = await openDocument(found.row);
  if (!body) return documentNotFound();
  return new Response(body, {
    status: 200,
    headers: {
      ...DOCUMENT_FILE_HEADERS,
      'Content-Type': found.row.mime,
      'Content-Length': String(found.row.byteSize),
      'Content-Disposition': contentDisposition(found.row.title, found.row.mime)
    }
  });
};
