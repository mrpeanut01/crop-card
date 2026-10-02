/** F2-4: the fixed ledger categories. Client-safe; the CSV and the entry
 *  form read the labels from here. */

import { t, type MessageKey } from '$lib/i18n';

export const LEDGER_KINDS = ['expense', 'income'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const EXPENSE_CATEGORIES = [
  'seed-and-plants',
  'fertility',
  'pest-control',
  'feed',
  'animal-health',
  'equipment-and-repairs',
  'fuel',
  'labour-paid',
  'supplies',
  'other'
] as const;

export const INCOME_CATEGORIES = [
  'produce-sale',
  'animal-product-sale',
  'animal-sale',
  'other'
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type LedgerCategory = ExpenseCategory | IncomeCategory;

export const LEDGER_CATEGORY_LABEL: Record<LedgerCategory, string> = {
  'seed-and-plants': 'Seed and plants',
  fertility: 'Fertility',
  'pest-control': 'Pest control',
  feed: 'Feed',
  'animal-health': 'Animal health',
  'equipment-and-repairs': 'Equipment and repairs',
  fuel: 'Fuel',
  'labour-paid': 'Labour paid',
  supplies: 'Supplies',
  other: 'Other',
  'produce-sale': 'Produce sale',
  'animal-product-sale': 'Animal product sale',
  'animal-sale': 'Animal sale'
};

export function categoriesFor(kind: LedgerKind): readonly LedgerCategory[] {
  return kind === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
}

export function isCategoryFor(kind: LedgerKind, category: string): category is LedgerCategory {
  return (categoriesFor(kind) as readonly string[]).includes(category);
}

const CATEGORY_KEY: Record<LedgerCategory, MessageKey> = {
  'seed-and-plants': 'finance.cat.seedAndPlants',
  fertility: 'finance.cat.fertility',
  'pest-control': 'finance.cat.pestControl',
  feed: 'finance.cat.feed',
  'animal-health': 'finance.cat.animalHealth',
  'equipment-and-repairs': 'finance.cat.equipment',
  fuel: 'finance.cat.fuel',
  'labour-paid': 'finance.cat.labourPaid',
  supplies: 'finance.cat.supplies',
  other: 'finance.cat.other',
  'produce-sale': 'finance.cat.produceSale',
  'animal-product-sale': 'finance.cat.animalProductSale',
  'animal-sale': 'finance.cat.animalSale'
};

/** The CSV passes no locale and stays English. */
export function categoryLabel(category: string | null | undefined, locale?: string | null): string {
  if (!category) return locale ? t(locale, 'finance.cat.other') : 'Other';
  const key = CATEGORY_KEY[category as LedgerCategory];
  if (locale && key) return t(locale, key);
  return LEDGER_CATEGORY_LABEL[category as LedgerCategory] ?? category;
}

/** The expense category a stock item's purchase most likely belongs to,
 *  used to prefill "Record purchase as expense". */
export function expenseCategoryForStock(stockCategory: string): ExpenseCategory {
  switch (stockCategory) {
    case 'seed':
      return 'seed-and-plants';
    case 'fertilizer':
      return 'fertility';
    case 'herbicide':
    case 'insecticide':
    case 'fungicide':
      return 'pest-control';
    case 'feed':
    case 'bedding':
      return 'feed';
    case 'animal-health':
      return 'animal-health';
    case 'fuel':
      return 'fuel';
    case 'part':
      return 'equipment-and-repairs';
    default:
      return 'supplies';
  }
}
