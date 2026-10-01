import { isPhotoKind, type DocumentKind, type DocumentSubjectType } from './kinds';

export type DocumentReaderRole = 'owner' | 'helper' | 'inspector';

/** Who each link subject lets read the file (A-31). */
const SUBJECT_READERS: Record<DocumentSubjectType, readonly DocumentReaderRole[]> = {
  'ledger-entry': ['owner'],
  farm: ['owner', 'inspector'],
  'organic-status': ['owner', 'inspector'],
  'soil-test': ['owner', 'helper', 'inspector'],
  'stock-lot': ['owner', 'helper', 'inspector'],
  animal: ['owner', 'helper', 'inspector'],
  'animal-group': ['owner', 'helper', 'inspector'],
  'animal-health': ['owner', 'helper', 'inspector'],
  field: ['owner', 'helper', 'inspector'],
  block: ['owner', 'helper', 'inspector'],
  'harvest-event': ['owner', 'helper', 'inspector'],
  'amendment-batch': ['owner', 'helper', 'inspector'],
  'forage-test': ['owner', 'helper', 'inspector']
};

/** A custom operator is a helper with a narrower job; it reads like one.
 *  Any role this file does not know reads nothing. */
export function readerRole(role: string): DocumentReaderRole | null {
  if (role === 'owner' || role === 'helper' || role === 'inspector') return role;
  if (role === 'custom-operator') return 'helper';
  return null;
}

/**
 * A-31. A document is readable when any of its links to a subject that
 * still exists grants the reader. With no such link it is owner only.
 * Photo kinds follow their journal entry or animal: any member of the farm.
 * Impersonating superadmins arrive here with the owner role.
 */
export function canReadDocument(
  role: DocumentReaderRole | string,
  doc: {
    kind: DocumentKind;
    links: { subjectType: DocumentSubjectType; subjectExists: boolean }[];
  }
): boolean {
  const reader = readerRole(role);
  if (!reader) return false;
  if (reader === 'owner') return true;
  if (isPhotoKind(doc.kind)) return true;
  return doc.links.some(
    (l) => l.subjectExists && (SUBJECT_READERS[l.subjectType] ?? []).includes(reader)
  );
}

/** Plain words for the link picker: who will be able to see the file. */
export function whoCanSee(subjectType: DocumentSubjectType): string {
  const readers = SUBJECT_READERS[subjectType];
  if (readers.length === 1) return 'Only you can see this file.';
  if (!readers.includes('helper')) return 'You and inspectors can see this file.';
  return 'Helpers and inspectors on this farm can see this file.';
}
