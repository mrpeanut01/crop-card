import { getDocument } from '$lib/db/documents';
import { isPhotoKind } from '$lib/documents/kinds';
import { documentRefusal } from './documentAccess';

/** A soil test may point only at a live, non-photo document of this Owner
 *  (A-16, A-35). Returns the refusal, or null when it is fine. */
export function checkLabReport(documentId: string): Response | null {
  const doc = getDocument(documentId, { includeDeleted: true });
  if (!doc) return documentRefusal(400, 'FOREIGN_REF', 'unknown documentId');
  if (doc.deletedAt) {
    return documentRefusal(
      409,
      'DOCUMENT_DELETED',
      'This file was deleted, so it cannot be attached.'
    );
  }
  if (isPhotoKind(doc.kind)) {
    return documentRefusal(
      409,
      'PHOTO_DOCUMENT',
      'Photos stay with their journal entry or animal.'
    );
  }
  return null;
}
