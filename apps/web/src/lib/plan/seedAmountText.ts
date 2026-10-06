/**
 * #555: the words for a crop sown by area, shared by the wizard, the
 * designer, the Planting card, the Care Guide and /plan/wheat so their
 * numbers agree. Client-safe; locale goes through `t()`.
 */

import { t } from '$lib/i18n';
import { formatArea } from '$lib/prefs';
import {
  formatSeedAmount,
  seedAmountFor,
  SQFT_PER_ACRE,
  type SeedAmount,
  type SeedingPurpose,
  type SowMethod,
  type SpacingModel
} from './spacingModel';

type Units = 'us' | 'metric';

/** "1,200 sq ft", "111 m²" or "0.5 ac". */
export function areaText(sqft: number, units: Units): string {
  return formatArea(sqft / SQFT_PER_ACRE, { units });
}

export function sowMethodLabel(method: SowMethod, locale?: string | null): string {
  return t(locale, `plan.area.method.${method}`);
}

/** #576: "rate for green manure", for a source rate given for one purpose. */
export function purposeText(purpose: SeedingPurpose, locale?: string | null): string {
  return t(locale, `plan.area.purpose.${purpose}`);
}

/** #576 (PU-4): the purpose goes on every line that shows or is sized from
 *  a purpose-tagged source rate, never on the farmer's own rate. */
export function withPurpose(
  text: string,
  purpose: SeedingPurpose | undefined,
  locale?: string | null
): string {
  return purpose
    ? t(locale, 'plan.area.withPurpose', { text, purpose: purposeText(purpose, locale) })
    : text;
}

/** The purpose of an area crop's source rates, if the source gives one. */
export function modelPurpose(model: SpacingModel): SeedingPurpose | undefined {
  return model.kind === 'area' ? model.purpose : undefined;
}

/** "Broadcast: 3.2–4.1 lb for 1,200 sq ft", plus the source's purpose when
 *  it gives one ("…, rate for green manure"). */
export function seedAmountText(
  amount: SeedAmount,
  sqft: number,
  units: Units,
  locale?: string | null
): string {
  const params = {
    method: sowMethodLabel(amount.method, locale),
    amount: formatSeedAmount(amount, units),
    area: areaText(sqft, units)
  };
  const text =
    amount.kind === 'seeds'
      ? t(locale, 'plan.area.amountSeeds', params)
      : t(locale, 'plan.area.amountWeight', params);
  return withPurpose(text, amount.provenance === 'data' ? amount.purpose : undefined, locale);
}

export interface SeedAmountLine {
  text: string;
  /** `data` for a sourced rate, `manual` for the farmer's own. Null when
   *  the amount is not known. */
  provenance: 'data' | 'manual' | null;
}

/** The seed line for `sqft` of a crop sown by area: the amount from the
 *  source's range, or the "not known" sentence (never a number). */
export function seedAmountLine(
  model: SpacingModel,
  method: SowMethod | null | undefined,
  sqft: number,
  units: Units,
  locale?: string | null,
  manualLbPerAcre?: number | null
): SeedAmountLine {
  const amount = seedAmountFor(model, method, sqft, manualLbPerAcre);
  if (!amount) return { text: t(locale, 'plan.area.notKnown'), provenance: null };
  return { text: seedAmountText(amount, sqft, units, locale), provenance: amount.provenance };
}
