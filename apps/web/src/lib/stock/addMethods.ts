/**
 * Phase 25d (#89) — env-driven enabled-methods resolver for the Stock
 * 5-method add waterfall.
 *
 * `STOCK_ADD_METHODS=manual,search,barcode,label` enables those tabs.
 * Default = all four when the env var is absent. `photo` is reserved
 * for the Phase 26 AI-photo-extract method (deferred per #89).
 *
 * Caller (the /stock/add loader) reads STOCK_ADD_METHODS from
 * `$env/dynamic/private` and passes the raw string here; this module
 * has no $env import so it stays unit-testable + safe to import from
 * client code if needed.
 */

export const ALL_STOCK_ADD_METHODS = ['manual', 'search', 'barcode', 'label', 'photo'] as const;
export type StockAddMethod = (typeof ALL_STOCK_ADD_METHODS)[number];

const DEFAULT_METHODS: StockAddMethod[] = ['manual', 'search', 'barcode', 'label'];

export interface MethodMeta {
  id: StockAddMethod;
  label: string;
  description: string;
}

export const METHOD_META: Record<StockAddMethod, MethodMeta> = {
  manual: {
    id: 'manual',
    label: 'Type it in',
    description: 'Fill in the fields by hand. Works offline, no API key needed.'
  },
  search: {
    id: 'search',
    label: 'Search',
    description:
      'Look up by name in your plugin library, then the marketplace, then ask Claude. AI assists, never gates.'
  },
  barcode: {
    id: 'barcode',
    label: 'Scan barcode',
    description: 'Point your camera at the package barcode. Resolves via OpenFoodFacts + Claude.'
  },
  label: {
    id: 'label',
    label: 'Scan label',
    description: 'Take a photo of the label. Claude vision extracts the active-ingredient block.'
  },
  photo: {
    id: 'photo',
    label: 'Photo extract',
    description: 'Phase 26 — full bottle/bag photo → vision-extracted draft.'
  }
};

export function parseEnabledMethods(raw: string | undefined): StockAddMethod[] {
  if (!raw || raw.trim().length === 0) return [...DEFAULT_METHODS];
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const valid = parts.filter((p): p is StockAddMethod =>
    ALL_STOCK_ADD_METHODS.includes(p as StockAddMethod)
  );
  // Preserve the env-var ordering — operators can pin manual first by
  // setting `STOCK_ADD_METHODS=manual,barcode,label,search`.
  return valid.length > 0 ? [...new Set(valid)] : [...DEFAULT_METHODS];
}
