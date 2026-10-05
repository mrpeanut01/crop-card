import { formatQuantity, type Prefs, type Quantity } from '$lib/prefs';
import type { CardFact } from '../model';
import type { SnapshotMinMax, SnapshotSeedingRate } from '../snapshot';
import type { ResolvedOptions } from './common';
import { formatInches } from './size';

const SQFT_PER_SQM = 10.763910416709722;

function range(r: SnapshotMinMax, q: Quantity, prefs: Pick<Prefs, 'units'>): string {
  const a = formatQuantity(r.min, q, prefs, { bare: true });
  const b = formatQuantity(r.max, q, prefs, { bare: true });
  const unit = formatQuantity(r.max, q, prefs).slice(b.length);
  return a === b ? `${a}${unit}` : `${a}–${b}${unit}`;
}

function perSqFt(r: SnapshotMinMax, opts: ResolvedOptions): string {
  const metric = opts.prefs.units === 'metric';
  const conv = (n: number) => Math.round(metric ? n * SQFT_PER_SQM : n);
  const a = conv(r.min);
  const b = conv(r.max);
  const n = a === b ? `${a}` : `${a}–${b}`;
  return opts.tr(metric ? 'cards.fact.perSqM' : 'cards.fact.perSqFt', { n });
}

/** Seeding facts for a crop sown by area: what the sources print, never a
 *  derived in-row distance. */
export function seedingFacts(
  rate: SnapshotSeedingRate | undefined,
  opts: ResolvedOptions
): CardFact[] {
  if (!rate) return [];
  const { tr, prefs } = opts;
  const facts: CardFact[] = [];
  const push = (label: string, value: string) => facts.push({ label, value, provenance: 'plugin' });
  const weight = (r: SnapshotMinMax) => {
    const value = range(r, 'weightPerArea', prefs);
    if (!rate.seedBasis) return value;
    return tr('cards.fact.withBasis', { value, basis: tr(`cards.fact.seedBasis.${rate.seedBasis}`) });
  };
  if (rate.drilledLbsPerAcre) push(tr('cards.fact.seedDrilled'), weight(rate.drilledLbsPerAcre));
  if (rate.drilledSeedsPerSqFt)
    push(tr('cards.fact.seedPerSqFt'), perSqFt(rate.drilledSeedsPerSqFt, opts));
  if (rate.broadcastLbsPerAcre)
    push(tr('cards.fact.seedBroadcast'), weight(rate.broadcastLbsPerAcre));
  if (rate.seedsPerAcre)
    push(tr('cards.fact.seedPopulation'), range(rate.seedsPerAcre, 'perArea', prefs));
  if (rate.drillRowSpacingIn)
    push(tr('cards.fact.drillRows'), formatInches(rate.drillRowSpacingIn, prefs));
  return facts;
}
