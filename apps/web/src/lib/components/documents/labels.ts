import { createT, type MessageKey, type Translator } from '$lib/i18n';
import {
  BACKUP_COPY_NOTE,
  VAULT_OFF_COPY,
  type DocumentKind,
  type DocumentSubjectType
} from '$lib/documents/kinds';

export const DOCUMENT_KIND_KEYS = {
  'lab-report': 'docs.kind.lab-report',
  certificate: 'docs.kind.certificate',
  label: 'docs.kind.label',
  receipt: 'docs.kind.receipt',
  'seed-search': 'docs.kind.seed-search',
  'forage-test': 'docs.kind.forage-test',
  photo: 'docs.kind.photo',
  other: 'docs.kind.other',
  'journal-photo': 'docs.kind.journal-photo',
  'animal-photo': 'docs.kind.animal-photo'
} as const satisfies Record<DocumentKind, MessageKey>;

export const DOCUMENT_SUBJECT_KEYS = {
  'soil-test': 'docs.subject.soil-test',
  'stock-lot': 'docs.subject.stock-lot',
  animal: 'docs.subject.animal',
  'animal-group': 'docs.subject.animal-group',
  'animal-health': 'docs.subject.animal-health',
  field: 'docs.subject.field',
  block: 'docs.subject.block',
  'harvest-event': 'docs.subject.harvest-event',
  'ledger-entry': 'docs.subject.ledger-entry',
  'organic-status': 'docs.subject.organic-status',
  'amendment-batch': 'docs.subject.amendment-batch',
  'forage-test': 'docs.subject.forage-test',
  farm: 'docs.subject.farm'
} as const satisfies Record<DocumentSubjectType, MessageKey>;

/** English messages produced by `lib/documents` (client and kinds) that the
 *  UI shows verbatim; anything else (a server `error`) passes through. */
const KNOWN_COPY: Record<string, MessageKey> = {
  [VAULT_OFF_COPY]: 'docs.copy.vaultOff',
  [BACKUP_COPY_NOTE]: 'docs.copy.backupNote',
  'Uploads need a connection.': 'docs.copy.needsConnection',
  'Only the farm owner can upload files.': 'docs.copy.ownerOnly',
  'This file is bigger than 20 MB. Use a smaller file.': 'docs.copy.tooBig',
  "We couldn't save this file. Try again.": 'docs.copy.saveFailed'
};

export function localizeDocCopy(tr: Translator, message: string): string {
  const key = KNOWN_COPY[message];
  return key && createT('en')(key) === message ? tr(key) : message;
}
