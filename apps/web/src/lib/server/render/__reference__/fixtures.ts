/** Tests only: data for the render equivalence and worker tests. Enough
 *  rows that every document runs to several pages, so the page-numbered
 *  headers and footers are exercised. */

import type { Prefs } from '$lib/prefs';
import type { PackData } from '$lib/records/organicPack';
import type { TreatmentLogRow } from '$lib/records/animalTreatmentLog';
import type { YearSummaryForViewer } from '$lib/records/yearSummary';
import type { YearAnimalSection } from '$lib/records/yearSummaryAnimals';

export const PREFS: Prefs = { timeZone: 'America/New_York', units: 'us' };
export const NOW = new Date('2026-09-30T14:05:00Z');
export const VIEWER = { email: 'owner@example.com', phone: null };

export function exportTable(rows: number, cols: number): unknown[][] {
  const header = Array.from({ length: cols }, (_, i) => ({ text: `Col ${i}`, style: 'th' }));
  const body: unknown[][] = [header];
  for (let r = 0; r < rows; r++) {
    body.push(
      Array.from({ length: cols }, (_, c) =>
        c === 1
          ? { text: `kind ${r % 3}`, style: 'kind' }
          : c === 2
            ? [{ text: `Block ${r}` }, { text: `b${r}`.padEnd(8, 'x') + '…', style: 'mono' }]
            : `row ${r} cell ${c}${r % 7 === 0 ? '\nsecond line ⚠' : ''}`
      )
    );
  }
  return body;
}

export function treatmentRows(n: number): TreatmentLogRow[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `Mar ${(i % 28) + 1}, 2026`,
    courseEnd: i % 4 === 0 ? null : `Apr ${(i % 28) + 1}, 2026`,
    subject: `Ewe ${i}`,
    species: 'Sheep',
    product: `Product ${i % 5}`,
    approvalNumber: i % 2 ? `NADA 140-${i}` : null,
    lot: i % 3 ? `L${i}` : null,
    dose: '5 ml',
    route: 'By mouth',
    givenBy: 'Sam',
    vet: i % 6 === 0 ? 'Dr. Lee' : null,
    labelUse: 'As the label says',
    withdrawal: [
      { food: 'meat', clearOn: i % 5 ? `May ${(i % 28) + 1}, 2026` : null, source: 'label' },
      { food: 'milk', clearOn: null, source: 'unknown' }
    ],
    state: i % 9 === 0 ? 'locked' : 'live',
    enteredLate: i % 11 === 0 ? 'Saved 3 days after its date' : null,
    organicOutcome: i % 2 ? 'Needs review' : null
  })) as TreatmentLogRow[];
}

const animals: YearAnimalSection = {
  speciesNames: { sheep: 'Sheep', chicken: 'Chicken' },
  headCounts: [
    { speciesId: 'sheep', atStart: 10, atEnd: 12 },
    { speciesId: 'chicken', atStart: null, atEnd: 30 }
  ],
  movements: [{ speciesId: 'sheep', label: 'Born', head: 4 }],
  treatments: [{ product: 'Wormer', doses: 3, subjects: ['Ewe 1', 'Flock'] }],
  production: [{ food: 'eggs', useLabel: 'For the table', quantity: 120, unit: 'eggs', logs: 9 }],
  covered: [
    {
      atMs: Date.UTC(2026, 4, 2),
      subject: 'Flock',
      what: 'Eggs',
      use: 'For SALE',
      basisText: 'Withdrawal'
    }
  ]
} as unknown as YearAnimalSection;

export function yearSummary(withCosts = true): YearSummaryForViewer {
  return {
    year: 2026,
    ownerId: 'o1',
    generatedAtMs: NOW.getTime(),
    totals: {
      sprayApplications: 30,
      insecticideApplications: 4,
      fungicideApplications: 2,
      totalApplications: 36,
      harvestEvents: 12,
      blocksTreated: 5
    },
    productAcreage: Array.from({ length: 40 }, (_, i) => ({
      productId: `p${i}`,
      displayName: `Product ${i}`,
      classes: i % 3 ? ['Group 9'] : [],
      applicationCount: i,
      acresTreated: i * 1.37
    })),
    chemistryClassAcreage: [{ className: 'Group 9', applicationCount: 20, acresTreated: 13.2 }],
    philosophy: {
      philosophy: 'conventional',
      totalApplications: 36,
      compliantApplications: 30,
      nonCompliantApplications: 2,
      unknownApplications: 4
    },
    harvestByArchetype: [
      {
        archetype: 'small-grain.zadoks',
        cropPluginIds: ['wheat'],
        eventCount: 3,
        cropCount: 1,
        moisture: { min: 12, max: 14, mean: 13 }
      },
      {
        archetype: 'winter-squash-cure',
        cropPluginIds: ['squash'],
        eventCount: 1,
        cropCount: 1,
        moisture: { min: null, max: null, mean: null }
      }
    ],
    hay: withCosts
      ? {
          cuttingCount: 3,
          blockCount: 2,
          bales: [{ baleType: 'small-square', count: 400 }],
          moisture: { sampleCount: 2, min: 14, max: 16, mean: 15 }
        }
      : null,
    inputCosts: withCosts
      ? {
          lines: [
            { category: 'herbicide', costCents: 12345 },
            { category: 'seed', costCents: 999 }
          ],
          totalCents: 13344
        }
      : null,
    scoutFunnel: { scoutObservations: 8, thresholdTriggeredApplications: 2, spraysAvoided: 3 },
    compliance: {
      sprayerCount: 2,
      calibratedSprayerCount: 1,
      calibratedThisYear: 1,
      deconEventsThisYear: 4
    },
    animals
  } as YearSummaryForViewer;
}

export function packData(): PackData {
  const statuses = Array.from({ length: 70 }, (_, i) => ({
    subjectType: i % 2 ? 'Block' : 'Animal',
    name: `Subject ${i}`,
    area: i % 3 ? 'Garden' : null,
    status: 'Certified organic',
    effective: 'Jan 1, 2026',
    certifier: 'VA Certifier',
    note: null,
    enteredBy: 'Owner',
    enteredOn: 'Jan 2, 2026',
    documents: null,
    inForceToday: i % 4 ? 'Certified organic' : null
  }));
  return {
    farmName: 'Hill Farm',
    from: '2026-01-01',
    to: '2026-12-31',
    generatedAt: 'Sep 30, 2026, 10:05 AM',
    libraryBuild: 'CropCard v0.0.1 (build dev)',
    forOwner: true,
    statuses,
    activity: [],
    inputs: [],
    seed: [],
    treatments: treatmentRows(12),
    harvests: [],
    documents: []
  } as unknown as PackData;
}
