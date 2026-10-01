// @vitest-environment node
/**
 * G3-03: the page a `hold-covers-sale` push (and the /today covered-logs
 * alert) opens must mark every record the push names. Random write
 * sequences go through the real guard as an interactive owner, as in
 * `holdGuard.properties.test.ts`; after each, every `log:` and `meat:` id the
 * hold ledger marks covered must also be marked by the page markers.
 */
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('$lib/server/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/registry')>();
  const known = {
    pluginId: 'guard-known',
    type: 'herbicide',
    displayName: 'Known label',
    activeIngredients: [],
    grazingRestrictions: {
      source: 'test label',
      grazeDays: 10,
      hayDays: 10,
      lactatingDairyGrazeDays: 10,
      meatAnimalRemovalBeforeSlaughterDays: 3
    }
  };
  type Registry = Awaited<ReturnType<typeof actual.getRegistry>>;
  const wrap = (reg: Registry): Registry =>
    new Proxy(reg, {
      get(target, prop) {
        if (prop === 'get') {
          return (id: string) => (id === known.pluginId ? { plugin: known } : target.get(id));
        }
        if (prop === 'has') return (id: string) => id === known.pluginId || target.has(id);
        if (prop === 'all') return () => [...target.all(), { plugin: known }];
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      }
    }) as Registry;
  const wormer = {
    pluginId: 'prop-wormer',
    type: 'animal-health',
    displayName: 'Prop wormer',
    activeIngredients: [{ name: 'propazole' }],
    labelUses: [{ speciesId: 'chicken', class: 'all', withdrawal: { meatDays: 14, eggsDays: 7 } }]
  };
  const species: Record<string, object> = {
    chicken: {
      pluginId: 'chicken',
      displayName: 'Chicken',
      foodProducingDefault: true,
      products: ['eggs', 'meat']
    }
  };
  return {
    ...actual,
    getRegistry: async () => wrap(await actual.getRegistry()),
    getBaseRegistry: async () => wrap(await actual.getBaseRegistry()),
    ownerRegistryNow: (base: Registry) => base,
    getDataKinds: async () => ({
      species: { get: (id: string) => species[id] },
      animalHealth: {
        get: (id: string) => (id === wormer.pluginId ? wormer : undefined),
        has: (id: string) => id === wormer.pluginId
      }
    })
  };
});

import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { listBlocks } from '$lib/db/blocks';
import {
  getProductionLog,
  insertProductionLog,
  listAllProductionLogs,
  setProductionUse
} from '$lib/db/animalProduction';
import { getStatusEvent } from '$lib/db/animalStatus';
import { insertHealthEvent, listAllHealthEvents, getHealthEvent } from '$lib/db/animalHealth';
import { saveWithdrawalEntries } from '$lib/db/animalHealth';
import { insertStay } from '$lib/db/animalLocations';
import { insertGrazingAttestation } from '$lib/db/grazingAttestations';
import {
  appendWithdrawalEntry,
  serializeWithdrawalEntries,
  type WithdrawalEntry
} from '$lib/safety/animalWithdrawal';
import { applyMove, planMove, recordStatus } from './animals';
import { coveredLogIds, coveredMeatIds, healthPlugins, toTreatment } from './animalRecords';
import { ledgerCoveredIds } from './coveredRecords';
import { listProductionLogs } from '$lib/db/animalProduction';
import { listStatusEvents } from '$lib/db/animalStatus';
import { guardedHoldWrite, projectActiveFarm, type GuardOptions } from './holdGuard';
import {
  DAY,
  TEST_USER,
  guardEvent,
  guardUser,
  seedFarm,
  seedOwner,
  spray,
  type Farm
} from './holdGuard.fixtures';

const TZ = 'America/New_York';

const back = fc.oneof(
  { weight: 1, arbitrary: fc.double({ min: 0, max: 120 * DAY, noNaN: true }) },
  { weight: 3, arbitrary: fc.double({ min: 0, max: 12 * DAY, noNaN: true }) }
);
const field3 = fc.constantFrom(0 as const, 1 as const, 2 as const);

type Op =
  | { t: 'spray'; back: number; known: boolean; block: 0 | 1 }
  | { t: 'attest'; pick: number; days: number }
  | { t: 'move'; back: number; field: 0 | 1 | 2 }
  | { t: 'split'; back: number; field: 0 | 1 | 2 }
  | { t: 'leave'; back: number; field: 0 | 1 | 2 }
  | { t: 'join'; back: number }
  | { t: 'dose'; back: number; hen: boolean; known: boolean; course: boolean }
  | { t: 'entry'; pick: number; food: 'eggs' | 'meat'; days: number }
  | { t: 'eggs'; back: number; hen: boolean; sale: boolean }
  | { t: 'relabel'; pick: number }
  | { t: 'meat'; back: number; status: 'slaughtered' | 'sold-for-meat' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    t: fc.constant('spray' as const),
    back,
    known: fc.boolean(),
    block: fc.constantFrom(0 as const, 1 as const)
  }),
  fc.record({
    t: fc.constant('attest' as const),
    pick: fc.nat(),
    days: fc.integer({ min: 0, max: 60 })
  }),
  fc.record({ t: fc.constant('move' as const), back, field: field3 }),
  fc.record({ t: fc.constant('split' as const), back, field: field3 }),
  fc.record({ t: fc.constant('leave' as const), back, field: field3 }),
  fc.record({ t: fc.constant('join' as const), back }),
  fc.record({
    t: fc.constant('dose' as const),
    back,
    hen: fc.boolean(),
    known: fc.boolean(),
    course: fc.boolean()
  }),
  fc.record({
    t: fc.constant('entry' as const),
    pick: fc.nat(),
    food: fc.constantFrom('eggs' as const, 'meat' as const),
    days: fc.integer({ min: 0, max: 40 })
  }),
  fc.record({ t: fc.constant('eggs' as const), back, hen: fc.boolean(), sale: fc.boolean() }),
  fc.record({ t: fc.constant('relabel' as const), pick: fc.nat() }),
  fc.record({
    t: fc.constant('meat' as const),
    back,
    status: fc.constantFrom('slaughtered' as const, 'sold-for-meat' as const)
  })
);

function plan(op: Op, farm: Farm, nowMs: number): { fn: () => unknown; opts: GuardOptions } | null {
  const at = (b: number) => Math.round(nowMs - b);
  const fields = [farm.barnId, farm.pastureId, farm.otherPastureId];
  const group = { subjectType: 'group' as const, subjectId: farm.groupId };
  const blockIds = [farm.blockId, farm.otherBlockId];
  switch (op.t) {
    case 'spray':
      return {
        fn: () =>
          spray(
            farm,
            at(op.back),
            op.known ? 'guard-known' : 'guard-unsourced',
            blockIds[op.block]
          ),
        opts: { dated: true }
      };
    case 'attest': {
      const sprays = listSprayEvents({});
      if (sprays.length === 0) return null;
      const s = sprays[op.pick % sprays.length];
      const fieldId = listBlocks({ plantings: 'none' }).find((b) => b.id === s.blockId)?.fieldId;
      if (!fieldId) return null;
      return {
        fn: () =>
          insertGrazingAttestation({
            fieldId,
            sprayEventRef: `spray:${s.id}`,
            productPluginId: s.products[0]?.pluginId ?? null,
            grazeDays: op.days,
            hayDays: op.days,
            lactatingGrazeDays: op.days,
            meatRemovalDays: op.days,
            reason: 'agreement',
            attestedBy: TEST_USER
          }),
        opts: { resolvesUnknown: true }
      };
    }
    case 'move':
      return {
        fn: () => {
          const r = insertStay({
            subject: group,
            fieldId: fields[op.field],
            atMs: at(op.back),
            movedBy: null
          });
          if (!r.ok) throw new Error('same time');
          return r;
        },
        opts: { dated: true }
      };
    case 'split':
    case 'leave':
    case 'join': {
      const movedAt = at(op.back);
      const input =
        op.t === 'split'
          ? {
              subjectType: 'group' as const,
              subjectId: farm.groupId,
              fieldId: fields[op.field],
              count: 2,
              newGroupName: 'Split',
              movedAt
            }
          : op.t === 'leave'
            ? {
                subjectType: 'animal' as const,
                subjectId: farm.henId,
                fieldId: fields[op.field],
                movedAt
              }
            : {
                subjectType: 'animal' as const,
                subjectId: farm.henId,
                toGroupId: farm.groupId,
                movedAt
              };
      return {
        fn: () => applyMove(planMove(input, nowMs), { movedBy: TEST_USER }, nowMs),
        opts: { dated: true }
      };
    }
    case 'dose':
      return {
        fn: () =>
          insertHealthEvent({
            subjectType: op.hen ? 'animal' : 'group',
            subjectId: op.hen ? farm.henId : farm.groupId,
            kind: 'deworm',
            productPluginId: op.known ? 'prop-wormer' : null,
            productName: op.known ? 'Prop wormer' : 'Unknown wormer',
            labelUse: op.known ? 'label' : null,
            route: 'oral',
            administeredAt: at(op.back),
            courseEndAt: op.course ? null : at(op.back),
            withdrawalClear: null,
            rulesVersion: 'test',
            foodProducingAtRecord: true,
            performedById: TEST_USER
          }),
        opts: { dated: true }
      };
    case 'entry': {
      const doses = listAllHealthEvents();
      if (doses.length === 0) return null;
      const d = doses[op.pick % doses.length];
      const treatment = toTreatment(d, { speciesId: 'chicken', sex: null });
      if (treatment.entries === 'invalid') return null;
      const entry: WithdrawalEntry = {
        enteredAtMs: nowMs,
        enteredById: TEST_USER,
        kind: 'vet',
        food: op.food,
        amount: op.days,
        unit: 'days',
        vetName: 'Dr. Agreement',
        vetSaysNone: op.days === 0
      };
      const entries = appendWithdrawalEntry(treatment.entries, entry);
      return {
        fn: () => {
          if (!getHealthEvent(d.id)) throw new Error('gone');
          return saveWithdrawalEntries(d.id, serializeWithdrawalEntries(entries), nowMs);
        },
        opts: { resolvesUnknown: true }
      };
    }
    case 'eggs':
      return {
        fn: () =>
          insertProductionLog({
            subjectType: op.hen ? 'animal' : 'group',
            subjectId: op.hen ? farm.henId : farm.groupId,
            kind: 'eggs',
            quantity: 6,
            unit: 'eggs',
            occurredAt: at(op.back),
            use: op.sale ? 'sale' : 'food',
            rulesVersion: 'test',
            performedById: TEST_USER
          }),
        opts: { dated: true }
      };
    case 'relabel': {
      const logs = listAllProductionLogs();
      if (logs.length === 0) return null;
      const log = logs[op.pick % logs.length];
      return {
        fn: () =>
          setProductionUse(log, 'discard', {
            by: TEST_USER,
            reason: 'agreement',
            rulesVersion: 'test'
          }),
        opts: {}
      };
    }
    case 'meat':
      return {
        fn: () =>
          recordStatus(
            {
              subjectType: 'animal',
              subjectId: farm.henId,
              status: op.status,
              occurredAt: at(op.back)
            },
            { recordedBy: TEST_USER, rulesVersion: 'test' },
            nowMs
          ),
        opts: { dated: true }
      };
  }
}

async function attempt(fn: () => unknown, opts: GuardOptions, nowMs: number): Promise<void> {
  try {
    await guardedHoldWrite(guardEvent('owner'), guardUser('owner'), fn, { ...opts, nowMs });
  } catch {
    // A refused write is fine here; only what was saved matters.
  }
}

describe('G3-03 page markers agree with the hold ledger', () => {
  it('marks every ledger-covered egg, milk or meat record on the page a push opens', async () => {
    let checkedLogs = 0;
    let checkedMeat = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 2, maxLength: 12 }), async (ops) => {
        const ownerId = seedOwner('agree');
        const nowMs = Date.now();
        const farm = runWithTenant(ownerId, () => seedFarm(nowMs - 130 * DAY));
        await runWithTenantAsync(ownerId, async () => {
          for (const op of ops) {
            const step = plan(op, farm, nowMs);
            if (step) await attempt(step.fn, step.opts, nowMs);
          }
          const { projection } = await projectActiveFarm(TZ, nowMs);
          const plugins = await healthPlugins();
          const ledger = await ledgerCoveredIds(TZ, nowMs);
          for (const id of projection.covered.keys()) {
            if (id.startsWith('log:')) {
              const log = getProductionLog(id.slice(4));
              if (!log) continue;
              const rows = listProductionLogs(log.subjectType, log.subjectId, 1000);
              const marked = coveredLogIds(
                log.subjectType,
                log.subjectId,
                rows,
                plugins,
                TZ,
                ledger
              );
              expect(marked.has(log.id), id).toBe(true);
              checkedLogs++;
            } else if (id.startsWith('meat:')) {
              const e = getStatusEvent(id.slice(5));
              if (!e) continue;
              const marked = coveredMeatIds(listStatusEvents(e.subjectType, e.subjectId), ledger);
              expect(marked.has(e.id), id).toBe(true);
              checkedMeat++;
            }
          }
        });
      }),
      {
        numRuns: 80,
        examples: [
          [
            [
              { t: 'move', back: 20 * DAY, field: 1 },
              { t: 'eggs', back: 4 * DAY, hen: false, sale: true },
              { t: 'spray', back: 8 * DAY, known: false, block: 0 }
            ]
          ],
          [
            [
              { t: 'eggs', back: 2 * DAY, hen: true, sale: true },
              { t: 'dose', back: 5 * DAY, hen: false, known: false, course: false }
            ]
          ],
          [
            [
              { t: 'move', back: 20 * DAY, field: 1 },
              { t: 'meat', back: 2 * DAY, status: 'sold-for-meat' },
              { t: 'spray', back: 4 * DAY, known: true, block: 0 }
            ]
          ]
        ]
      }
    );
    expect(checkedLogs).toBeGreaterThan(0);
    expect(checkedMeat).toBeGreaterThan(0);
  }, 600_000);
});
