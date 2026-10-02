import { error, type ServerLoad } from '@sveltejs/kit';
import {
  documentsCursor,
  listDocuments,
  liveDocumentBytes,
  liveDocumentTotalsByKind
} from '$lib/db/documents';
import { requireOwnerId } from '$lib/db/tenant';
import { DOCUMENTS_PAGE_SIZE } from '$lib/documents/apiSchemas';
import { DOCUMENT_KINDS, PHOTO_DOCUMENT_KINDS, type DocumentKind } from '$lib/documents/kinds';
import { storageCapBytes } from '$lib/server/billing/plans';
import { toDocumentMeta } from '$lib/server/documentAccess';
import { isInteractiveOwner } from '$lib/server/interactiveOwner';
import { vaultStatus } from '$lib/server/vault/store';
import { t } from '$lib/i18n';

export const load: ServerLoad = (event) => {
  const user = event.locals.user;
  if (!user) throw error(401, t(event.locals.locale, 'settings.err.signIn'));
  if (user.role !== 'owner') return { isOwner: false as const };

  const rows = listDocuments({ excludeKinds: PHOTO_DOCUMENT_KINDS, limit: DOCUMENTS_PAGE_SIZE });
  const totals = liveDocumentTotalsByKind();
  const kindTotals = DOCUMENT_KINDS.map((kind: DocumentKind) => ({
    kind,
    count: totals.get(kind)?.count ?? 0,
    bytes: totals.get(kind)?.bytes ?? 0
  }));
  return {
    isOwner: true as const,
    vaultEnabled: vaultStatus().enabled,
    usedBytes: liveDocumentBytes(),
    capBytes: storageCapBytes(requireOwnerId()),
    canDelete: isInteractiveOwner(event, user),
    kindTotals,
    documents: toDocumentMeta(rows),
    ...documentsCursor(rows)
  };
};
