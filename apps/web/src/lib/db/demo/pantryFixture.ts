/** Phase 37C demo data (C-10, R-15): a few herb harvests on the demo farm's
 *  herb garden, each with where it went, so /plan/pantry has something to
 *  show. Pure data; the seeder places each harvest `daysAgo` before its
 *  clock (never after now) on a planting of `cropPluginId` and writes the
 *  dispositions through the disposition repo. Quantities are what the demo
 *  farmer recorded, never a yield estimate. */

import type { PreservingMethod } from '$lib/garden/preserving';

export interface DemoPantryDisposition {
  kind: 'kept' | 'donated';
  quantity: number;
  unit: string;
  preservedAs?: PreservingMethod;
  recipient?: string;
}

export interface DemoPantryHarvest {
  cropPluginId: string;
  daysAgo: number;
  quantity: string;
  dispositions: DemoPantryDisposition[];
}

export function demoPantryFixture(): DemoPantryHarvest[] {
  return [
    {
      cropPluginId: 'oregano-greek',
      daysAgo: 21,
      quantity: '4 bunch',
      dispositions: [{ kind: 'kept', quantity: 4, unit: 'bunch', preservedAs: 'dry' }]
    },
    {
      cropPluginId: 'basil-genovese',
      daysAgo: 14,
      quantity: '6 bunch',
      dispositions: [
        { kind: 'kept', quantity: 4, unit: 'bunch', preservedAs: 'freeze' },
        { kind: 'kept', quantity: 1, unit: 'bunch', preservedAs: 'fresh' },
        { kind: 'donated', quantity: 1, unit: 'bunch', recipient: 'Neighbor' }
      ]
    },
    {
      cropPluginId: 'chives-common',
      daysAgo: 7,
      quantity: '2 bunch',
      dispositions: [{ kind: 'kept', quantity: 2, unit: 'bunch', preservedAs: 'freeze' }]
    }
  ];
}
