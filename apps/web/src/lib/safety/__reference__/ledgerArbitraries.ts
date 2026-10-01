/**
 * Test-only: the hold-ledger farm generators shared by the ledger's
 * property tests and the old-versus-new projection equivalence test.
 */

import fc from 'fast-check';
import type { AnimalHealthProductData, TreatmentRecord } from '../animalWithdrawal';
import type { GrazingApplication } from '../grazingInterval';
import type { GrazingRestrictions } from '$lib/plugins/schemas';
import type { HoldFact, ProjectionContext } from '../holdLedger';

export const TZ = 'America/New_York';
export const DAY = 86_400_000;
export const NOW = Date.parse('2026-09-20T16:00:00Z');
export const T0 = NOW - 120 * DAY;

export const PRODUCTS: Record<string, AnimalHealthProductData> = {
  wormer: {
    pluginId: 'wormer',
    displayName: 'Wormer',
    activeIngredients: [{ name: 'testazole' }],
    labelUses: [
      { speciesId: 'chicken', class: 'all', withdrawal: { meatDays: 14, eggsDays: 7 } },
      { speciesId: 'sheep', class: 'all', withdrawal: { meatDays: 10 } },
      { speciesId: 'sheep', class: 'lactating-dairy', withdrawal: { milkHours: 72 } }
    ]
  },
  quick: {
    pluginId: 'quick',
    displayName: 'Quick',
    activeIngredients: [{ name: 'quickazole' }],
    labelUses: [
      { speciesId: 'chicken', class: 'all', withdrawal: { meatDays: 1, eggsDays: 0 } },
      { speciesId: 'sheep', class: 'all', withdrawal: { meatDays: 2, milkHours: 24 } }
    ]
  }
};

export const ctx: ProjectionContext = {
  plugins: (id) => PRODUCTS[id],
  timeZone: TZ,
  registryMaxIntervalDays: 0
};

export const timeArb = fc.integer({ min: T0, max: NOW });
export const animalIdArb = fc.constantFrom('a1', 'a2', 'a3');
export const fieldArb = fc.constantFrom('f1', 'f2');

export const restrictionsArb: fc.Arbitrary<GrazingRestrictions | null> = fc.oneof(
  fc.constant(null),
  fc.record({
    source: fc.constant('label'),
    grazeDays: fc.option(fc.integer({ min: 0, max: 40 }), { nil: undefined }),
    hayDays: fc.option(fc.integer({ min: 0, max: 60 }), { nil: undefined }),
    lactatingDairyGrazeDays: fc.option(fc.integer({ min: 0, max: 60 }), { nil: undefined }),
    meatAnimalRemovalBeforeSlaughterDays: fc.option(fc.integer({ min: 0, max: 30 }), {
      nil: undefined
    }),
    notForPasture: fc.option(fc.boolean(), { nil: undefined })
  })
);

export const doseArb = fc.record({
  id: fc.uuid(),
  subject: fc.oneof(
    animalIdArb.map((id) => ({ type: 'animal' as const, id })),
    fc.constant({ type: 'group' as const, id: 'g1' })
  ),
  at: timeArb,
  product: fc.constantFrom('wormer', 'quick', 'mystery', 'enrofloxacin'),
  courseOpen: fc.boolean()
});

export const stayArb = fc.record({
  id: fc.uuid(),
  subject: fc.oneof(
    animalIdArb.map((id) => ({ type: 'animal' as const, id })),
    fc.constant({ type: 'group' as const, id: 'g1' })
  ),
  fieldId: fieldArb,
  from: timeArb,
  length: fc.option(fc.integer({ min: 1, max: 40 * DAY }), { nil: null }),
  fromGroup: fc.constantFrom<string | null>(null, null, 'g1'),
  toGroup: fc.constantFrom<string | null>(null, null, 'g1')
});

export const appArb = fc.record({
  id: fc.integer({ min: 1, max: 1_000_000 }),
  block: fc.constantFrom('b1', 'b2'),
  at: timeArb,
  restrictions: restrictionsArb
});

export const farmArb = fc.record({
  species: fc.constantFrom('chicken', 'sheep'),
  memberOfG1: fc.subarray(['a1', 'a2', 'a3']),
  doses: fc.array(doseArb, { maxLength: 5 }),
  stays: fc.array(stayArb, { maxLength: 5 }),
  apps: fc.array(appArb, { maxLength: 3 }),
  blockField: fc.record({ b1: fieldArb, b2: fieldArb })
});

export type Farm = typeof farmArb extends fc.Arbitrary<infer T> ? T : never;

export function treatment(d: Farm['doses'][number], species: string): TreatmentRecord {
  const plugin = d.product === 'wormer' || d.product === 'quick';
  return {
    id: d.id,
    subjectType: d.subject.type,
    subjectId: d.subject.id,
    speciesId: species,
    kind: 'treatment',
    productPluginId: plugin ? d.product : null,
    productName: plugin ? null : d.product,
    route: null,
    labelUse: plugin ? 'label' : null,
    administeredAtMs: d.at,
    courseEndAtMs: null,
    courseOpen: d.courseOpen,
    entries: []
  };
}

export function factsOf(farm: Farm): HoldFact[] {
  const products = farm.species === 'sheep' ? ['meat', 'milk'] : ['eggs', 'meat'];
  const out: HoldFact[] = [
    {
      kind: 'subject',
      subjectType: 'group',
      id: 'g1',
      speciesId: farm.species,
      sex: null,
      currentGroupId: null,
      speciesProducts: products
    }
  ];
  for (const id of ['a1', 'a2', 'a3']) {
    out.push({
      kind: 'subject',
      subjectType: 'animal',
      id,
      speciesId: farm.species,
      sex: 'female',
      currentGroupId: farm.memberOfG1.includes(id) ? 'g1' : null,
      speciesProducts: products
    });
  }
  for (const d of farm.doses) out.push({ kind: 'dose', treatment: treatment(d, farm.species) });
  for (const s of farm.stays) {
    out.push({
      kind: 'stay',
      id: s.id,
      subjectType: s.subject.type,
      subjectId: s.subject.id,
      fieldId: s.fieldId,
      fromMs: s.from,
      toMs: s.length === null ? null : s.from + s.length,
      fromGroupId: s.subject.type === 'animal' ? s.fromGroup : null,
      toGroupId: s.subject.type === 'animal' && s.length !== null ? s.toGroup : null,
      floor: [],
      deleted: false
    });
  }
  for (const [blockId, fieldId] of Object.entries(farm.blockField)) {
    out.push({ kind: 'block-assignment', blockId, fieldId });
  }
  for (const a of farm.apps) {
    const app: GrazingApplication = {
      ref: `spray:${a.id}`,
      source: 'spray',
      blockId: a.block,
      appliedAtMs: a.at,
      productPluginId: 'weedkiller',
      productName: 'Weedkiller',
      restrictions: a.restrictions
    };
    out.push({ kind: 'application', application: app });
  }
  return out;
}

export type Mutation =
  | { kind: 'drop-dose'; index: number }
  | { kind: 'drop-app'; index: number }
  | { kind: 'end-stay'; index: number; at: number }
  | { kind: 'move-app'; index: number; at: number }
  | { kind: 'reassign'; block: 'b1' | 'b2' }
  | { kind: 'close-course'; index: number; at: number }
  | { kind: 'restrict'; index: number; restrictions: GrazingRestrictions | null };

export const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({ kind: fc.constant('drop-dose' as const), index: fc.nat(4) }),
  fc.record({ kind: fc.constant('drop-app' as const), index: fc.nat(2) }),
  fc.record({ kind: fc.constant('end-stay' as const), index: fc.nat(4), at: timeArb }),
  fc.record({ kind: fc.constant('move-app' as const), index: fc.nat(2), at: timeArb }),
  fc.record({
    kind: fc.constant('reassign' as const),
    block: fc.constantFrom('b1' as const, 'b2' as const)
  }),
  fc.record({ kind: fc.constant('close-course' as const), index: fc.nat(4), at: timeArb }),
  fc.record({
    kind: fc.constant('restrict' as const),
    index: fc.nat(2),
    restrictions: restrictionsArb
  })
);

export function mutate(farm: Farm, m: Mutation): Farm {
  const next: Farm = structuredClone(farm);
  switch (m.kind) {
    case 'drop-dose':
      next.doses.splice(m.index, 1);
      break;
    case 'drop-app':
      next.apps.splice(m.index, 1);
      break;
    case 'end-stay': {
      const s = next.stays[m.index];
      if (s && m.at > s.from) s.length = m.at - s.from;
      break;
    }
    case 'move-app': {
      const a = next.apps[m.index];
      if (a) a.at = m.at;
      break;
    }
    case 'reassign':
      next.blockField[m.block] = next.blockField[m.block] === 'f1' ? 'f2' : 'f1';
      break;
    case 'close-course': {
      const d = next.doses[m.index];
      if (d) d.courseOpen = false;
      break;
    }
    case 'restrict': {
      const a = next.apps[m.index];
      if (a) a.restrictions = m.restrictions;
      break;
    }
  }
  return next;
}
