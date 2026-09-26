import type { FarmSnapshot, SnapshotSprayProduct } from '../snapshot';
import { sampleSnapshot } from './fixtures';

const at = (iso: string) => Date.parse(iso);

export const SAMPLE_HERBICIDE: SnapshotSprayProduct = {
  pluginId: '24d',
  type: 'herbicide',
  displayName: '2,4-D Amine',
  version: '1.0.0',
  epaRegistrationNumber: '34704-120',
  ratePerAcre: { amount: 16, unit: 'fl-oz' },
  gpaCalibration: 15,
  reEntryIntervalHours: null,
  preHarvestIntervalDays: null,
  targets: [],
  loadClasses: ['synthetic-auxin'],
  mixSteps: [
    'Half-fill spray tank with clean water and start agitation.',
    'Add 2,4-D Amine per dilution table.',
    'Top off water to final tank volume.',
    'Spray within 2 hours of mixing.'
  ],
  rainfastHours: null,
  pollinator: null
};

export const SAMPLE_FUNGICIDE: SnapshotSprayProduct = {
  pluginId: 'copper-hydroxide',
  type: 'fungicide',
  displayName: 'Copper hydroxide',
  version: '1.2.0',
  epaRegistrationNumber: null,
  ratePerAcre: { amount: 2, unit: 'lb' },
  gpaCalibration: 15,
  reEntryIntervalHours: 48,
  preHarvestIntervalDays: 0,
  targets: ['Early blight', 'Septoria leaf spot'],
  loadClasses: ['fungicide-load'],
  mixSteps: [],
  rainfastHours: 2,
  pollinator: null
};

/** The sample farm plus two sprayers (one calibrated), a planter, stock
 *  and two stocked pesticides. */
export function sampleGearSnapshot(overrides: Partial<FarmSnapshot> = {}): FarmSnapshot {
  return sampleSnapshot({
    equipment: [
      {
        id: 'eq_boom',
        type: 'sprayer',
        label: '50-gal boom',
        tankGal: 50,
        state: {
          calibratedGpa: 20,
          calibrationDate: at('2026-04-02T14:00:00Z'),
          lastDeconAt: null,
          lastUsedAt: at('2026-05-20T14:00:00Z'),
          lastChemistryClass: 'sulfonylurea',
          winterizedAt: null
        }
      },
      {
        id: 'eq_pack',
        type: 'sprayer',
        label: 'Backpack',
        tankGal: 4,
        state: {
          calibratedGpa: null,
          calibrationDate: null,
          lastDeconAt: null,
          lastUsedAt: null,
          lastChemistryClass: null,
          winterizedAt: null
        }
      },
      { id: 'eq_planter', type: 'planter', label: 'Jang seeder', state: null }
    ],
    stock: [
      {
        id: 's_bean',
        pluginId: 'bean-provider',
        category: 'seed',
        displayName: 'Provider bean seed',
        unit: 'lb',
        onHand: 1,
        reorderThreshold: 2,
        earliestExpiry: '2026-06-20'
      },
      {
        id: 's_24d',
        pluginId: '24d',
        category: 'herbicide',
        displayName: '2,4-D Amine',
        unit: 'gal',
        onHand: 2.5,
        reorderThreshold: null,
        earliestExpiry: null
      }
    ],
    sprayProducts: { '24d': SAMPLE_HERBICIDE, 'copper-hydroxide': SAMPLE_FUNGICIDE },
    ...overrides
  });
}
