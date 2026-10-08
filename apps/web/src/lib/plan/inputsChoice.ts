/**
 * #480 — client-safe helpers for the Inputs step's product picker: the
 * option shape the planner attaches to each application, swapping the
 * chosen product, and the shopping list that follows from the choices.
 * Type-only imports so the wizard can use it in the browser.
 */

import { ALL_STOCK_UNITS, convert, type StockUnit } from '$lib/stock/units';
import type { InputsPlanApplication, InputsPlanShoppingItem } from './inputsPlan';
import type { RateProvenance } from '$lib/plugins/rateProvenance';

/** How much of a product the farm already has for one application. */
export type StockCoverage = 'enough' | 'some' | 'none';

export const STOCK_COVERAGE_RANK: Record<StockCoverage, number> = { enough: 0, some: 1, none: 2 };

/** One product the farmer may pick for an application: philosophy-allowed,
 *  and for a post-emergent herbicide safe on the crop. Rates are worked
 *  out for this application (fertilizer rates depend on the soil budget). */
export interface InputsPlanProductOption {
  pluginId: string;
  displayName: string;
  rateAmount: number | null;
  rateUnit: string | null;
  /** Herbicides: `fallback` when the rate is typical, not from the label. */
  rateProvenance?: RateProvenance | null;
  totalAmount: number | null;
  onHand: number;
  stock: StockCoverage;
}

/** Where the product on an application came from. */
export type ProductSource = 'plugin' | 'data' | 'ai' | 'manual';

/** A stock balance in the unit the stock is kept in. */
export interface StockAmount {
  amount: number;
  unit: string;
}

function asStockUnit(unit: string | null | undefined): StockUnit | null {
  if (!unit) return null;
  const u = unit.trim().toLowerCase().replace(/\s+/g, '-');
  const norm = u === 'floz' || u === 'fl.-oz' || u === 'fl.oz' ? 'fl-oz' : u;
  return (ALL_STOCK_UNITS as ReadonlyArray<string>).includes(norm) ? (norm as StockUnit) : null;
}

/** `amount` of `from` expressed in `to`, or null when the two cannot be
 *  compared (a volume against a weight, or an unknown unit). */
export function convertAmount(amount: number, from: string, to: string): number | null {
  if (from === to) return amount;
  const f = asStockUnit(from);
  const t = asStockUnit(to);
  if (!f || !t) return null;
  return convert(amount, f, t);
}

/** Stock on hand expressed in `unit`. 0 when there is none; null when
 *  there is some but none of it is in a unit that converts to `unit`. */
export function onHandInUnit(
  balances: ReadonlyArray<StockAmount> | undefined,
  unit: string | null
): number | null {
  const held = (balances ?? []).filter((b) => b.amount > 0);
  if (held.length === 0) return 0;
  if (!unit) return null;
  let total = 0;
  let any = false;
  for (const b of held) {
    const v = convertAmount(b.amount, b.unit, unit);
    if (v == null) continue;
    total += v;
    any = true;
  }
  return any ? total : null;
}

/** Adds a balance, merging it into one already kept in a convertible unit. */
export function addStockAmount(balances: StockAmount[], amount: number, unit: string): void {
  if (!(amount > 0)) return;
  for (const b of balances) {
    const v = convertAmount(amount, unit, b.unit);
    if (v != null) {
      b.amount += v;
      return;
    }
  }
  balances.push({ amount, unit });
}

/** Takes `amount` (in `unit`) out of the balances it converts to. */
export function takeStockAmount(balances: StockAmount[], amount: number, unit: string): void {
  let left = amount;
  for (const b of balances) {
    if (!(left > 0)) return;
    const inB = convertAmount(left, unit, b.unit);
    if (inB == null || !(b.amount > 0)) continue;
    const used = Math.min(b.amount, inB);
    b.amount -= used;
    const back = convertAmount(used, b.unit, unit);
    left -= back ?? 0;
  }
}

/** `onHand` is null when the farm has the product but in a unit the
 *  application's rate cannot be compared with; that reads as "some". */
export function stockCoverage(onHand: number | null, need: number | null): StockCoverage {
  if (onHand == null) return 'some';
  if (!(onHand > 0)) return 'none';
  if (need == null || !(need > 0)) return 'some';
  return onHand + 1e-9 >= need ? 'enough' : 'some';
}

/** The application with `pluginId` chosen from its options, tagged
 *  `manual`. Returns null when the product is not one of its options. */
export function applyProductChoice(
  app: InputsPlanApplication,
  pluginId: string
): InputsPlanApplication | null {
  const option = app.options?.find((o) => o.pluginId === pluginId);
  if (!option) return null;
  if (app.productPluginId === pluginId && app.productSource === 'manual') return app;
  return {
    ...app,
    productPluginId: option.pluginId,
    productDisplayName: option.displayName,
    rateAmount: option.rateAmount,
    rateUnit: option.rateUnit,
    rateProvenance: option.rateProvenance ?? null,
    totalAmount: option.totalAmount,
    productSource: 'manual'
  };
}

/** Applies saved choices (application id → product id); ids that no
 *  longer exist or products that are not options are skipped. */
export function applyProductChoices(
  applications: ReadonlyArray<InputsPlanApplication>,
  choices: Readonly<Record<string, string>>
): InputsPlanApplication[] {
  return applications.map((a) => {
    const chosen = choices[a.id];
    return (chosen && applyProductChoice(a, chosen)) || a;
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A stock row for the shopping list. `unit` is the unit the stock is kept
 *  in; without it the balance is taken to be in the rate's unit. */
export interface ShoppingStockRow {
  pluginId?: string;
  onHand: number;
  unit?: string | null;
}

/** Consolidated buy list, collapsed by product across applications. The
 *  on-hand balance is converted to the rate's unit before it is compared;
 *  stock kept in a unit that cannot be converted is not counted, and the
 *  item says so. */
export function buildShoppingList(
  applications: ReadonlyArray<InputsPlanApplication>,
  stock: ReadonlyArray<ShoppingStockRow>
): InputsPlanShoppingItem[] {
  const byPlugin = new Map<
    string,
    {
      pluginId: string;
      category: InputsPlanShoppingItem['category'];
      displayName: string;
      unit: string;
      totalNeeded: number;
      appliesToPlantingIds: Set<string>;
    }
  >();

  for (const app of applications) {
    if (!app.productPluginId || app.totalAmount == null || !app.rateUnit) continue;
    const existing = byPlugin.get(app.productPluginId);
    if (existing) {
      const add = convertAmount(app.totalAmount, app.rateUnit, existing.unit) ?? app.totalAmount;
      existing.totalNeeded += add;
      existing.appliesToPlantingIds.add(app.plantingId);
    } else {
      byPlugin.set(app.productPluginId, {
        pluginId: app.productPluginId,
        category: app.productCategory,
        displayName: app.productDisplayName ?? app.productPluginId,
        unit: app.rateUnit,
        totalNeeded: app.totalAmount,
        appliesToPlantingIds: new Set([app.plantingId])
      });
    }
  }

  const rowsByPlugin = new Map<string, ShoppingStockRow[]>();
  for (const s of stock) {
    if (!s.pluginId) continue;
    const list = rowsByPlugin.get(s.pluginId) ?? [];
    list.push(s);
    rowsByPlugin.set(s.pluginId, list);
  }

  const items: InputsPlanShoppingItem[] = [];
  for (const item of byPlugin.values()) {
    const rows = rowsByPlugin.get(item.pluginId) ?? [];
    const onHand = onHandInUnit(
      rows.map((r) => ({ amount: r.onHand, unit: r.unit ?? item.unit })),
      item.unit
    );
    const known = onHand ?? 0;
    items.push({
      pluginId: item.pluginId,
      category: item.category,
      displayName: item.displayName,
      unit: item.unit,
      totalNeeded: round2(item.totalNeeded),
      onHand: round2(known),
      shortfall: Math.max(0, round2(item.totalNeeded - known)),
      ...(onHand == null ? mismatchFields(rows) : {}),
      appliesToPlantingIds: [...item.appliesToPlantingIds].sort()
    });
  }

  items.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.displayName.localeCompare(b.displayName);
  });
  return items;
}

/** The stock the rate could not be compared with, in the unit it is kept
 *  in, so the list never reads it as none on hand. */
function mismatchFields(
  rows: ReadonlyArray<ShoppingStockRow>
): Pick<InputsPlanShoppingItem, 'stockUnitMismatch' | 'stockOnHandInStockUnit'> {
  const unit = rows.find((r) => r.onHand > 0)?.unit ?? undefined;
  if (!unit) return {};
  const amount = onHandInUnit(
    rows.map((r) => ({ amount: r.onHand, unit: r.unit ?? unit })),
    unit
  );
  return {
    stockUnitMismatch: unit,
    ...(amount != null ? { stockOnHandInStockUnit: round2(amount) } : {})
  };
}

/** Flattens the plan's per-product balances into shopping-list rows.
 *  Accepts the older `pluginId → number` shape from saved drafts. */
export function stockRowsFrom(
  stockOnHand: Readonly<Record<string, ReadonlyArray<StockAmount> | number>>
): ShoppingStockRow[] {
  const rows: ShoppingStockRow[] = [];
  for (const [pluginId, v] of Object.entries(stockOnHand)) {
    if (typeof v === 'number') rows.push({ pluginId, onHand: v });
    else for (const b of v) rows.push({ pluginId, onHand: b.amount, unit: b.unit });
  }
  return rows;
}
