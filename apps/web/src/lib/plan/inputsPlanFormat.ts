import { DEFAULT_PREFS, formatArea, formatQuantity, UNITS, type Prefs } from '$lib/prefs';
import { numberToLocaleString } from '$lib/intlCache';
import type { InputsPlanApplication } from './inputsPlan';

type ProductCategory = InputsPlanApplication['productCategory'];

const US_UNIT_LABEL: Record<string, string> = { 'fl-oz': 'fl oz' };

const METRIC_UNIT: Record<string, { factor: number; unit: string }> = {
  lb: { factor: 0.45359237, unit: 'kg' },
  oz: { factor: 28.349523125, unit: 'g' },
  'fl-oz': { factor: 29.5735295625, unit: 'mL' },
  pt: { factor: 0.473176473, unit: 'L' },
  qt: { factor: 0.946352946, unit: 'L' },
  gal: { factor: 3.785411784, unit: 'L' },
  ton: { factor: 907.18474, unit: 'kg' }
};

const ACRES_PER_HA = UNITS.perArea.toMetric(1);

function num(v: number, maxDigits: number): string {
  return numberToLocaleString(v, 'en-US', { maximumFractionDigits: maxDigits });
}

function metricDigits(v: number): number {
  const a = Math.abs(v);
  return a >= 100 ? 0 : a >= 10 ? 1 : 2;
}

/** An Inputs Plan amount in the product's native unit. Fertilizer
 *  converts fully for metric users; pesticide amounts stay label-unit
 *  first with the metric equivalent in parentheses. */
export function formatInputAmount(
  amount: number,
  unit: string,
  category: ProductCategory,
  prefs: Pick<Prefs, 'units'> = DEFAULT_PREFS,
  perArea = false
): string {
  const us = `${num(amount, 2)} ${US_UNIT_LABEL[unit] ?? unit}${perArea ? '/ac' : ''}`;
  const m = METRIC_UNIT[unit];
  if (prefs.units !== 'metric' || !m) return us;
  const v = amount * m.factor * (perArea ? ACRES_PER_HA : 1);
  const metric = `${num(v, metricDigits(v))} ${m.unit}${perArea ? '/ha' : ''}`;
  return category === 'fertilizer' ? metric : `${us} (${metric})`;
}

/** "22 fl oz/ac × 2.5 ac = 55 fl oz" in the user's units. */
export function formatApplicationRateLine(
  app: Pick<
    InputsPlanApplication,
    'rateAmount' | 'rateUnit' | 'acres' | 'totalAmount' | 'productCategory'
  >,
  prefs: Pick<Prefs, 'units'> = DEFAULT_PREFS
): string | null {
  if (app.rateAmount == null || !app.rateUnit) return null;
  const rate = formatInputAmount(app.rateAmount, app.rateUnit, app.productCategory, prefs, true);
  const area = formatArea(app.acres, prefs);
  const total = formatInputAmount(app.totalAmount ?? 0, app.rateUnit, app.productCategory, prefs);
  return `${rate} × ${area} = ${total}`;
}

/** "125–150 lb/ac" (or kg/ha) for a sourced N need range (#739). */
export function formatNeedRange(
  range: { min: number; max: number },
  prefs: Pick<Prefs, 'units'> = DEFAULT_PREFS
): string {
  const max = formatQuantity(range.max, 'weightPerArea', prefs);
  if (range.min === range.max) return max;
  return `${formatQuantity(range.min, 'weightPerArea', prefs, { bare: true })}–${max}`;
}

/** The nutrients of a pre-plant budget that are typical estimates while
 *  its N is sourced (#739 ruling N739-3), e.g. "P₂O₅, K₂O". Empty when the
 *  whole budget shares one provenance. */
export function typicalNutrientsText(
  app: Pick<InputsPlanApplication, 'budgetProvenance' | 'nutrientProvenance'>
): string {
  const prov = app.nutrientProvenance;
  if (app.budgetProvenance !== 'data' || !prov) return '';
  const names = { n: 'N', p: 'P₂O₅', k: 'K₂O' } as const;
  return (['n', 'p', 'k'] as const)
    .filter((k) => prov[k] === 'fallback')
    .map((k) => names[k])
    .join(', ');
}

/** Rewrites the planner's fertility "N lb/ac" / "lb-N/ac" figures in a
 *  rationale for metric users. The planner itself keeps US units (its
 *  text also feeds the AI refinement prompt). */
export function localizeRationale(
  text: string,
  prefs: Pick<Prefs, 'units'> = DEFAULT_PREFS
): string {
  if (prefs.units !== 'metric') return text;
  return text.replace(/(\d+(?:\.\d+)?) lb(-N)?\/ac\b/g, (_m, v: string, n: string | undefined) => {
    const [amount, unit] = formatQuantity(Number(v), 'weightPerArea', prefs).split(' ');
    return n ? `${amount} ${unit.replace('/', '-N/')}` : `${amount} ${unit}`;
  });
}
