import { DEFAULT_PREFS, formatQuantity, type Prefs } from '$lib/prefs';

export interface RatePreviewInput {
  amount: number;
  unit: string;
}

export type RatePreview =
  | { kind: 'calibrated'; label: string; gpa: number }
  | { kind: 'uncalibrated'; label: string }
  | { kind: 'no-sprayer'; label: string };

const G_PER_OZ = 28.349523125;
const ACRES_PER_HA = 2.471053814671653;

function metricRate(rate: RatePreviewInput, prefs: Pick<Prefs, 'units'>): string | null {
  const { amount, unit } = rate;
  if (!Number.isFinite(amount)) return null;
  switch (unit.toLowerCase()) {
    case 'fl-oz':
    case 'fl oz':
    case 'floz':
      return formatQuantity(amount, 'flOzPerArea', prefs);
    case 'pt':
      return formatQuantity(amount * 16, 'flOzPerArea', prefs);
    case 'qt':
      return formatQuantity(amount * 32, 'flOzPerArea', prefs);
    case 'gal':
      return formatQuantity(amount, 'volumePerArea', prefs);
    case 'lb':
      return formatQuantity(amount, 'weightPerArea', prefs);
    case 'oz':
      return `${Math.round(amount * G_PER_OZ * ACRES_PER_HA).toLocaleString('en-US')} g/ha`;
    default:
      return null;
  }
}

export function herbicideRatePreview(
  rate: RatePreviewInput,
  sprayer: { calibratedGpa: number | null } | null | undefined,
  prefs: Pick<Prefs, 'units'> = DEFAULT_PREFS
): RatePreview {
  const metric = prefs.units === 'metric';
  const rateMetric = metric ? metricRate(rate, prefs) : null;
  const base = `${rate.amount} ${rate.unit}/A${rateMetric ? ` (${rateMetric})` : ''}`;
  if (!sprayer) return { kind: 'no-sprayer', label: `${base} · pick a sprayer for GPA` };
  const gpa = sprayer.calibratedGpa;
  if (gpa == null || !Number.isFinite(gpa) || gpa <= 0) {
    return { kind: 'uncalibrated', label: `${base} · sprayer uncalibrated` };
  }
  const gpaMetric = metric ? ` (${formatQuantity(gpa, 'volumePerArea', prefs)})` : '';
  return { kind: 'calibrated', label: `${base} @ ${gpa} GPA${gpaMetric}`, gpa };
}
