/**
 * Test-only: the dense C-35 §3 perf farm (500 animals, 200 blocks, five
 * years of records), shared by the perf test and the equivalence test.
 */

import type { AnimalHealthProductData } from '../animalWithdrawal';
import type { HoldFact, ProjectionContext } from '../holdLedger';

export const TZ = 'America/New_York';
const DAY = 86_400_000;
export const NOW = Date.parse('2026-09-20T16:00:00Z');
const YEARS = 5;

export const WORMER: AnimalHealthProductData = {
  pluginId: 'wormer',
  displayName: 'Wormer',
  activeIngredients: [{ name: 'testazole' }],
  labelUses: [
    { speciesId: 'sheep', class: 'all', withdrawal: { meatDays: 10 } },
    { speciesId: 'sheep', class: 'lactating-dairy', withdrawal: { milkHours: 72 } }
  ]
};

/** A deterministic pseudo-random sequence, so every run measures the same farm. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

export function bigFarm(): HoldFact[] {
  const r = rng(42);
  const facts: HoldFact[] = [];
  const span = YEARS * 365 * DAY;
  const t = () => NOW - Math.floor(r() * span);
  for (let g = 0; g < 20; g++) {
    facts.push({
      kind: 'subject',
      subjectType: 'group',
      id: `g${g}`,
      speciesId: 'sheep',
      sex: null,
      currentGroupId: null,
      speciesProducts: ['meat', 'milk']
    });
  }
  for (let a = 0; a < 500; a++) {
    facts.push({
      kind: 'subject',
      subjectType: 'animal',
      id: `a${a}`,
      speciesId: 'sheep',
      sex: a % 3 === 0 ? 'male' : 'female',
      currentGroupId: a % 5 === 0 ? null : `g${a % 20}`,
      speciesProducts: ['meat', 'milk']
    });
  }
  for (let f = 0; f < 40; f++) {
    for (let b = 0; b < 5; b++) {
      facts.push({ kind: 'block-assignment', blockId: `b${f}-${b}`, fieldId: `f${f}` });
    }
  }
  for (let i = 0; i < 1000; i++) {
    const onGroup = r() < 0.5;
    facts.push({
      kind: 'dose',
      treatment: {
        id: `d${i}`,
        subjectType: onGroup ? 'group' : 'animal',
        subjectId: onGroup ? `g${i % 20}` : `a${i % 500}`,
        speciesId: 'sheep',
        kind: 'deworm',
        productPluginId: r() < 0.8 ? 'wormer' : null,
        productName: null,
        route: null,
        labelUse: 'label',
        administeredAtMs: t(),
        courseEndAtMs: null,
        entries: []
      }
    });
  }
  for (let i = 0; i < 600; i++) {
    const f = i % 40;
    facts.push({
      kind: 'application',
      application: {
        ref: `spray:${i}`,
        source: 'spray',
        blockId: `b${f}-${i % 5}`,
        appliedAtMs: t(),
        productPluginId: 'weedkiller',
        productName: 'Weedkiller',
        restrictions:
          r() < 0.5
            ? {
                source: 'label',
                grazeDays: 7,
                hayDays: 30,
                lactatingDairyGrazeDays: 14,
                meatAnimalRemovalBeforeSlaughterDays: 3
              }
            : null
      }
    });
  }
  for (let g = 0; g < 20; g++) {
    let from = NOW - span;
    for (let k = 0; k < 40; k++) {
      const to = from + Math.floor(r() * 60 * DAY) + DAY;
      facts.push({
        kind: 'stay',
        id: `sg${g}-${k}`,
        subjectType: 'group',
        subjectId: `g${g}`,
        fieldId: `f${Math.floor(r() * 40)}`,
        fromMs: from,
        toMs: to > NOW ? null : to,
        fromGroupId: null,
        toGroupId: null,
        floor: [],
        deleted: false
      });
      if (to > NOW) break;
      from = to;
    }
  }
  for (let i = 0; i < 1500; i++) {
    facts.push({
      kind: 'production',
      id: `p${i}`,
      subjectType: 'group',
      subjectId: `g${i % 20}`,
      food: 'milk',
      declaredUse: 'food',
      occurredAtMs: t(),
      deleted: false
    });
  }
  return facts;
}

export function bigFarmContext(): ProjectionContext {
  return {
    plugins: (id) => (id === 'wormer' ? WORMER : undefined),
    timeZone: TZ,
    registryMaxIntervalDays: 0,
    verdictCache: new Map()
  };
}
