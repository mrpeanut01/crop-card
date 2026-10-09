/**
 * #820 (rulings SC-1 to SC-6): a label's cap on the total product per acre
 * in a crop year or season, counted against the other applications of the
 * same product on the same block.
 *
 * - The total is per acre on both sides, so the block's area is never read
 *   (SC-6). Every pass is a whole-block pass.
 * - Over the cap on the amounts that are known is a stop with no override
 *   (SC-1), whatever else is unknown.
 * - An application with no rate on file, saved with a custom rate (the
 *   custom amount is not stored), or in a unit that does not convert makes
 *   the verdict `unknown` (SC-2): a warning that never reads as under the
 *   cap.
 * - "per 365 days" is any 365-day window holding this pass; every other
 *   wording is the farm-local calendar year of this pass (SC-3).
 * - Applications on the block count whatever crop they were saved against;
 *   the caller includes deleted applications that were applied and leaves
 *   out only "never applied" ones (SC-4).
 */

import type { SafetyViolation } from './types';
import { localDateKey, localDayStartMs } from './animalWithdrawal';

export type SeasonCapPeriod = 'crop-year' | 'season' | 'growing-season' | 'year' | '365-days';

export interface SeasonCapRow {
  cropPluginIds: readonly string[];
  amount: number;
  unit: string;
  period: SeasonCapPeriod;
}

export interface SeasonCapRate {
  amount: number;
  unit: string;
}

/** Another application of a product on the block. `rate` is null when the
 *  amount put down is not known. */
export interface SeasonCapApplication {
  id: string;
  pluginId: string;
  occurredAt: number;
  rate: SeasonCapRate | null;
}

export interface SeasonCapProduct {
  pluginId: string;
  displayName: string;
  /** This pass's rate per acre; null when it is not known. */
  rate: SeasonCapRate | null;
  caps: readonly SeasonCapRow[];
}

export interface SeasonCapContext {
  occurredAt: number;
  /** Every crop on the sprayed block. */
  cropPluginIds: readonly string[];
  products: readonly SeasonCapProduct[];
  /** Other applications on the block, not including this pass. */
  others: readonly SeasonCapApplication[];
  timeZone: string;
}

export type SeasonCapUnknown = 'this-pass-rate' | 'earlier-rate' | 'unit';

export interface SeasonCapVerdict {
  pluginId: string;
  displayName: string;
  cap: SeasonCapRow;
  /** The window the total was counted over (for "per 365 days", the
   *  fullest window holding this pass). */
  windowStartMs: number;
  windowEndMs: number;
  /** Known amounts in the cap's unit: the other applications in the window,
   *  and this pass (null when not known). */
  othersKnown: number;
  thisPass: number | null;
  /** Known total, this pass included when known. */
  knownTotal: number;
  /** Applications in the window whose amount is not known. */
  unknownIds: string[];
  unknown: SeasonCapUnknown[];
  status: 'within' | 'over' | 'unknown';
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ROLLING_MS = 365 * DAY_MS;

const LIQUID_FL_OZ: Record<string, number> = { 'fl-oz': 1, pt: 16, qt: 32, gal: 128 };
const MASS_OZ: Record<string, number> = { oz: 1, lb: 16 };

/** `amount` of `from` in `to`, or null when one is a volume and the other a
 *  weight (or either is not a label rate unit). */
export function convertRateAmount(amount: number, from: string, to: string): number | null {
  if (!Number.isFinite(amount)) return null;
  if (from === to) return amount;
  if (from in LIQUID_FL_OZ && to in LIQUID_FL_OZ) {
    return (amount * LIQUID_FL_OZ[from]) / LIQUID_FL_OZ[to];
  }
  if (from in MASS_OZ && to in MASS_OZ) return (amount * MASS_OZ[from]) / MASS_OZ[to];
  return null;
}

function ymd(key: number): string {
  const y = Math.floor(key / 10000);
  const m = Math.floor((key % 10000) / 100);
  const d = key % 100;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The farm-local calendar year holding `ms`, as [start, end). */
export function localYearBounds(ms: number, timeZone: string): [number, number] {
  const year = Math.floor(localDateKey(ms, timeZone) / 10000);
  const start = localDayStartMs(ymd(year * 10000 + 101), timeZone);
  const end = localDayStartMs(ymd((year + 1) * 10000 + 101), timeZone);
  if (start === null || end === null) {
    return [Date.UTC(year, 0, 1) - DAY_MS, Date.UTC(year + 1, 0, 1) + DAY_MS];
  }
  return [start, end];
}

/** The widest span of other applications that can share a window with a
 *  pass at `occurredAt`, so a caller reads them in one query. */
export function seasonCapReadSpan(
  occurredAt: number,
  periods: readonly SeasonCapPeriod[],
  timeZone: string
): [number, number] | null {
  if (periods.length === 0) return null;
  let from = Infinity;
  let to = -Infinity;
  for (const p of periods) {
    const [a, b] =
      p === '365-days'
        ? [occurredAt - ROLLING_MS + 1, occurredAt + ROLLING_MS]
        : localYearBounds(occurredAt, timeZone);
    from = Math.min(from, a);
    to = Math.max(to, b);
  }
  return [from, to];
}

/** The cap rows that apply to a product on a block with these crops. */
export function capsForCrops(
  caps: readonly SeasonCapRow[] | undefined,
  cropPluginIds: readonly string[]
): SeasonCapRow[] {
  const crops = new Set(cropPluginIds);
  return (caps ?? []).filter((c) => c.cropPluginIds.some((id) => crops.has(id)));
}

const EPS = 1e-9;

function judge(
  product: SeasonCapProduct,
  cap: SeasonCapRow,
  occurredAt: number,
  others: readonly SeasonCapApplication[],
  timeZone: string
): SeasonCapVerdict {
  const thisPass = product.rate
    ? convertRateAmount(product.rate.amount, product.rate.unit, cap.unit)
    : null;
  const unknown = new Set<SeasonCapUnknown>();
  if (!product.rate) unknown.add('this-pass-rate');
  else if (thisPass === null) unknown.add('unit');

  const same = others.filter((o) => o.pluginId === product.pluginId);
  const sumIn = (from: number, to: number) => {
    let known = 0;
    const unknownIds: string[] = [];
    const reasons = new Set<SeasonCapUnknown>();
    for (const o of same) {
      if (o.occurredAt < from || o.occurredAt >= to) continue;
      if (!o.rate) {
        unknownIds.push(o.id);
        reasons.add('earlier-rate');
        continue;
      }
      const a = convertRateAmount(o.rate.amount, o.rate.unit, cap.unit);
      if (a === null) {
        unknownIds.push(o.id);
        reasons.add('unit');
        continue;
      }
      known += a;
    }
    return { known, unknownIds, reasons };
  };

  let windowStartMs: number;
  let windowEndMs: number;
  let best: ReturnType<typeof sumIn>;
  if (cap.period === '365-days') {
    const starts = new Set<number>([occurredAt - ROLLING_MS + 1, occurredAt]);
    for (const o of same) {
      if (o.occurredAt > occurredAt - ROLLING_MS && o.occurredAt <= occurredAt) {
        starts.add(o.occurredAt);
      }
    }
    windowStartMs = occurredAt - ROLLING_MS + 1;
    windowEndMs = windowStartMs + ROLLING_MS;
    let most = sumIn(windowStartMs, windowEndMs).known;
    for (const s of starts) {
      const known = sumIn(s, s + ROLLING_MS).known;
      if (known > most + EPS) {
        most = known;
        windowStartMs = s;
        windowEndMs = s + ROLLING_MS;
      }
    }
    const reach = sumIn(occurredAt - ROLLING_MS + 1, occurredAt + ROLLING_MS);
    best = { known: most, unknownIds: reach.unknownIds, reasons: reach.reasons };
  } else {
    [windowStartMs, windowEndMs] = localYearBounds(occurredAt, timeZone);
    best = sumIn(windowStartMs, windowEndMs);
  }
  for (const r of best.reasons) unknown.add(r);

  const knownTotal = best.known + (thisPass ?? 0);
  const status =
    knownTotal > cap.amount * (1 + EPS) + EPS ? 'over' : unknown.size > 0 ? 'unknown' : 'within';
  return {
    pluginId: product.pluginId,
    displayName: product.displayName,
    cap,
    windowStartMs,
    windowEndMs,
    othersKnown: best.known,
    thisPass,
    knownTotal,
    unknownIds: best.unknownIds,
    unknown: [...unknown],
    status
  };
}

/** One verdict per product and cap row that applies to the sprayed crops. */
export function evaluateSeasonCaps(ctx: SeasonCapContext): SeasonCapVerdict[] {
  const out: SeasonCapVerdict[] = [];
  for (const product of ctx.products) {
    const seen = new Set<string>();
    for (const cap of capsForCrops(product.caps, ctx.cropPluginIds)) {
      const key = `${cap.amount}|${cap.unit}|${cap.period}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(judge(product, cap, ctx.occurredAt, ctx.others, ctx.timeZone));
    }
  }
  return out;
}

const PERIOD_TEXT: Record<SeasonCapPeriod, string> = {
  'crop-year': 'per crop year',
  season: 'per season',
  'growing-season': 'per growing season',
  year: 'per year',
  '365-days': 'per 365 days'
};

function amountText(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function unitText(unit: string): string {
  return unit === 'fl-oz' ? 'fl oz' : unit;
}

/** SC-1: a stop for every verdict over the cap. */
export function seasonCapViolations(verdicts: readonly SeasonCapVerdict[]): SafetyViolation[] {
  return verdicts
    .filter((v) => v.status === 'over')
    .map((v) => ({
      code: 'SEASON_CAP_EXCEEDED' as const,
      message:
        `${v.displayName}: ${amountText(v.knownTotal)} ${unitText(v.cap.unit)}/acre on this block ` +
        `would exceed the label limit of ${amountText(v.cap.amount)} ${unitText(v.cap.unit)}/acre ` +
        `${PERIOD_TEXT[v.cap.period]}.`,
      detail: {
        pluginId: v.pluginId,
        cap: v.cap,
        knownTotal: v.knownTotal,
        othersKnown: v.othersKnown,
        thisPass: v.thisPass,
        windowStartMs: v.windowStartMs,
        windowEndMs: v.windowEndMs,
        unknownIds: v.unknownIds
      }
    }));
}

export function checkSeasonCaps(ctx: SeasonCapContext): SafetyViolation[] {
  return seasonCapViolations(evaluateSeasonCaps(ctx));
}
