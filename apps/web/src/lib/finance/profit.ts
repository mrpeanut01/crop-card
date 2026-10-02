/**
 * Season profit (Phase 32F, F2-6 to F2-13). Pure: the server reads the
 * season's ledger entries, stock uses and time rows and hands them in.
 *
 * Two kinds of number, never mixed:
 *   - cash: what the ledger says came in and went out. Totals reconcile to
 *     the entries exactly.
 *   - derived: stock used times the lot's unit cost, and logged minutes
 *     times the owner's labour rate. Shown per enterprise, never added
 *     into cash.
 * A purchase expense linked to a stock lot is cash out on the farm total
 * but never an enterprise cost: the lot reaches enterprises only through
 * what was used from it (F2-11). A use whose lot has no cost is counted as
 * unknown, never as $0 (F2-8).
 */

import { t } from '$lib/i18n';

export type EnterpriseKind = 'crop' | 'group' | 'animal' | 'tag' | 'area' | 'farm';

export interface MoneyLink {
  cropId?: string | null;
  fieldId?: string | null;
  animalId?: string | null;
  animalGroupId?: string | null;
  enterprise?: string | null;
}

export interface ProfitLedgerRow extends MoneyLink {
  id: string;
  kind: 'expense' | 'income';
  occurredAt: number;
  amountCents: number;
  stockLotId?: string | null;
  deletedAt?: number | null;
}

/** One use of stock, already attributed by the server (F2-7). */
export interface StockUseRow {
  occurredAt: number;
  /** Units taken out of the lot, positive. */
  units: number;
  /** Null when the lot has no cost or received nothing. */
  unitCostCents: number | null;
  link: MoneyLink | null;
  /** Adjustments, spills and expiry: the farm's "Stock lost or adjusted". */
  lost?: boolean;
  /** A spray or fertility use with no planting, put on its Area. */
  notTiedToPlanting?: boolean;
}

export interface TimeRow {
  minutes: number;
  cropId: string | null;
}

export interface GroupWindow {
  groupId: string;
  fromMs: number | null;
  toMs: number | null;
}

export interface SeasonProfitInput {
  entries: readonly ProfitLedgerRow[];
  stockUses: readonly StockUseRow[];
  timeRows: readonly TimeRow[];
  labourRateCentsPerHour: number | null;
  /** Planting id to crop plugin id. */
  plantingPlugin: Readonly<Record<string, string>>;
  /** An animal's group memberships over time (`lib/animals/membership.ts`). */
  animalGroups?: Readonly<Record<string, readonly GroupWindow[]>>;
  labels?: {
    crop?: Readonly<Record<string, string>>;
    group?: Readonly<Record<string, string>>;
    animal?: Readonly<Record<string, string>>;
    area?: Readonly<Record<string, string>>;
  };
}

export interface CashTotals {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
}

export interface EnterpriseProfit {
  key: string;
  kind: EnterpriseKind;
  label: string;
  incomeCents: number;
  directExpenseCents: number;
  inputCostCents: number;
  inputCostUnknownCount: number;
  labourMinutes: number;
  /** Null when no rate is set, or for animals (no time links to them). */
  labourCents: number | null;
  labourNotCounted: boolean;
  /** Some input cost is from sprays or feeding not tied to one planting. */
  includesAreaInputs: boolean;
  /** Income less direct expense and known input cost. */
  netCents: number;
  /** `netCents` less labour, when labour has a cost. */
  netAfterLabourCents: number | null;
}

export interface UnallocatedTotals {
  incomeCents: number;
  directExpenseCents: number;
  inputCostCents: number;
  inputCostUnknownCount: number;
  labourMinutes: number;
  labourCents: number | null;
}

export interface SeasonProfit {
  cash: CashTotals;
  enterprises: EnterpriseProfit[];
  unallocated: UnallocatedTotals;
  /** Cash spent on lots, which reaches enterprises only through use. */
  lotPurchaseCents: number;
  labourRateCentsPerHour: number | null;
}

export const NOT_TIED_LABEL = 'Not tied to anything';
export const STOCK_LOST_LABEL = 'Stock lost or adjusted';
const STOCK_LOST_KEY = 'farm:stock-lost';

export function notTiedLabel(locale?: string | null): string {
  return locale ? t(locale, 'finance.notTied') : NOT_TIED_LABEL;
}

/** An enterprise's name for display: the stock-lost row in `locale`. */
export function enterpriseName(e: { key: string; label: string }, locale?: string | null): string {
  return locale && e.key === STOCK_LOST_KEY ? t(locale, 'finance.stockLost') : e.label;
}

const KIND_ORDER: Record<EnterpriseKind, number> = {
  crop: 0,
  group: 1,
  animal: 2,
  tag: 3,
  area: 4,
  farm: 5
};

interface Resolved {
  key: string;
  kind: EnterpriseKind;
  label: string;
}

function groupAt(windows: readonly GroupWindow[] | undefined, atMs: number): string | null {
  if (!windows) return null;
  for (const w of windows) {
    if ((w.fromMs === null || w.fromMs <= atMs) && (w.toMs === null || atMs < w.toMs)) {
      return w.groupId;
    }
  }
  return null;
}

export function normalizeTag(tag: string | null | undefined): string | null {
  const t = tag?.trim().replace(/\s+/g, ' ');
  return t ? t.toLowerCase() : null;
}

/** F2-6: one enterprise per entry or use, first match wins. Null means
 *  "Not tied to anything". */
export function resolveEnterprise(
  link: MoneyLink | null,
  atMs: number,
  input: Pick<SeasonProfitInput, 'plantingPlugin' | 'animalGroups' | 'labels'>
): Resolved | null {
  if (!link) return null;
  const labels = input.labels ?? {};
  if (link.cropId) {
    const plugin = input.plantingPlugin[link.cropId];
    if (plugin) {
      return { key: `crop:${plugin}`, kind: 'crop', label: labels.crop?.[plugin] ?? plugin };
    }
  }
  const group =
    link.animalGroupId ??
    (link.animalId ? groupAt(input.animalGroups?.[link.animalId], atMs) : null);
  if (group) {
    return { key: `group:${group}`, kind: 'group', label: labels.group?.[group] ?? 'Animal group' };
  }
  if (link.animalId) {
    return {
      key: `animal:${link.animalId}`,
      kind: 'animal',
      label: labels.animal?.[link.animalId] ?? 'Animal'
    };
  }
  const tag = normalizeTag(link.enterprise);
  if (tag) {
    return { key: `tag:${tag}`, kind: 'tag', label: link.enterprise!.trim().replace(/\s+/g, ' ') };
  }
  if (link.fieldId) {
    return {
      key: `area:${link.fieldId}`,
      kind: 'area',
      label: labels.area?.[link.fieldId] ?? 'Area'
    };
  }
  return null;
}

function labourCost(minutes: number, rate: number | null): number | null {
  return rate === null ? null : Math.round((minutes * rate) / 60);
}

function blank(r: Resolved): EnterpriseProfit {
  return {
    ...r,
    incomeCents: 0,
    directExpenseCents: 0,
    inputCostCents: 0,
    inputCostUnknownCount: 0,
    labourMinutes: 0,
    labourCents: null,
    labourNotCounted: r.kind === 'group' || r.kind === 'animal',
    includesAreaInputs: false,
    netCents: 0,
    netAfterLabourCents: null
  };
}

export function seasonProfit(input: SeasonProfitInput): SeasonProfit {
  const rate = input.labourRateCentsPerHour;
  const byKey = new Map<string, EnterpriseProfit>();
  const unallocated: UnallocatedTotals = {
    incomeCents: 0,
    directExpenseCents: 0,
    inputCostCents: 0,
    inputCostUnknownCount: 0,
    labourMinutes: 0,
    labourCents: null
  };
  const cash: CashTotals = { incomeCents: 0, expenseCents: 0, netCents: 0 };
  let lotPurchaseCents = 0;

  const at = (r: Resolved): EnterpriseProfit => {
    let e = byKey.get(r.key);
    if (!e) {
      e = blank(r);
      byKey.set(r.key, e);
    }
    return e;
  };

  for (const entry of input.entries) {
    if (entry.deletedAt) continue;
    if (entry.kind === 'income') {
      cash.incomeCents += entry.amountCents;
      const r = resolveEnterprise(entry, entry.occurredAt, input);
      if (r) at(r).incomeCents += entry.amountCents;
      else unallocated.incomeCents += entry.amountCents;
      continue;
    }
    cash.expenseCents += entry.amountCents;
    if (entry.stockLotId) {
      lotPurchaseCents += entry.amountCents;
      continue;
    }
    const r = resolveEnterprise(entry, entry.occurredAt, input);
    if (r) at(r).directExpenseCents += entry.amountCents;
    else unallocated.directExpenseCents += entry.amountCents;
  }
  cash.netCents = cash.incomeCents - cash.expenseCents;

  for (const use of input.stockUses) {
    if (!(use.units > 0)) continue;
    const r = use.lost
      ? { key: STOCK_LOST_KEY, kind: 'farm' as const, label: STOCK_LOST_LABEL }
      : resolveEnterprise(use.link, use.occurredAt, input);
    const known = use.unitCostCents === null ? null : Math.round(use.units * use.unitCostCents);
    if (r) {
      const e = at(r);
      if (known === null) e.inputCostUnknownCount += 1;
      else e.inputCostCents += known;
      if (use.notTiedToPlanting) e.includesAreaInputs = true;
    } else if (known === null) {
      unallocated.inputCostUnknownCount += 1;
    } else {
      unallocated.inputCostCents += known;
    }
  }

  for (const t of input.timeRows) {
    if (!(t.minutes > 0)) continue;
    const r = t.cropId ? resolveEnterprise({ cropId: t.cropId }, 0, input) : null;
    if (r) at(r).labourMinutes += t.minutes;
    else unallocated.labourMinutes += t.minutes;
  }
  unallocated.labourCents = labourCost(unallocated.labourMinutes, rate);

  const enterprises = [...byKey.values()]
    .map((e) => {
      const labourCents = e.labourNotCounted ? null : labourCost(e.labourMinutes, rate);
      const netCents = e.incomeCents - e.directExpenseCents - e.inputCostCents;
      return {
        ...e,
        labourCents,
        netCents,
        netAfterLabourCents: labourCents === null ? null : netCents - labourCents
      };
    })
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.label.localeCompare(b.label) ||
        a.key.localeCompare(b.key)
    );

  return { cash, enterprises, unallocated, lotPurchaseCents, labourRateCentsPerHour: rate };
}
