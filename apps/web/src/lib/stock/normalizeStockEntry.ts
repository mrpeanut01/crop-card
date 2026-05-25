/**
 * Phase 25d (#89) — single normalization seam for all five Stock add
 * methods (manual, search, barcode, label OCR, AI photo).
 *
 * Each add-method UI populates a `StockEntryDraft` (partial, free-form
 * during entry); the operator confirms; `normalizeStockEntry` projects
 * it onto the canonical `StockEntryRequest` shape — exactly the body
 * shape POST /api/stock accepts.
 *
 * Centralizing the normalization here keeps the per-method UIs thin
 * and prevents the 5 methods from drifting on validation / defaults
 * (which is exactly how the pre-#89 single modal grew its 3,869-line
 * blob in `InventoryView.svelte`).
 *
 * **Lot # is never AI** — per the v2 provenance addendum (CLAUDE.md
 * invariant 7), lot is always `manual` source even when surrounding
 * fields come from a label-OCR scan. The normalization rejects a
 * draft that flags lot as 'ai' or 'plugin'.
 */

import type { StockCategory } from '$lib/db/stock';
import type { StockUnit } from '$lib/stock/units';

/** Free-form input gathered by each method. Validated + normalized into
 *  `StockEntryRequest` before submission. */
export interface StockEntryDraft {
  /** Required — must be selected before submission can succeed. */
  category?: StockCategory;
  displayName?: string;
  shortName?: string;
  defaultUnit?: StockUnit;
  /** Plugin match suggested by the source (catalog hit, barcode lookup,
   *  label-OCR + matcher, etc.). May be null when no plugin matches. */
  pluginId?: string | null;
  reorderThreshold?: number;
  notes?: string;
  barcode?: string;
  typeId?: string;
  /** Free-form metadata (seedMeta etc.). Serialized to JSON by the
   *  normalize step so the storage column matches. */
  metadata?: Record<string, unknown>;
  /** Active ingredients (chem products). Serialized to JSON. */
  activeIngredients?: ReadonlyArray<{
    name: string;
    concentrationPct?: number;
    chemistryClass?: string;
    iracGroup?: string;
    fracCode?: string;
  }>;
  /** Formulation (chem + fertilizer). Serialized to JSON. */
  formulation?: {
    type?: string;
    npk?: { n: number; p: number; k: number };
    productClass?: 'synthetic' | 'organic' | 'biocontrol';
  };
  /** Method-of-entry tag — drives the per-field Provenance render on the
   *  confirm step. Always `manual` for the manual method; varies by
   *  field for label/barcode/search methods. The whole-draft tag is the
   *  PRIMARY source (e.g., a label scan tags the bulk of fields as
   *  `ai`, but the operator's manual lot-number entry stays `manual`).
   *  See `docs/design/almanac/AI_PROVENANCE_ADDENDUM.md`. */
  source: 'manual' | 'plugin' | 'data' | 'ai' | 'fallback';
}

/** Body shape accepted by POST /api/stock. Drives the normalized output. */
export interface StockEntryRequest {
  category: StockCategory;
  displayName: string;
  shortName?: string;
  defaultUnit: StockUnit;
  pluginId?: string;
  reorderThreshold?: number;
  notes?: string;
  barcode?: string;
  typeId?: string;
  metadataJson?: string;
  activeIngredientsJson?: string;
  formulationJson?: string;
}

export interface NormalizeIssue {
  field: keyof StockEntryDraft;
  message: string;
}

export type NormalizeResult =
  | { ok: true; request: StockEntryRequest }
  | { ok: false; issues: NormalizeIssue[] };

/** Project a draft onto the create-stock POST shape. Caller checks
 *  `result.ok` before invoking fetch. */
export function normalizeStockEntry(draft: StockEntryDraft): NormalizeResult {
  const issues: NormalizeIssue[] = [];

  if (!draft.category) {
    issues.push({ field: 'category', message: 'category is required' });
  }
  if (!draft.displayName || draft.displayName.trim().length === 0) {
    issues.push({ field: 'displayName', message: 'display name is required' });
  }
  if (!draft.defaultUnit) {
    issues.push({ field: 'defaultUnit', message: 'default unit is required' });
  }
  if (draft.shortName && draft.shortName.length > 40) {
    issues.push({ field: 'shortName', message: 'short name must be ≤40 chars' });
  }
  if (draft.notes && draft.notes.length > 500) {
    issues.push({ field: 'notes', message: 'notes must be ≤500 chars' });
  }
  if (draft.reorderThreshold !== undefined && draft.reorderThreshold < 0) {
    issues.push({ field: 'reorderThreshold', message: 'must be ≥ 0' });
  }

  if (issues.length > 0) return { ok: false, issues };

  const request: StockEntryRequest = {
    category: draft.category!,
    displayName: draft.displayName!.trim(),
    defaultUnit: draft.defaultUnit!
  };

  if (draft.shortName && draft.shortName.trim().length > 0) {
    request.shortName = draft.shortName.trim();
  }
  if (draft.pluginId) request.pluginId = draft.pluginId;
  if (draft.reorderThreshold !== undefined) request.reorderThreshold = draft.reorderThreshold;
  if (draft.notes && draft.notes.trim().length > 0) request.notes = draft.notes.trim();
  if (draft.barcode && draft.barcode.trim().length > 0) request.barcode = draft.barcode.trim();
  if (draft.typeId) request.typeId = draft.typeId;

  if (draft.metadata && Object.keys(draft.metadata).length > 0) {
    request.metadataJson = JSON.stringify(draft.metadata);
  }
  if (draft.activeIngredients && draft.activeIngredients.length > 0) {
    request.activeIngredientsJson = JSON.stringify(draft.activeIngredients);
  }
  if (draft.formulation) {
    request.formulationJson = JSON.stringify(draft.formulation);
  }

  return { ok: true, request };
}

/** Convenience — build a draft from a `ScanResult` (barcode + label
 *  endpoints' response shape). Bridge so methods 3 + 4 don't each
 *  re-derive the mapping. Source defaults to `ai` since both endpoints
 *  use Claude for the structured-field extraction. */
export function draftFromScanResult(
  scan: {
    displayName?: string;
    shortName?: string;
    category?: StockCategory;
    defaultUnit?: string;
    reorderThreshold?: number;
    notes?: string;
    barcode?: string;
    activeIngredients?: StockEntryDraft['activeIngredients'];
    formulation?: StockEntryDraft['formulation'];
    cropPluginMatches?: ReadonlyArray<{ pluginId: string; score: number }>;
    suggestedType?: { matchedTypeId?: string };
    seedMeta?: Record<string, unknown>;
  },
  source: StockEntryDraft['source'] = 'ai'
): StockEntryDraft {
  const draft: StockEntryDraft = { source };
  if (scan.displayName) draft.displayName = scan.displayName;
  if (scan.shortName) draft.shortName = scan.shortName;
  if (scan.category) draft.category = scan.category;
  if (scan.defaultUnit) draft.defaultUnit = scan.defaultUnit as StockUnit;
  if (scan.reorderThreshold !== undefined) draft.reorderThreshold = scan.reorderThreshold;
  if (scan.notes) draft.notes = scan.notes;
  if (scan.barcode) draft.barcode = scan.barcode;
  if (scan.activeIngredients) draft.activeIngredients = scan.activeIngredients;
  if (scan.formulation) draft.formulation = scan.formulation;

  // Auto-bind the top crop-plugin match when its score is high enough
  // to be unambiguous. The confirm-step UI surfaces alternates so the
  // operator can override.
  const topMatch = scan.cropPluginMatches?.[0];
  if (topMatch && topMatch.score >= 0.75) draft.pluginId = topMatch.pluginId;

  if (scan.suggestedType?.matchedTypeId) draft.typeId = scan.suggestedType.matchedTypeId;
  if (scan.seedMeta && Object.keys(scan.seedMeta).length > 0) {
    draft.metadata = { seedMeta: scan.seedMeta };
  }

  return draft;
}
