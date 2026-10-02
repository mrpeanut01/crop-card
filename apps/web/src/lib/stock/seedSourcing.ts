/**
 * Organic seed sourcing on a seed stock lot (33B, B3, contract C-B3).
 * Client-safe. The app records what the owner says and which suppliers
 * were checked; it never judges whether a search was enough (O-14, B-39).
 */

import { t, type MessageKey } from '$lib/i18n';

export const SEED_ORGANIC_STATUSES = ['organic', 'untreated', 'treated', 'unknown'] as const;
export type SeedOrganicStatus = (typeof SEED_ORGANIC_STATUSES)[number];

export const SEED_ORGANIC_STATUS_LABEL: Readonly<Record<SeedOrganicStatus, string>> = {
  organic: 'Organic seed',
  untreated: 'Untreated, not organic',
  treated: 'Treated seed',
  unknown: 'Not known'
};

const SEED_ORGANIC_STATUS_KEYS: Readonly<Record<SeedOrganicStatus, MessageKey>> = {
  organic: 'stockui.seedsrc.status.organic',
  untreated: 'stockui.seedsrc.status.untreated',
  treated: 'stockui.seedsrc.status.treated',
  unknown: 'stockui.seedsrc.status.unknown'
};

/** `SEED_ORGANIC_STATUS_LABEL` in the UI locale (exports keep the English map). */
export function seedOrganicStatusLabel(status: SeedOrganicStatus, locale?: string | null): string {
  return t(locale, SEED_ORGANIC_STATUS_KEYS[status]);
}

export const MAX_SOURCES_CHECKED = 30;
export const SUPPLIER_MAX = 120;
export const RESULT_MAX = 200;
export const UNAVAILABILITY_NOTE_MAX = 1000;

/** Plain suggestions for the free-text result (B-37). Not an enum. */
export const SOURCE_RESULT_SUGGESTIONS = [
  'No organic seed of this variety',
  'Out of stock',
  'Not in the quantity needed'
] as const;

export interface SeedSourceCheck {
  supplier: string;
  /** Farm-local `YYYY-MM-DD`. */
  checkedAt: string;
  result: string;
}

export interface SeedSourcing {
  status: SeedOrganicStatus | null;
  sourcesChecked: SeedSourceCheck[];
  unavailabilityNote: string | null;
}

/** A vault document linked to the lot as search evidence. */
export interface SeedEvidenceDoc {
  id: string;
  linkId: string;
  title: string;
  kind: string;
}

export interface LotSeedSourcing extends SeedSourcing {
  documents: SeedEvidenceDoc[];
}

/** One lot in the seed sourcing list (B-40), for the pack and pages. */
export interface SeedSourcingRow extends SeedSourcing {
  stockItemId: string;
  stockLotId: string;
  itemName: string;
  lotNumber: string | null;
  supplier: string | null;
  receivedAt: number;
  documentIds: string[];
}

export type SeedSearchFlag = 'no-search-on-file' | 'not-recorded';

export const SEED_SEARCH_FLAG_LABEL: Readonly<Record<SeedSearchFlag, string>> = {
  'no-search-on-file': 'No search on file',
  'not-recorded': 'Seed status not recorded'
};

const SEED_SEARCH_FLAG_KEYS: Readonly<Record<SeedSearchFlag, MessageKey>> = {
  'no-search-on-file': 'stockui.seedsrc.flag.noSearch',
  'not-recorded': 'stockui.seedsrc.flag.notRecorded'
};

/** `SEED_SEARCH_FLAG_LABEL` in the UI locale. */
export function seedSearchFlagLabel(flag: SeedSearchFlag, locale?: string | null): string {
  return t(locale, SEED_SEARCH_FLAG_KEYS[flag]);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isValidYmd(s: string): boolean {
  if (!YMD.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function isCheck(v: unknown): v is SeedSourceCheck {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.supplier === 'string' &&
    o.supplier.trim().length > 0 &&
    typeof o.checkedAt === 'string' &&
    isValidYmd(o.checkedAt) &&
    typeof o.result === 'string' &&
    o.result.trim().length > 0
  );
}

/** Tolerant: bad JSON or bad items yield []. Never throws. */
export function parseSourcesChecked(json: string | null | undefined): SeedSourceCheck[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isCheck)
    .slice(0, MAX_SOURCES_CHECKED)
    .map((c) => ({ supplier: c.supplier, checkedAt: c.checkedAt, result: c.result }));
}

/** B-39: flag a lot nobody searched for, or nobody answered. Organic seed
 *  and any lot with a check on file get no flag. */
export function seedSearchFlag(s: SeedSourcing): SeedSearchFlag | null {
  if (s.status === null) return 'not-recorded';
  if (s.status === 'organic') return null;
  return s.sourcesChecked.length === 0 ? 'no-search-on-file' : null;
}

/** Newest check first, for display. */
export function sortChecks(checks: readonly SeedSourceCheck[]): SeedSourceCheck[] {
  return [...checks].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
}
