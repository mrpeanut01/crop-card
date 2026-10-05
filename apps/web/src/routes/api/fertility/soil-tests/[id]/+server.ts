import { t } from '$lib/i18n';
/**
 * PATCH  /api/fertility/soil-tests/:id — attach, replace or remove the lab
 *        report (`{ documentId }`, null removes it). Owner only (A-36).
 * DELETE /api/fertility/soil-tests/:id
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { deleteSoilTest } from '$lib/db/admin';
import { setSoilTestDocument } from '$lib/db/documents';
import { soilTestDocumentPatchSchema } from '$lib/documents/apiSchemas';
import { requireOwner } from '$lib/server/auth';
import { checkLabReport } from '$lib/server/soilTestDocument';

export const _requestSchema = soilTestDocumentPatchSchema;

export const PATCH: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const id = event.params.id;
  if (!id) throw error(400, t(event.locals?.locale, 'stockui.api.idRequired'));
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidJsonShort') },
      { status: 400 }
    );
  }
  const parsed = soilTestDocumentPatchSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: t(event.locals?.locale, 'stockui.api.invalidRequest'),
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }
  const { documentId } = parsed.data;
  if (documentId) {
    const refused = checkLabReport(documentId, event.locals?.locale);
    if (refused) return refused;
  }
  if (!setSoilTestDocument(id, documentId, user.id)) {
    return json({ error: t(event.locals?.locale, 'api.err.soilTestNotFound') }, { status: 404 });
  }
  return json({ soilTest: { id, documentId } });
};

export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  if (!event.params.id) throw error(400, t(event.locals?.locale, 'stockui.api.idRequired'));
  return json(deleteSoilTest(event.params.id));
};
