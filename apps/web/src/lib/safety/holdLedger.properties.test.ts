/**
 * C-35 invariant I1 on the pure ledger. The server guard runs the same
 * comparison inside every write's transaction (holdGuard.properties.test.ts
 * drives it through the real guard on SQLite, with the repo and
 * `lib/server/animals` calls the endpoints make; the endpoints' own wiring
 * is covered by their endpoint suites).
 *
 * - Spans agree with the gate kernels at every moment (activeHolds,
 *   exposureHolds), so the ledger can never think a hold ends earlier or
 *   later than the gates enforce it.
 * - A write the ledger accepts leaves every held moment held (P1).
 * - A write that only adds facts, or closes open facts at now, is always
 *   accepted (P2).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  activeHolds,
  FOODS,
  treatmentHoldSpans,
  type AnimalHealthProductData,
  type Food,
  type FoodSubject,
  type TreatmentRecord
} from './animalWithdrawal';
import { exposureHolds, exposureSpans, type ExposureStay } from './grazingExposure';
import type { GrazingApplication } from './grazingInterval';
import type { GrazingRestrictions } from '$lib/plugins/schemas';
import {
  HOLD_KINDS,
  holdMapKey,
  isEmptyDiff,
  projectHolds,
  shortenings,
  spansContain,
  type HoldFact,
  type HoldProjection,
  type ProjectionContext
} from './holdLedger';

const TZ = 'America/New_York';
const DAY = 86_400_000;
const NOW = Date.parse('2026-09-20T16:00:00Z');
const T0 = NOW - 120 * DAY;

const PRODUCTS: Record<string, AnimalHealthProductData> = {
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

const ctx: ProjectionContext = {
  plugins: (id) => PRODUCTS[id],
  timeZone: TZ,
  registryMaxIntervalDays: 0
};

const timeArb = fc.integer({ min: T0, max: NOW });
const animalIdArb = fc.constantFrom('a1', 'a2', 'a3');
const fieldArb = fc.constantFrom('f1', 'f2');

const restrictionsArb: fc.Arbitrary<GrazingRestrictions | null> = fc.oneof(
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

const doseArb = fc.record({
  id: fc.uuid(),
  subject: fc.oneof(
    animalIdArb.map((id) => ({ type: 'animal' as const, id })),
    fc.constant({ type: 'group' as const, id: 'g1' })
  ),
  at: timeArb,
  product: fc.constantFrom('wormer', 'quick', 'mystery', 'enrofloxacin'),
  courseOpen: fc.boolean()
});

const stayArb = fc.record({
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

const appArb = fc.record({
  id: fc.integer({ min: 1, max: 1_000_000 }),
  block: fc.constantFrom('b1', 'b2'),
  at: timeArb,
  restrictions: restrictionsArb
});

const farmArb = fc.record({
  species: fc.constantFrom('chicken', 'sheep'),
  memberOfG1: fc.subarray(['a1', 'a2', 'a3']),
  doses: fc.array(doseArb, { maxLength: 5 }),
  stays: fc.array(stayArb, { maxLength: 5 }),
  apps: fc.array(appArb, { maxLength: 3 }),
  blockField: fc.record({ b1: fieldArb, b2: fieldArb })
});

type Farm = typeof farmArb extends fc.Arbitrary<infer T> ? T : never;

function treatment(d: Farm['doses'][number], species: string): TreatmentRecord {
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

function factsOf(farm: Farm): HoldFact[] {
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

function heldSomewhere(p: HoldProjection, t: number): string[] {
  const out: string[] = [];
  for (const [k, spans] of p.holds) if (spansContain(spans, t)) out.push(k);
  return out;
}

function samples(p: HoldProjection, extra: number[] = []): number[] {
  const out = new Set<number>(extra);
  for (const spans of p.holds.values()) {
    for (const s of spans) {
      out.add(s.fromMs);
      if (Number.isFinite(s.toMs)) out.add(s.toMs - 1);
      if (Number.isFinite(s.toMs)) out.add(Math.floor((s.fromMs + s.toMs) / 2));
    }
  }
  return [...out];
}

describe('spans agree with the gate kernels', () => {
  it('treatmentHoldSpans holds exactly when activeHolds finds a hold', () => {
    fc.assert(
      fc.property(farmArb, fc.array(timeArb, { minLength: 1, maxLength: 6 }), (farm, times) => {
        const treatments = farm.doses.map((d) => ({
          ...treatment(d, farm.species),
          courseOpen: false
        }));
        const memberships = farm.memberOfG1.map((id) => ({
          animalId: id,
          memberships: [{ groupId: 'g1', fromMs: T0 + 10 * DAY, toMs: NOW - 10 * DAY }]
        }));
        const subjects: FoodSubject[] = [
          { type: 'animal', id: 'a1', memberships: memberships[0]?.memberships ?? [] },
          { type: 'group', id: 'g1', lineage: [], members: memberships }
        ];
        for (const subject of subjects) {
          for (const food of FOODS) {
            const input = { subject, food, treatments, plugins: ctx.plugins, timeZone: TZ };
            const spans = treatmentHoldSpans(input);
            const points = [...times];
            for (const s of spans) {
              points.push(s.fromMs, s.fromMs - 1);
              if (Number.isFinite(s.toMs)) points.push(s.toMs, s.toMs - 1);
            }
            for (const t of points) {
              const gate = activeHolds({ ...input, atMs: t }).length > 0;
              const ledger = spans.some((s) => s.fromMs <= t && t < s.toMs);
              expect(ledger).toBe(gate);
            }
          }
        }
      }),
      { numRuns: 100 }
    );
  }, 30_000);

  it('exposureSpans holds exactly when exposureHolds finds a hold (closed stays)', () => {
    fc.assert(
      fc.property(
        fc.array(appArb, { minLength: 1, maxLength: 3 }),
        fc.array(fc.record({ from: timeArb, length: fc.integer({ min: 1, max: 30 * DAY }) }), {
          minLength: 1,
          maxLength: 3
        }),
        fc.constantFrom<Food>('meat', 'milk', 'eggs'),
        fc.boolean(),
        fc.array(fc.integer({ min: T0, max: NOW + 400 * DAY }), { maxLength: 5 }),
        (apps, stays, food, lactating, times) => {
          const applications: GrazingApplication[] = apps.map((a) => ({
            ref: `spray:${a.id}`,
            source: 'spray',
            blockId: 'b1',
            appliedAtMs: a.at,
            productPluginId: null,
            productName: 'Weedkiller',
            restrictions: a.restrictions
          }));
          const exposure: ExposureStay[] = stays.map((s) => ({
            fieldId: 'f1',
            fromMs: s.from,
            toMs: s.from + s.length
          }));
          const input = {
            stays: exposure,
            applicationsByField: new Map([['f1', applications]]),
            subject: { speciesId: 'sheep', lactating },
            food,
            timeZone: TZ
          };
          const spans = exposureSpans(input);
          const points = [...times];
          for (const s of spans) {
            points.push(s.fromMs, s.fromMs - 1);
            if (Number.isFinite(s.toMs)) points.push(s.toMs, s.toMs - 1);
          }
          for (const t of points) {
            const gate = exposureHolds({ ...input, atMs: t }).length > 0;
            const ledger = spans.some((s) => s.fromMs <= t && t < s.toMs);
            expect(ledger).toBe(gate);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 30_000);
});

type Mutation =
  | { kind: 'drop-dose'; index: number }
  | { kind: 'drop-app'; index: number }
  | { kind: 'end-stay'; index: number; at: number }
  | { kind: 'move-app'; index: number; at: number }
  | { kind: 'reassign'; block: 'b1' | 'b2' }
  | { kind: 'close-course'; index: number; at: number }
  | { kind: 'restrict'; index: number; restrictions: GrazingRestrictions | null };

const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
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

function mutate(farm: Farm, m: Mutation): Farm {
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

const RANK = { none: -1, unknown: 0, known: 1, prohibited: 2 } as const;

describe('I1: holds never shorten', () => {
  it('P1: an accepted write leaves every held moment held, on no weaker basis', () => {
    fc.assert(
      fc.property(farmArb, mutationArb, fc.array(timeArb, { maxLength: 4 }), (farm, m, times) => {
        const before = projectHolds(factsOf(farm), NOW, ctx);
        const after = projectHolds(factsOf(mutate(farm, m)), NOW, ctx);
        const diff = shortenings(before, after);
        if (!isEmptyDiff(diff)) return;
        for (const t of samples(before, times)) {
          const lost = heldSomewhere(before, t).filter(
            (k) =>
              RANK[spansContain(after.holds.get(k) ?? [], t) ?? 'none'] <
              RANK[spansContain(before.holds.get(k) ?? [], t) ?? 'none']
          );
          expect(lost).toEqual([]);
        }
        for (const [id, b] of before.covered)
          expect(RANK[after.covered.get(id) ?? 'none']).toBeGreaterThanOrEqual(RANK[b]);
      }),
      { numRuns: 200 }
    );
  }, 30_000);

  it('P1: every refused write loses or weakens a held moment or a covered record', () => {
    fc.assert(
      fc.property(farmArb, mutationArb, (farm, m) => {
        const before = projectHolds(factsOf(farm), NOW, ctx);
        const after = projectHolds(factsOf(mutate(farm, m)), NOW, ctx);
        const diff = shortenings(before, after);
        for (const s of diff.holds) {
          const k = holdMapKey(s.key, s.kind);
          for (const l of s.lost) {
            const t = l.fromMs;
            expect(spansContain(before.holds.get(k) ?? [], t)).toBe(l.basis);
            expect(RANK[spansContain(after.holds.get(k) ?? [], t) ?? 'none']).toBeLessThan(
              RANK[l.basis]
            );
          }
        }
        for (const c of diff.coverage)
          expect(RANK[after.covered.get(c.id) ?? 'none']).toBeLessThan(RANK[c.basis]);
      }),
      { numRuns: 200 }
    );
  }, 30_000);

  it('P2: adding a dose, a spray or a stay is always accepted', () => {
    fc.assert(
      fc.property(
        farmArb,
        fc.oneof(
          doseArb.map((d) => ({ dose: d })),
          appArb.map((a) => ({ app: a })),
          stayArb.map((s) => ({ stay: { ...s, fromGroup: null, toGroup: null } }))
        ),
        (farm, add) => {
          const next: Farm = structuredClone(farm);
          if ('dose' in add) next.doses.push(add.dose);
          if ('app' in add) next.apps.push(add.app);
          if ('stay' in add) next.stays.push(add.stay);
          const before = projectHolds(factsOf(farm), NOW, ctx);
          const after = projectHolds(factsOf(next), NOW, ctx);
          expect(shortenings(before, after)).toEqual({ holds: [], coverage: [] });
        }
      ),
      { numRuns: 200 }
    );
  }, 30_000);

  it('P2: closing open stays and courses at now is always accepted (truncation)', () => {
    fc.assert(
      fc.property(farmArb, (farm) => {
        const next: Farm = structuredClone(farm);
        for (const s of next.stays) {
          if (s.length === null && NOW > s.from) {
            s.length = NOW - s.from;
            s.toGroup = null;
          }
        }
        const before = projectHolds(factsOf(farm), NOW, ctx);
        const after = projectHolds(factsOf(next), NOW, ctx);
        expect(isEmptyDiff(shortenings(before, after))).toBe(true);
      }),
      { numRuns: 200 }
    );
  }, 30_000);

  it('projects only the documented kinds', () => {
    fc.assert(
      fc.property(farmArb, (farm) => {
        for (const k of projectHolds(factsOf(farm), NOW, ctx).holds.keys()) {
          expect(HOLD_KINDS).toContain(k.slice(k.lastIndexOf('|') + 1));
        }
      }),
      { numRuns: 50 }
    );
  });
});
