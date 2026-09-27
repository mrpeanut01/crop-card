/** Plain copy for withdrawal and grazing holds on the animal pages (C-33).
 *  Client-safe. */

import {
  FOODS,
  formatClearDate,
  type Food,
  type FoodHold,
  type FoodHoldSummary
} from '$lib/safety/animalWithdrawal';
import type { ExposureVerdict } from '$lib/safety/grazingExposure';

/** A food's hold from the withdrawal rule, with the grazing exposure rule
 *  folded in: `grazed` names the sprayed products, `grazedFieldIds` the
 *  Areas where the owner can add a missing grazing time. */
export type DisplayHold = FoodHoldSummary & { grazed?: string[]; grazedFieldIds?: string[] };

export type HoldSummaries = Record<Food, DisplayHold>;

/** The 422 body of a food or sale declaration either food rule stopped. */
export interface FoodStop {
  error: string;
  code: string;
  clearsOn?: string | null;
  products?: string[];
  askOwner?: boolean;
  grazingFieldIds?: string[];
  nextStep?:
    'wait' | 'last-dose' | 'add-withdrawal' | 'contact-support' | 'add-grazing-time' | 'never';
  holdEndsOn?: string | null;
}

/** Any stop the food gate raises: nothing overrides it and it can always be
 *  saved again as discarded, whichever rule (withdrawal or grazing) fired. */
export function isFoodStop(body: unknown): body is FoodStop {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.error === 'string' &&
    typeof b.code === 'string' &&
    b.resubmitAs === 'discard' &&
    b.overridable === false
  );
}

/** C-33: the foods to show for a subject: the ones its species gives, meat
 *  for any animal that is or was a food animal, and no milk or eggs for a
 *  male. Display only; the gate and the stored verdict cover every food. */
export function displayFoods(
  species: { products?: readonly string[]; foodProducingDefault?: boolean } | null,
  sex: string | null | undefined,
  foodProducing: boolean
): Food[] {
  const products = species?.products ?? [];
  const male = sex === 'male' || sex === 'neutered-male';
  return FOODS.filter((food) => {
    if (food === 'meat') {
      return products.includes('meat') || foodProducing || species?.foodProducingDefault === true;
    }
    return products.includes(food) && !male;
  });
}

/** Folds the grazing exposure verdict for one food into its withdrawal
 *  summary. The stricter reading wins. */
export function withExposure(h: FoodHoldSummary, ex: ExposureVerdict): DisplayHold {
  if (ex.status === 'safe') return h;
  const grazed = ex.products;
  const grazedFieldIds = [...new Set(ex.holds.map((x) => x.fieldId))];
  const extra = { grazed, grazedFieldIds };
  if (h.status === 'prohibited') return { ...h, ...extra };
  if (h.status === 'unknown' || ex.clearsAtMs === null) {
    return { status: 'unknown', products: h.status === 'clear' ? [] : h.products, ...extra };
  }
  if (h.status === 'hold') {
    return { ...h, clearsAtMs: Math.max(h.clearsAtMs, ex.clearsAtMs), ...extra };
  }
  return { status: 'hold', clearsAtMs: ex.clearsAtMs, products: [], ...extra };
}

export interface HoldChip {
  food: Food;
  tone: 'hold' | 'unknown' | 'prohibited';
  title: string;
  detail: string | null;
  /** The unknown comes from a missing grazing time, not a withdrawal. */
  grazingUnknown: boolean;
  withdrawalUnknown: boolean;
}

function products(list: readonly string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function detailOf(h: DisplayHold): string | null {
  const parts: string[] = [];
  if (h.status !== 'clear' && h.products.length) parts.push(products(h.products));
  if (h.grazed?.length) parts.push(`grazed where ${products(h.grazed)} was sprayed`);
  if (parts.length === 0) return null;
  const text = parts.join('; ');
  return `${text[0].toUpperCase()}${text.slice(1)}`;
}

/** One chip per shown food that is on hold; nothing when all are clear. */
export function holdChips(
  holds: HoldSummaries | null | undefined,
  timeZone: string,
  foods: readonly Food[] = FOODS
): HoldChip[] {
  if (!holds) return [];
  const out: HoldChip[] = [];
  for (const food of FOODS) {
    if (!foods.includes(food)) continue;
    const h = holds[food];
    if (!h || h.status === 'clear') continue;
    const grazedOnly = h.status !== 'prohibited' && h.products.length === 0 && !!h.grazed?.length;
    if (h.status === 'hold') {
      out.push({
        food,
        tone: 'hold',
        title: Number.isFinite(h.clearsAtMs)
          ? `HOLD ${food} until ${formatClearDate(h.clearsAtMs, timeZone)}`
          : `HOLD ${food}`,
        detail: detailOf(h),
        grazingUnknown: false,
        withdrawalUnknown: false
      });
    } else if (h.status === 'unknown') {
      out.push({
        food,
        tone: 'unknown',
        title: grazedOnly
          ? `HOLD ${food}: grazing time not known`
          : `HOLD ${food}: withdrawal not known`,
        detail: detailOf(h),
        grazingUnknown: !!h.grazedFieldIds?.length,
        withdrawalUnknown: h.products.length > 0
      });
    } else {
      out.push({
        food,
        tone: 'prohibited',
        title: `Never for food: ${food}`,
        detail: `${products(h.products)} is banned in food animals (${h.cfr.join(', ')}).`,
        grazingUnknown: false,
        withdrawalUnknown: false
      });
    }
  }
  return out;
}

/** One line for a single treatment's stored verdict on one food. */
export function holdLine(food: Food, hold: FoodHold, timeZone: string): string | null {
  switch (hold.status) {
    case 'none':
      return null;
    case 'until':
      return `${food[0].toUpperCase()}${food.slice(1)} clear from ${formatClearDate(hold.clearsAtMs, timeZone)}`;
    case 'unknown':
      return `${food[0].toUpperCase()}${food.slice(1)}: withdrawal not known`;
    case 'prohibited':
      return `${food[0].toUpperCase()}${food.slice(1)}: never for food`;
  }
}

/** Where the owner adds the grazing time from a label for an Area. */
export function grazingTimeHref(fieldId: string): string {
  return `/plan/areas/${encodeURIComponent(fieldId)}/grazing`;
}
