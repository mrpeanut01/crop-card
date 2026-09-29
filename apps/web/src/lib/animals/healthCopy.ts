/** Client-safe wording for the health and production pages. */

import { LOCK_WINDOW_MS } from '$lib/db/recordKinds';
import {
  HOLD_BEARING_KINDS,
  type HealthEventKind,
  type ProductionUse
} from '$lib/safety/animalWithdrawal';

export const HEALTH_KIND_LABEL: Record<HealthEventKind, string> = {
  treatment: 'Treatment',
  vaccination: 'Vaccine',
  deworm: 'Wormer',
  'vet-visit': 'Vet visit',
  injury: 'Injury',
  note: 'Note'
};

export const HEALTH_KIND_CHOICES = (Object.keys(HEALTH_KIND_LABEL) as HealthEventKind[]).map(
  (value) => ({ value, label: HEALTH_KIND_LABEL[value] })
);

export const ROUTE_CHOICES = [
  { value: 'oral', label: 'By mouth' },
  { value: 'drinking-water', label: 'In the water' },
  { value: 'feed', label: 'In the feed' },
  { value: 'injection-im', label: 'Shot in the muscle' },
  { value: 'injection-sc', label: 'Shot under the skin' },
  { value: 'injection-iv', label: 'Shot in a vein' },
  { value: 'intranasal', label: 'In the nose' },
  { value: 'ocular', label: 'In the eye' },
  { value: 'topical', label: 'On the skin' },
  { value: 'pour-on', label: 'Pour-on' },
  { value: 'intramammary', label: 'In the udder' },
  { value: 'other', label: 'Other' }
] as const;

export const USE_CHOICES: { value: ProductionUse; label: string }[] = [
  { value: 'food', label: 'For the table' },
  { value: 'sale', label: 'For sale' },
  { value: 'discard', label: 'Thrown out' },
  { value: 'feed-to-animals', label: 'Fed to animals' },
  { value: 'unknown', label: 'Not sure' }
];

export const USE_LABEL: Record<ProductionUse, string> = Object.fromEntries(
  USE_CHOICES.map((c) => [c.value, c.label])
) as Record<ProductionUse, string>;

export function namesProduct(v: {
  productName?: string;
  productPluginId?: string;
  stockItemId?: string;
}): boolean {
  return !!(v.productName?.trim() || v.productPluginId || v.stockItemId);
}

/** C-20: a hold-bearing record dated more than 48 hours ago locks as soon
 *  as it is saved. */
export function locksWhenSaved(
  kind: HealthEventKind,
  hasProduct: boolean,
  atMs: number,
  nowMs: number
): boolean {
  const holds = hasProduct || HOLD_BEARING_KINDS.includes(kind);
  return holds && nowMs - atMs >= LOCK_WINDOW_MS;
}
