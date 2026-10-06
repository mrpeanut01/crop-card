import { createT, type MessageKey, type Translator } from '$lib/i18n';
import {
  BACKUP_COPY_NOTE,
  HEIC_DOCUMENT_COPY,
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
  [HEIC_DOCUMENT_COPY]: 'docs.copy.heic',
  'Uploads need a connection.': 'docs.copy.needsConnection',
  'Only the farm owner can upload files.': 'docs.copy.ownerOnly',
  'This file is bigger than 20 MB. Use a smaller file.': 'docs.copy.tooBig',
  "We couldn't save this file. Try again.": 'docs.copy.saveFailed',
  'The app is updating. Try again in a minute.': 'docs.copy.fenced',
  "The upload didn't say how big the file is. Try again from the app.": 'docs.copy.lengthRequired',
  "Your farm's file storage is full. Delete files or move to a bigger plan to upload more.":
    'docs.copy.storageFull',
  'This file is empty.': 'docs.copy.empty',
  'Nothing was saved because the record changed during the upload. Try again.': 'docs.copy.aborted',
  "The upload didn't arrive in one piece. Check your connection and try again.":
    'docs.copy.truncated',
  "This file type can't be stored. Use a PDF, JPEG, PNG, WebP or CSV file.":
    'docs.copy.unsupported',
  "This file couldn't be read. Save it again as a PDF, JPEG, PNG, WebP or CSV file and retry.":
    'docs.copy.unreadable',
  'This file was deleted, so it cannot be attached.': 'docs.copy.attachDeleted',
  'Photos stay with their journal entry or animal.': 'docs.copy.photoStays',
  'Remove this photo from its journal entry or animal.': 'docs.copy.photoRemove',
  'Only the owner, signed in on their own account, can delete a file.':
    'docs.copy.interactiveOwnerDelete'
};

const UNSUPPORTED_LIST = /^This file type can't be stored\. Use an? (.+) file\.$/;

export function localizeDocCopy(tr: Translator, message: string): string {
  const list = UNSUPPORTED_LIST.exec(message)?.[1];
  if (list && !KNOWN_COPY[message]) {
    if (tr('docs.copy.or') === createT('en')('docs.copy.or')) return message;
    return tr('docs.copy.unsupportedList', {
      list: list.replace(/ or /g, ` ${tr('docs.copy.or')} `)
    });
  }
  const key = KNOWN_COPY[message];
  return key && createT('en')(key) === message ? tr(key) : message;
}
