/** Phase 33C amendment batch vocabulary. Client-safe; mirrors the enums in
 *  `lib/db/schema.ts` (a test keeps them equal). */

import { t } from '$lib/i18n';

export const BATCH_KINDS = ['manure', 'compost', 'bedding-pack'] as const;
export type BatchKind = (typeof BATCH_KINDS)[number];

export const BATCH_ORIGINS = ['on-farm', 'bought'] as const;
export type BatchOrigin = (typeof BATCH_ORIGINS)[number];

export const INPUT_TYPES = ['animal', 'group', 'batch', 'stock-lot'] as const;
export type InputType = (typeof INPUT_TYPES)[number];

export const SUPPLIER_STATEMENT_VALUES = ['says-none', 'unknown', 'none-asked'] as const;
export type SupplierStatement = (typeof SUPPLIER_STATEMENT_VALUES)[number];

export const BATCH_KIND_LABELS: Readonly<Record<BatchKind, string>> = {
  manure: 'Manure pile',
  compost: 'Compost',
  'bedding-pack': 'Bedding pack'
};

export const SUPPLIER_STATEMENT_LABELS: Readonly<Record<SupplierStatement, string>> = {
  'says-none': 'The supplier says no carryover weed killer was used',
  unknown: 'The supplier does not know',
  'none-asked': 'Not asked yet'
};

export function batchKindLabel(kind: BatchKind, locale?: string | null): string {
  return locale ? t(locale, `amend.kind.${kind}`) : BATCH_KIND_LABELS[kind];
}

export function supplierStatementLabel(v: SupplierStatement, locale?: string | null): string {
  return locale ? t(locale, `amend.statement.${v}`) : SUPPLIER_STATEMENT_LABELS[v];
}

/** M-38: stock categories that can go into a pile. */
export const AMENDMENT_LOT_CATEGORIES = ['feed', 'bedding', 'fertilizer'] as const;

/** M-39: categories a lot can carry a hay cutting link on. */
export const HAY_LOT_CATEGORIES = ['feed', 'bedding'] as const;

export const BATCH_NAME_MAX = 80;
export const BATCH_NOTES_MAX = 1000;
export const SUPPLIER_MAX = 120;
