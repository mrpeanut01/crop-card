/**
 * Ruling G1-04: the faster projection is the same projection. The 0.7.1
 * ledger is frozen at `__reference__/holdLedgerV071.ts`; on random farms
 * the current `projectHolds` must return deep-equal `holds` (same keys,
 * same spans and bases, in order), `covered` and `blocks`, and
 * `shortenings` the same diff for random before and after pairs.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AnimalHealthProductData, TreatmentRecord, WithdrawalEntry } from './animalWithdrawal';
import type { ExposureFloorEntry } from './grazingExposure';
import type { GrazingRestrictions } from '$lib/plugins/schemas';
import * as next from './holdLedger';
import * as ref from './__reference__/holdLedgerV071';
import type { HoldFact, ProjectionContext, Span } from './holdLedger';
import {
  NOW,
  ctx as smallCtx,
  factsOf,
  farmArb,
  mutate,
  mutationArb
} from './__reference__/ledgerArbitraries';
import { NOW as BIG_NOW, bigFarm, bigFarmContext } from './__reference__/bigFarm';

const RUNS = 1000;
const DAY = 86_400_000;
const TZ = 'America/New_York';
const T0 = NOW - 400 * DAY;

type Projection = ReturnType<typeof next.projectHolds>;

function plain(p: Projection) {
  return {
    holdKeys: [...p.holds.keys()].sort(),
    holds: [...p.holds.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, spans]) => [k, spans.map((s) => [s.fromMs, s.toMs, s.basis])]),
    covered: [...p.covered.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    blocks: p.blocks ? [...p.blocks].sort() : null
  };
}

function expectSameProjection(facts: readonly HoldFact[], nowMs: number, c: ProjectionContext) {
  const a = ref.projectHolds(facts, nowMs, { ...c, verdictCache: undefined });
  const b = next.projectHolds(facts, nowMs, c);
  expect(plain(b)).toEqual(plain(a));
  return { a, b };
}

// ─── Span algebra ───────────────────────────────────────────────────────

const edgeTime = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 0, max: 40 }) },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NaN,
      0,
      -1
    )
  }
);
const spanArb: fc.Arbitrary<Span> = fc.record({
  fromMs: edgeTime,
  toMs: edgeTime,
  basis: fc.constantFrom('known', 'unknown', 'prohibited')
});

describe('span algebra matches 0.7.1', () => {
  it('normalizeSpans gives the same spans for any input, including empty and infinite ones', () => {
    fc.assert(
      fc.property(fc.array(spanArb, { maxLength: 30 }), (spans) => {
        expect(next.normalizeSpans(spans)).toEqual(ref.normalizeSpans(spans));
      }),
      { numRuns: RUNS * 5 }
    );
  });

  it('subtractSpans gives the same pieces for any inputs, normalized or not', () => {
    fc.assert(
      fc.property(
        fc.array(spanArb, { maxLength: 12 }),
        fc.array(spanArb, { maxLength: 12 }),
        fc.boolean(),
        (a, b, normalizeB) => {
          const right = normalizeB ? ref.normalizeSpans(b) : b;
          expect(next.subtractSpans(a, right)).toEqual(ref.subtractSpans(a, right));
          const left = ref.normalizeSpans(a);
          expect(next.subtractSpans(left, right)).toEqual(ref.subtractSpans(left, right));
          expect(next.subtractSpans(left, left)).toEqual(ref.subtractSpans(left, left));
        }
      ),
      { numRuns: RUNS * 5 }
    );
  });

  it('normalizeSpans gives the same spans on large single-basis and mixed inputs', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            fromMs: fc.integer({ min: 0, max: 5000 }),
            len: fc.integer({ min: -5, max: 400 }),
            basis: fc.constantFrom('known', 'known', 'known', 'unknown', 'prohibited'),
            open: fc.boolean()
          }),
          { maxLength: 300 }
        ),
        (raw) => {
          const spans: Span[] = raw.map((r) => ({
            fromMs: r.fromMs,
            toMs: r.open && r.basis !== 'known' ? Number.POSITIVE_INFINITY : r.fromMs + r.len,
            basis: r.basis as Span['basis']
          }));
          expect(next.normalizeSpans(spans)).toEqual(ref.normalizeSpans(spans));
        }
      ),
      { numRuns: RUNS }
    );
  });
});

// ─── The existing ledger farms ──────────────────────────────────────────

describe('projection matches 0.7.1 on the ledger property farms', () => {
  it('same holds, covered set and blocks', () => {
    fc.assert(
      fc.property(farmArb, (farm) => {
        expectSameProjection(factsOf(farm), NOW, smallCtx);
      }),
      { numRuns: RUNS }
    );
  }, 120_000);

  it('same shortenings for a farm and a mutation of it, both ways', () => {
    fc.assert(
      fc.property(farmArb, mutationArb, fc.boolean(), (farm, m, resolves) => {
        const before = expectSameProjection(factsOf(farm), NOW, smallCtx);
        const after = expectSameProjection(factsOf(mutate(farm, m)), NOW, smallCtx);
        const opts = { resolvesUnknown: resolves };
        expect(next.shortenings(before.b, after.b, opts)).toEqual(
          ref.shortenings(before.a, after.a, opts)
        );
        expect(next.shortenings(after.b, before.b, opts)).toEqual(
          ref.shortenings(after.a, before.a, opts)
        );
      }),
      { numRuns: RUNS }
    );
  }, 120_000);
});

// ─── Wide farms: every fact kind, several groups, splits and floors ─────

const PRODUCTS: Record<string, AnimalHealthProductData> = {
  wormer: {
    pluginId: 'wormer',
    displayName: 'Wormer',
    activeIngredients: [{ name: 'testazole' }],
    labelUses: [
      { speciesId: 'chicken', class: 'all', withdrawal: { meatDays: 14, eggsDays: 7 } },
      { speciesId: 'sheep', class: 'all', withdrawal: { meatDays: 10 } },
      { speciesId: 'sheep', class: 'lactating-dairy', withdrawal: { milkHours: 72 } },
      { speciesId: 'goat', class: 'all', withdrawal: { meatDays: 5, milkHours: 96 } }
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

const wideCtx = (registryMaxIntervalDays: number): ProjectionContext => ({
  plugins: (id) => PRODUCTS[id],
  timeZone: TZ,
  registryMaxIntervalDays,
  verdictCache: new Map()
});

const SPECIES = ['sheep', 'chicken', 'goat'] as const;
const GROUPS = ['g1', 'g2', 'g3'];
const ANIMALS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
const FIELDS = ['f1', 'f2', 'f3'];
const BLOCKS = ['b1', 'b2', 'b3', 'b4'];
const FOODS = ['meat', 'milk', 'eggs'] as const;

const timeArb = fc.integer({ min: T0, max: NOW + 2 * DAY });
const subjectArb = fc.oneof(
  fc.constantFrom(...ANIMALS).map((id) => ({ type: 'animal' as const, id })),
  fc.constantFrom(...GROUPS).map((id) => ({ type: 'group' as const, id }))
);
const groupOrNull = fc.constantFrom<string | null>(null, null, ...GROUPS);
const daysArb = (max: number) => fc.option(fc.integer({ min: 0, max }), { nil: undefined });

const restrictionsArb: fc.Arbitrary<GrazingRestrictions | null> = fc.oneof(
  fc.constant(null),
  fc.record({
    source: fc.constant('label'),
    grazeDays: daysArb(40),
    hayDays: daysArb(60),
    lactatingDairyGrazeDays: daysArb(60),
    meatAnimalRemovalBeforeSlaughterDays: daysArb(30),
    notForPasture: fc.option(fc.boolean(), { nil: undefined }),
    speciesExceptions: fc.option(
      fc.uniqueArray(
        fc.record({
          speciesId: fc.constantFrom(...SPECIES),
          lactating: fc.option(fc.boolean(), { nil: undefined }),
          grazeDays: daysArb(50),
          hayDays: daysArb(50)
        }),
        { maxLength: 2, selector: (e) => `${e.speciesId}|${e.lactating}` }
      ),
      { nil: undefined }
    )
  }) as fc.Arbitrary<GrazingRestrictions>
);

const entryArb: fc.Arbitrary<WithdrawalEntry> = fc.oneof(
  fc.record({
    kind: fc.constant('label' as const),
    food: fc.constantFrom(...FOODS),
    amount: fc.integer({ min: 0, max: 30 }),
    unit: fc.constantFrom('days' as const, 'hours' as const),
    labelNamesSpeciesAndClass: fc.boolean(),
    enteredAtMs: timeArb
  }),
  fc.record({
    kind: fc.constant('vet' as const),
    food: fc.constantFrom(...FOODS),
    amount: fc.integer({ min: 0, max: 30 }),
    unit: fc.constantFrom('days' as const, 'hours' as const),
    vetName: fc.constant('Dr Vet'),
    enteredAtMs: timeArb
  }),
  fc.record({
    kind: fc.constant('course-end' as const),
    endedAtMs: timeArb,
    enteredAtMs: timeArb
  }),
  fc.record({
    kind: fc.constant('product' as const),
    pluginId: fc.constantFrom('wormer', 'quick'),
    onLabel: fc.boolean(),
    enteredAtMs: timeArb
  })
);

const doseArb = fc.record({
  id: fc.uuid(),
  subject: subjectArb,
  at: timeArb,
  product: fc.constantFrom<string | null>('wormer', 'quick', 'mystery', 'enrofloxacin', null),
  kind: fc.constantFrom('treatment' as const, 'deworm' as const, 'vaccination' as const),
  labelUse: fc.constantFrom<TreatmentRecord['labelUse']>(
    'label',
    'extra-label-vet',
    'unknown',
    null
  ),
  course: fc.oneof(
    fc.constant({ open: false, endAfter: null as number | null }),
    fc.constant({ open: true, endAfter: null as number | null }),
    fc
      .integer({ min: 0, max: 10 * DAY })
      .map((d) => ({ open: false, endAfter: d as number | null }))
  ),
  entries: fc.oneof(
    { weight: 6, arbitrary: fc.array(entryArb, { maxLength: 3 }) },
    { weight: 1, arbitrary: fc.constant('invalid' as const) }
  ),
  deletion: fc.constantFrom(null, null, { dosed: true }, { dosed: false })
});

const floorArb = (fieldApps: number): fc.Arbitrary<ExposureFloorEntry[]> =>
  fc.array(
    fc.record({
      ref: fc.integer({ min: 0, max: fieldApps }).map((i) => `spray:${i}`),
      productPluginId: fc.constantFrom<string | null>('weedkiller', null),
      food: fc.constantFrom(...FOODS),
      lactating: fc.boolean(),
      exposedAtMs: timeArb,
      clearsAtMs: fc.integer({ min: T0, max: NOW + 90 * DAY })
    }),
    { maxLength: 2 }
  );

const stayArb = fc.record({
  id: fc.uuid(),
  subject: subjectArb,
  fieldId: fc.constantFrom(...FIELDS),
  from: timeArb,
  length: fc.option(fc.integer({ min: 0, max: 60 * DAY }), { nil: null }),
  fromGroup: groupOrNull,
  toGroup: groupOrNull,
  floor: floorArb(8),
  deleted: fc.boolean()
});

const appArb = fc.record({
  block: fc.constantFrom(...BLOCKS, 'gone'),
  at: fc.oneof(
    { weight: 9, arbitrary: timeArb },
    { weight: 1, arbitrary: fc.constant(Number.NaN) }
  ),
  source: fc.constantFrom('spray' as const, 'insecticide' as const, 'fungicide' as const),
  plugin: fc.constantFrom<string | null>('weedkiller', null),
  restrictions: restrictionsArb,
  formerFieldId: fc.option(fc.constantFrom(...FIELDS), { nil: undefined })
});

const wideFarmArb = fc.record({
  subjects: fc.record({
    groups: fc.array(fc.record({ species: fc.constantFrom(...SPECIES), present: fc.boolean() }), {
      minLength: 3,
      maxLength: 3
    }),
    animals: fc.array(
      fc.record({
        species: fc.constantFrom(...SPECIES),
        sex: fc.constantFrom<string | null>('female', 'male', null),
        group: groupOrNull,
        present: fc.boolean()
      }),
      { minLength: 6, maxLength: 6 }
    )
  }),
  blocks: fc.array(
    fc.record({
      block: fc.constantFrom(...BLOCKS),
      field: fc.constantFrom<string | null>(...FIELDS, null),
      grazeable: fc.option(fc.boolean(), { nil: undefined })
    }),
    { maxLength: 6 }
  ),
  doses: fc.array(doseArb, { maxLength: 8 }),
  stays: fc.array(stayArb, { maxLength: 10 }),
  apps: fc.array(appArb, { maxLength: 8 }),
  attestations: fc.array(
    fc.record({
      id: fc.uuid(),
      app: fc.option(fc.integer({ min: 0, max: 8 }), { nil: null }),
      plugin: fc.constantFrom<string | null>('weedkiller', null),
      grazeDays: fc.option(fc.integer({ min: 0, max: 60 }), { nil: null }),
      hayDays: fc.option(fc.integer({ min: 0, max: 60 }), { nil: null }),
      lactatingGrazeDays: fc.option(fc.integer({ min: 0, max: 60 }), { nil: undefined }),
      meatRemovalDays: fc.option(fc.integer({ min: 0, max: 30 }), { nil: undefined })
    }),
    { maxLength: 3 }
  ),
  production: fc.array(
    fc.record({
      id: fc.uuid(),
      subject: subjectArb,
      food: fc.constantFrom(...FOODS),
      declaredUse: fc.constantFrom<'food' | 'sale' | null>('food', 'sale', null),
      at: timeArb,
      deleted: fc.boolean()
    }),
    { maxLength: 8 }
  ),
  status: fc.array(
    fc.record({
      id: fc.uuid(),
      subject: subjectArb,
      status: fc.constantFrom('slaughtered', 'sold-for-meat', 'died', 'sold'),
      declaresMeat: fc.boolean(),
      at: timeArb,
      deleted: fc.boolean()
    }),
    { maxLength: 4 }
  ),
  hay: fc.array(
    fc.record({
      id: fc.uuid(),
      source: fc.constantFrom<'hay' | 'harvest' | undefined>('hay', 'harvest', undefined),
      block: fc.constantFrom(...BLOCKS),
      dates: fc.array(timeArb, { maxLength: 3 })
    }),
    { maxLength: 4 }
  ),
  shuffle: fc.integer({ min: 0, max: 1_000_000 })
});

type WideFarm = typeof wideFarmArb extends fc.Arbitrary<infer T> ? T : never;

function productsOf(species: string): string[] {
  return species === 'chicken' ? ['eggs', 'meat'] : ['meat', 'milk'];
}

function wideFacts(farm: WideFarm): HoldFact[] {
  const out: HoldFact[] = [];
  const speciesOf = new Map<string, string>();
  farm.subjects.groups.forEach((g, i) => {
    speciesOf.set(`group:${GROUPS[i]}`, g.species);
    if (!g.present) return;
    out.push({
      kind: 'subject',
      subjectType: 'group',
      id: GROUPS[i],
      speciesId: g.species,
      sex: null,
      currentGroupId: null,
      speciesProducts: productsOf(g.species)
    });
  });
  farm.subjects.animals.forEach((a, i) => {
    speciesOf.set(`animal:${ANIMALS[i]}`, a.species);
    if (!a.present) return;
    out.push({
      kind: 'subject',
      subjectType: 'animal',
      id: ANIMALS[i],
      speciesId: a.species,
      sex: a.sex,
      currentGroupId: a.group,
      speciesProducts: productsOf(a.species)
    });
  });
  for (const b of farm.blocks) {
    out.push({
      kind: 'block-assignment',
      blockId: b.block,
      fieldId: b.field,
      ...(b.grazeable === undefined ? {} : { areaGrazeable: b.grazeable })
    });
  }
  for (const d of farm.doses) {
    const plugin = d.product === 'wormer' || d.product === 'quick';
    out.push({
      kind: 'dose',
      treatment: {
        id: d.id,
        subjectType: d.subject.type,
        subjectId: d.subject.id,
        speciesId: speciesOf.get(`${d.subject.type}:${d.subject.id}`) ?? 'sheep',
        kind: d.kind,
        productPluginId: plugin ? d.product : null,
        productName: plugin ? null : d.product,
        route: null,
        labelUse: d.labelUse,
        administeredAtMs: d.at,
        courseEndAtMs: d.course.endAfter === null ? null : d.at + d.course.endAfter,
        courseOpen: d.course.open,
        entries: d.entries,
        deletion: d.deletion
      }
    });
  }
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
      floor: s.floor,
      deleted: s.deleted
    });
  }
  farm.apps.forEach((a, i) => {
    out.push({
      kind: 'application',
      application: {
        ref: `spray:${i}`,
        source: a.source,
        blockId: a.block,
        appliedAtMs: a.at,
        productPluginId: a.plugin,
        productName: 'Weedkiller',
        restrictions: a.restrictions,
        ...(a.formerFieldId === undefined ? {} : { formerFieldId: a.formerFieldId })
      }
    });
  });
  for (const t of farm.attestations) {
    out.push({
      kind: 'attestation',
      attestation: {
        id: t.id,
        sprayEventRef: t.app === null ? null : `spray:${t.app}`,
        productPluginId: t.plugin,
        grazeDays: t.grazeDays,
        hayDays: t.hayDays,
        ...(t.lactatingGrazeDays === undefined ? {} : { lactatingGrazeDays: t.lactatingGrazeDays }),
        ...(t.meatRemovalDays === undefined ? {} : { meatRemovalDays: t.meatRemovalDays })
      }
    });
  }
  for (const p of farm.production) {
    out.push({
      kind: 'production',
      id: p.id,
      subjectType: p.subject.type,
      subjectId: p.subject.id,
      food: p.food,
      declaredUse: p.declaredUse,
      occurredAtMs: p.at,
      deleted: p.deleted
    });
  }
  for (const s of farm.status) {
    out.push({
      kind: 'status',
      id: s.id,
      subjectType: s.subject.type,
      subjectId: s.subject.id,
      status: s.status,
      declaresMeat: s.declaresMeat,
      occurredAtMs: s.at,
      deleted: s.deleted
    });
  }
  for (const h of farm.hay) {
    out.push({
      kind: 'hay',
      ...(h.source === undefined ? {} : { source: h.source }),
      id: h.id,
      blockId: h.block,
      datesMs: h.dates
    });
  }
  // Fact order must not matter to either projection's output beyond what
  // the old one already depended on, so both see the same shuffled list.
  let seed = farm.shuffle;
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A random edit of a wide farm: drop, end, move or add one fact. */
const wideEditArb = fc.record({
  drop: fc.option(fc.nat(60), { nil: null }),
  endStay: fc.option(fc.record({ i: fc.nat(10), at: timeArb }), { nil: null }),
  moveApp: fc.option(fc.record({ i: fc.nat(8), at: timeArb }), { nil: null }),
  closeCourse: fc.option(fc.nat(8), { nil: null }),
  addDose: fc.option(doseArb, { nil: null }),
  addStay: fc.option(stayArb, { nil: null }),
  reassign: fc.option(
    fc.record({
      block: fc.constantFrom(...BLOCKS),
      field: fc.constantFrom<string | null>(...FIELDS, null)
    }),
    { nil: null }
  )
});

function editWide(farm: WideFarm, e: typeof wideEditArb extends fc.Arbitrary<infer T> ? T : never) {
  const f: WideFarm = structuredClone(farm);
  if (e.endStay) {
    const s = f.stays[e.endStay.i];
    if (s && s.length === null && e.endStay.at >= s.from) s.length = e.endStay.at - s.from;
  }
  if (e.moveApp) {
    const a = f.apps[e.moveApp.i];
    if (a) a.at = e.moveApp.at;
  }
  if (e.closeCourse !== null) {
    const d = f.doses[e.closeCourse];
    if (d) d.course = { open: false, endAfter: d.course.endAfter };
  }
  if (e.addDose) f.doses.push(e.addDose);
  if (e.addStay) f.stays.push(e.addStay);
  if (e.reassign) f.blocks.push({ ...e.reassign, grazeable: undefined });
  const facts = wideFacts(f);
  if (e.drop !== null && facts.length) facts.splice(e.drop % facts.length, 1);
  return facts;
}

describe('projection matches 0.7.1 on wide farms', () => {
  it('same holds, covered set and blocks', () => {
    fc.assert(
      fc.property(
        wideFarmArb,
        fc.constantFrom(0, 0, 90, 500),
        fc.integer({ min: NOW - 30 * DAY, max: NOW + 30 * DAY }),
        (farm, registryMax, nowMs) => {
          expectSameProjection(wideFacts(farm), nowMs, wideCtx(registryMax));
        }
      ),
      { numRuns: RUNS }
    );
  }, 300_000);

  it('same shortenings for random before and after pairs', () => {
    fc.assert(
      fc.property(wideFarmArb, wideEditArb, fc.boolean(), (farm, edit, resolves) => {
        const c = wideCtx(0);
        const before = expectSameProjection(wideFacts(farm), NOW, c);
        const after = expectSameProjection(editWide(farm, edit), NOW, c);
        const opts = { resolvesUnknown: resolves };
        const diff = next.shortenings(before.b, after.b, opts);
        expect(diff).toEqual(ref.shortenings(before.a, after.a, opts));
        expect(next.canonicalDiff(diff)).toBe(
          ref.canonicalDiff(ref.shortenings(before.a, after.a, opts))
        );
        expect(next.shortenings(after.b, before.b, opts)).toEqual(
          ref.shortenings(after.a, before.a, opts)
        );
      }),
      { numRuns: RUNS }
    );
  }, 300_000);

  it('caches kept across a run of edited farms change nothing', () => {
    // Each farm in the run differs from the last by one edit, so content
    // caches keyed on a near miss would show here.
    fc.assert(
      fc.property(
        wideFarmArb,
        fc.array(wideEditArb, { minLength: 1, maxLength: 4 }),
        fc.constantFrom(0, 90),
        (farm, edits, registryMax) => {
          const shared = wideCtx(registryMax);
          expectSameProjection(wideFacts(farm), NOW, shared);
          for (const e of edits) expectSameProjection(editWide(farm, e), NOW, shared);
          expectSameProjection(wideFacts(farm), NOW, shared);
        }
      ),
      { numRuns: RUNS }
    );
  }, 600_000);

  it('a shared verdict cache across projections changes nothing', () => {
    fc.assert(
      fc.property(fc.array(wideFarmArb, { minLength: 2, maxLength: 3 }), (farms) => {
        const shared = wideCtx(0);
        for (const farm of farms) expectSameProjection(wideFacts(farm), NOW, shared);
      }),
      { numRuns: 200 }
    );
  }, 300_000);
});

describe('projection matches 0.7.1 on the dense perf farm', () => {
  it('bigFarm projects identically', () => {
    const facts = bigFarm();
    const c = bigFarmContext();
    const { a, b } = expectSameProjection(facts, BIG_NOW, c);
    expect(b.holds.size).toBeGreaterThan(1000);
    const dropped = facts.filter((_, i) => i % 97 !== 0);
    const after = expectSameProjection(dropped, BIG_NOW, c);
    expect(next.shortenings(b, after.b)).toEqual(ref.shortenings(a, after.a));
  }, 120_000);
});
