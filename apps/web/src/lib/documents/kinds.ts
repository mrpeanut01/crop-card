/** Client-safe copies of the document enums in `lib/db/schema.ts`
 *  (contract C-1). `kinds.test.ts` keeps them identical. */

import { dateToLocaleDateString } from '$lib/intlCache';
import { intlLocale } from '$lib/prefs';
export const DOCUMENT_KINDS = [
  'lab-report',
  'certificate',
  'label',
  'receipt',
  'seed-search',
  'forage-test',
  'photo',
  'other',
  'journal-photo',
  'animal-photo'
] as const;
export const PHOTO_DOCUMENT_KINDS = ['journal-photo', 'animal-photo'] as const;
export const DOCUMENT_SUBJECT_TYPES = [
  'soil-test',
  'stock-lot',
  'animal',
  'animal-group',
  'animal-health',
  'field',
  'block',
  'harvest-event',
  'ledger-entry',
  'organic-status',
  'amendment-batch',
  'forage-test',
  'farm'
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type DocumentSubjectType = (typeof DOCUMENT_SUBJECT_TYPES)[number];
export type PhotoDocumentKind = (typeof PHOTO_DOCUMENT_KINDS)[number];

export function isPhotoKind(kind: string): kind is PhotoDocumentKind {
  return (PHOTO_DOCUMENT_KINDS as readonly string[]).includes(kind);
}

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  'lab-report': 'Lab reports',
  certificate: 'Certificates',
  label: 'Product labels',
  receipt: 'Receipts',
  'seed-search': 'Seed search records',
  'forage-test': 'Forage tests',
  photo: 'Photos',
  other: 'Other files',
  'journal-photo': 'Journal photos',
  'animal-photo': 'Animal photos'
};

export const DOCUMENT_SUBJECT_LABEL: Record<DocumentSubjectType, string> = {
  'soil-test': 'soil test',
  'stock-lot': 'inventory lot',
  animal: 'animal',
  'animal-group': 'animal group',
  'animal-health': 'animal health record',
  field: 'Area',
  block: 'bed or block',
  'harvest-event': 'harvest record',
  'ledger-entry': 'money record',
  'organic-status': 'organic status entry',
  'amendment-batch': 'manure or compost batch',
  'forage-test': 'forage test',
  farm: 'farm'
};

/** Decimal units everywhere (A-24): 1 MB is 1,000,000 bytes. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 KB';
  if (bytes < 1_000_000) return `${Math.max(bytes === 0 ? 0 : 1, Math.round(bytes / 1000))} KB`;
  if (bytes < 1_000_000_000) {
    const mb = bytes / 1_000_000;
    return `${mb < 100 ? trim(mb, 1) : Math.round(mb)} MB`;
  }
  const gb = bytes / 1_000_000_000;
  return `${gb < 100 ? trim(gb, 1) : Math.round(gb)} GB`;
}

function trim(n: number, digits: number): string {
  return n.toFixed(digits).replace(/\.0+$/, '');
}

export const DOCUMENT_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,text/csv,.csv';

export const HEIC_DOCUMENT_COPY =
  "HEIC photos can't be stored. Save it as a JPEG or PDF and upload that.";

export const BACKUP_COPY_NOTE =
  "When you delete a file, it is removed at once. Our storage provider's backup copies are removed within 30 days.";

export const VAULT_OFF_COPY = "Document storage isn't set up yet.";

/** A day in the viewer's own time zone, for dates fetched in the browser. */
export function formatLocalDay(iso: string, locale?: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return dateToLocaleDateString(d, intlLocale(locale), {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}
