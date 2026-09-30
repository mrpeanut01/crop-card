// @vitest-environment node
/**
 * C-35 §8 P1 through the real guard: random write sequences over a small
 * farm, from every caller tier, dated anywhere in [now - 450 d, now + 1 h],
 * each run through `guardedHoldWrite` against the test SQLite database with
 * the same repo and `lib/server/animals` calls the endpoints make inside it
 * (the endpoints' own wiring is covered by their endpoint suites). The ops:
 * sprays (known and unknown label), deletes, owner voids, grazing
 * attestations, moves and undo, a flock split, an animal leaving and
 * joining the flock, doses of a known and an unknown wormer (finite and
 * unknown withdrawal holds), owner withdrawal entries and course ends,
 * egg logs and relabels, hay cuts, block moves, deaths, slaughter and sale
 * for meat. No accepted write shortens a hold or drops a covered record,
 * except an interactive owner's void of a fresh mistake with the confirmed
 * diff (P4), which leaves exactly one audit row. A refused write changes
 * nothing, and every accepted food declaration was clear at its date (P3).
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
import { deleteSprayEvent } from '$lib/db/admin';
import { listSprayEvents } from '$lib/db/sprayEvents';
import {
  insertProductionLog,
  listAllProductionLogs,
  setProductionUse
} from '$lib/db/animalProduction';
import { insertStatusEvent } from '$lib/db/animalStatus';
import { deleteHealthEvent, insertHealthEvent, listAllHealthEvents } from '$lib/db/animalHealth';
import { deleteLatestStay, insertStay, listLocationsForSubject } from '$lib/db/animalLocations';
import { listHoldCorrections } from '$lib/db/holdCorrections';
import { recordedAtOf } from '$lib/db/holdParams';
import { listBlocks, updateBlock } from '$lib/db/blocks';
import { createCutting } from '$lib/db/hayCuttings';
import { insertGrazingAttestation } from '$lib/db/grazingAttestations';
import { getHealthEvent, saveWithdrawalEntries } from '$lib/db/animalHealth';
import {
  appendWithdrawalEntry,
  serializeWithdrawalEntries,
  type WithdrawalEntry
} from '$lib/safety/animalWithdrawal';
import { AnimalRuleError, applyMove, planMove, recordStatus } from './animals';
import { toTreatment } from './animalRecords';
import {
  canonicalDiff,
  diffIsVoidable,
  heldAt,
  holdMapKey,
  isEmptyDiff,
  shortenings,
  type HoldProjection
} from '$lib/safety/holdLedger';
import { diffHashOf, guardedHoldWrite, projectAsGuard, type GuardOptions } from './holdGuard';
import {
  DAY,
  HOUR,
  TEST_USER,
  TIERS,
  guardEvent,
  guardUser,
  seedFarm,
  seedOwner,
  spray,
  type Farm,
  type Tier
} from './holdGuard.fixtures';

const TZ = 'America/New_York';

/** A date in [now - 450 d, now + 1 h], as an offset back from now. */
const back = fc.oneof(
  { weight: 1, arbitrary: fc.double({ min: -HOUR, max: 450 * DAY, noNaN: true }) },
  { weight: 3, arbitrary: fc.double({ min: -HOUR, max: 12 * DAY, noNaN: true }) }
);

type Op =
  | { t: 'spray'; back: number; known: boolean; block: 0 | 1 }
  | { t: 'deleteSpray'; pick: number; neverApplied: boolean }
  | { t: 'voidSpray'; pick: number; confirm: 'none' | 'match' | 'stale' }
  | { t: 'attest'; pick: number; days: number }
  | { t: 'move'; back: number; field: 0 | 1 | 2 }
  | { t: 'undoMove' }
  | { t: 'split'; back: number; field: 0 | 1 | 2 }
  | { t: 'leave'; back: number; field: 0 | 1 | 2 }
  | { t: 'join'; back: number }
  | { t: 'dose'; back: number; hen: boolean; known: boolean; course: boolean }
  | { t: 'deleteDose'; pick: number; dosed: boolean }
  | { t: 'entry'; pick: number; back: number; food: 'eggs' | 'meat'; days: number; end: boolean }
  | { t: 'eggs'; back: number; hen: boolean; food: boolean }
  | { t: 'hay'; back: number; block: 0 | 1 }
  | { t: 'reassign'; block: 0 | 1; field: 1 | 2 }
  | { t: 'died'; back: number }
  | { t: 'meat'; back: number; status: 'slaughtered' | 'sold-for-meat' }
  | { t: 'relabel'; pick: number; food: boolean };

const field3 = fc.constantFrom(0 as const, 1 as const, 2 as const);

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    t: fc.constant('spray' as const),
    back,
    known: fc.boolean(),
    block: fc.constantFrom(0 as const, 1 as const)
  }),
  fc.record({ t: fc.constant('deleteSpray' as const), pick: fc.nat(), neverApplied: fc.boolean() }),
  fc.record({
    t: fc.constant('voidSpray' as const),
    pick: fc.nat(),
    confirm: fc.constantFrom('none' as const, 'match' as const, 'stale' as const)
  }),
  fc.record({
    t: fc.constant('attest' as const),
    pick: fc.nat(),
    days: fc.integer({ min: 0, max: 600 })
  }),
  fc.record({ t: fc.constant('move' as const), back, field: field3 }),
  fc.record({ t: fc.constant('undoMove' as const) }),
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
  fc.record({ t: fc.constant('deleteDose' as const), pick: fc.nat(), dosed: fc.boolean() }),
  fc.record({
    t: fc.constant('entry' as const),
    pick: fc.nat(),
    back,
    food: fc.constantFrom('eggs' as const, 'meat' as const),
    days: fc.integer({ min: 0, max: 40 }),
    end: fc.boolean()
  }),
  fc.record({ t: fc.constant('eggs' as const), back, hen: fc.boolean(), food: fc.boolean() }),
  fc.record({
    t: fc.constant('hay' as const),
    back,
    block: fc.constantFrom(0 as const, 1 as const)
  }),
  fc.record({
    t: fc.constant('reassign' as const),
    block: fc.constantFrom(0 as const, 1 as const),
    field: fc.constantFrom(1 as const, 2 as const)
  }),
  fc.record({ t: fc.constant('died' as const), back }),
  fc.record({
    t: fc.constant('meat' as const),
    back,
    status: fc.constantFrom('slaughtered' as const, 'sold-for-meat' as const)
  }),
  fc.record({ t: fc.constant('relabel' as const), pick: fc.nat(), food: fc.boolean() })
);

const stepArb = fc.record({ op: opArb, tier: fc.constantFrom(...TIERS) });

interface Step {
  fn: () => unknown;
  opts: GuardOptions;
  /** The hold keys and date of a declaration, for P3. */
  declares?: { keys: string[]; atMs: number };
}

function plan(op: Op, farm: Farm, nowMs: number, before: HoldProjection | null): Step | null {
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
    case 'deleteSpray':
    case 'voidSpray': {
      const sprays = listSprayEvents({});
      if (sprays.length === 0) return null;
      const s = sprays[op.pick % sprays.length];
      const fn = () =>
        deleteSprayEvent(s.id, {
          force: true,
          tombstone: true,
          neverApplied: op.t === 'voidSpray' || op.neverApplied,
          reason: 'property'
        });
      if (op.t === 'deleteSpray') return { fn, opts: {} };
      return {
        fn,
        opts: {
          void: {
            recordKind: 'spray',
            recordId: s.id,
            createdAtMs: recordedAtOf('spray', s.id),
            reason: 'property',
            confirmShorten:
              op.confirm === 'none' ? null : op.confirm === 'stale' ? '0'.repeat(64) : 'MATCH'
          }
        }
      };
    }
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
            reason: 'property',
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
    case 'undoMove': {
      const latest = listLocationsForSubject('group', farm.groupId).at(-1);
      if (!latest) return null;
      return {
        fn: () => {
          const r = deleteLatestStay(latest.id, TEST_USER);
          if (!r.ok) throw new Error(r.reason);
          return r;
        },
        opts: {}
      };
    }
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
    case 'deleteDose': {
      const doses = listAllHealthEvents();
      if (doses.length === 0) return null;
      const d = doses[op.pick % doses.length];
      return {
        fn: () =>
          deleteHealthEvent(d, { deletedBy: TEST_USER, reason: 'property', dosed: op.dosed }),
        opts: {}
      };
    }
    case 'entry': {
      const doses = listAllHealthEvents();
      if (doses.length === 0) return null;
      const d = doses[op.pick % doses.length];
      const treatment = toTreatment(d, { speciesId: 'chicken', sex: null });
      if (treatment.entries === 'invalid') return null;
      const base = { enteredAtMs: nowMs, enteredById: TEST_USER };
      const entry: WithdrawalEntry = op.end
        ? { ...base, kind: 'course-end', endedAtMs: at(op.back) }
        : {
            ...base,
            kind: 'vet',
            food: op.food,
            amount: op.days,
            unit: 'days',
            vetName: 'Dr. Property',
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
    case 'eggs': {
      const subjectType = op.hen ? ('animal' as const) : ('group' as const);
      const subjectId = op.hen ? farm.henId : farm.groupId;
      const atMs = at(op.back);
      return {
        fn: () =>
          insertProductionLog({
            subjectType,
            subjectId,
            kind: 'eggs',
            quantity: 6,
            unit: 'eggs',
            occurredAt: atMs,
            use: op.food ? 'food' : 'discard',
            rulesVersion: 'test',
            performedById: TEST_USER
          }),
        opts: { dated: true },
        declares: op.food
          ? { keys: [holdMapKey(`${subjectType}:${subjectId}`, 'eggs')], atMs }
          : undefined
      };
    }
    case 'hay': {
      const blockId = blockIds[op.block];
      const fieldId = listBlocks({ plantings: 'none' }).find((b) => b.id === blockId)?.fieldId;
      const atMs = at(op.back);
      return {
        fn: () =>
          createCutting({
            blockId,
            cropPluginId: 'hay',
            year: new Date(atMs).getUTCFullYear(),
            mowAt: atMs,
            rulesVersion: 'test'
          }),
        opts: { dated: true },
        declares: fieldId ? { keys: [holdMapKey(`area:${fieldId}`, 'hay')], atMs } : undefined
      };
    }
    case 'reassign':
      return {
        fn: () => updateBlock(blockIds[op.block], { fieldId: fields[op.field] }),
        opts: {}
      };
    case 'relabel': {
      const logs = listAllProductionLogs();
      if (logs.length === 0) return null;
      const log = logs[op.pick % logs.length];
      return {
        fn: () =>
          setProductionUse(log, op.food ? 'food' : 'discard', {
            by: TEST_USER,
            reason: 'property',
            rulesVersion: 'test'
          }),
        opts: {},
        declares:
          op.food && !log.declaredUse && log.use !== 'food' && log.use !== 'sale'
            ? {
                keys: [holdMapKey(`${log.subjectType}:${log.subjectId}`, 'eggs')],
                atMs: log.occurredAt
              }
            : undefined
      };
    }
    case 'died':
      if (before === null) return null;
      return {
        fn: () =>
          insertStatusEvent({
            subjectType: 'animal',
            subjectId: farm.henId,
            status: 'died',
            occurredAt: at(op.back),
            recordedById: TEST_USER
          }),
        opts: { dated: true }
      };
    case 'meat': {
      const atMs = at(op.back);
      const key = `animal:${farm.henId}`;
      return {
        fn: () =>
          recordStatus(
            {
              subjectType: 'animal',
              subjectId: farm.henId,
              status: op.status,
              occurredAt: atMs
            },
            { recordedBy: TEST_USER, rulesVersion: 'test' },
            nowMs
          ),
        opts: { dated: true },
        declares: { keys: [holdMapKey(key, 'meat'), holdMapKey(key, 'preSlaughter')], atMs }
      };
    }
  }
}

function sameHolds(a: HoldProjection, b: HoldProjection): boolean {
  return isEmptyDiff(shortenings(a, b)) && isEmptyDiff(shortenings(b, a));
}

describe('C-35 P1/P3/P4 through guardedHoldWrite', () => {
  it('never accepts a write that shortens a hold, except a confirmed owner void', async () => {
    const seen = new Map<string, number>();
    const hit = (k: string) => seen.set(k, (seen.get(k) ?? 0) + 1);
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { minLength: 1, maxLength: 14 }), async (steps) => {
        const ownerId = seedOwner('guard-prop');
        const nowMs = Date.now();
        const farm = runWithTenant(ownerId, () => seedFarm(nowMs - 460 * DAY));
        await runWithTenantAsync(ownerId, async () => {
          for (const { op, tier } of steps) {
            const before = await projectAsGuard(TZ, nowMs);
            const step = plan(op, farm, nowMs, before);
            if (!step) continue;
            let opts = step.opts;
            if (opts.void?.confirmShorten === 'MATCH') {
              const ask = await attempt(
                tier,
                step.fn,
                { ...opts, void: { ...opts.void, confirmShorten: null } },
                nowMs
              );
              const hash = ask instanceof AnimalRuleError ? ask.extra.diffHash : undefined;
              opts = {
                ...opts,
                void: { ...opts.void, confirmShorten: typeof hash === 'string' ? hash : null }
              };
            }
            const corrections = listHoldCorrections().length;
            const outcome = await attempt(tier, step.fn, opts, nowMs);
            const after = await projectAsGuard(TZ, nowMs);
            for (const [k, spans] of after.holds) {
              if (
                /^(animal|group):.*\|(eggs|meat)$/.test(k) &&
                spans.some((x) => x.basis === 'known')
              ) {
                hit('finite-withdrawal-or-exposure');
              }
            }
            if (outcome instanceof AnimalRuleError) hit(`refused:${outcome.code}`);
            else if (!(outcome instanceof Error)) hit(`accepted:${op.t}`);
            if (outcome instanceof Error) {
              expect(sameHolds(before, after)).toBe(true);
              expect(listHoldCorrections()).toHaveLength(corrections);
              continue;
            }
            // An interactive owner's label data may end time held only
            // because a label was unknown (C-01, C-27); nothing else.
            const diff = shortenings(before, after, {
              resolvesUnknown: opts.resolvesUnknown === true && tier === 'owner'
            });
            if (isEmptyDiff(diff)) {
              expect(listHoldCorrections()).toHaveLength(corrections);
            } else {
              expect(opts.void).toBeDefined();
              expect(tier).toBe('owner');
              expect(diffIsVoidable(diff)).toBe(true);
              expect(opts.void!.createdAtMs).not.toBeNull();
              expect(nowMs - opts.void!.createdAtMs!).toBeLessThanOrEqual(48 * HOUR);
              const rows = listHoldCorrections();
              expect(rows).toHaveLength(corrections + 1);
              expect(rows[0].diffJson).toBe(canonicalDiff(diff));
              expect(rows[0].diffHash).toBe(diffHashOf(diff));
            }
            if (step.declares) {
              expect(heldAt(after, step.declares.keys, step.declares.atMs)).toBeNull();
            }
          }
        });
      }),
      {
        numRuns: 120,
        // An attestation needs a spray before it in the same run, and a
        // withdrawal entry needs a dose before it, which random sequences
        // reach only a handful of times; these examples make the coverage
        // check below independent of the seed.
        examples: [
          [
            [
              { op: { t: 'spray', back: 2 * DAY, known: false, block: 0 }, tier: 'owner' },
              { op: { t: 'attest', pick: 0, days: 400 }, tier: 'owner' }
            ]
          ],
          [
            [
              {
                op: { t: 'dose', back: 2 * DAY, hen: true, known: true, course: false },
                tier: 'owner'
              },
              {
                op: { t: 'entry', pick: 0, back: 0, food: 'eggs', days: 40, end: false },
                tier: 'owner'
              }
            ]
          ]
        ]
      }
    );
    for (const k of [
      'finite-withdrawal-or-exposure',
      'refused:HOLD_WOULD_SHORTEN',
      'accepted:dose',
      'accepted:entry',
      'accepted:eggs',
      'accepted:hay',
      'accepted:split',
      'accepted:leave',
      'accepted:join',
      'accepted:meat',
      'accepted:attest'
    ]) {
      expect(seen.get(k) ?? 0, k).toBeGreaterThan(0);
    }
  }, 600_000);

  it('accepts an interactive owner void of a fresh mistake only with the confirmed diff (P4)', async () => {
    let voided = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.double({ min: 0, max: 20 * DAY, noNaN: true }), { minLength: 1, maxLength: 4 }),
        fc.nat(),
        fc.constantFrom(...TIERS),
        async (backs, pick, tier) => {
          const ownerId = seedOwner('guard-void');
          const nowMs = Date.now();
          const farm = runWithTenant(ownerId, () => seedFarm(nowMs - 30 * DAY));
          await runWithTenantAsync(ownerId, async () => {
            for (const b of backs) {
              const saved = await attempt(
                'owner',
                () => spray(farm, Math.round(nowMs - b), 'guard-known'),
                { dated: true },
                nowMs
              );
              expect(saved).not.toBeInstanceOf(Error);
            }
            const sprays = listSprayEvents({});
            const s = sprays[pick % sprays.length];
            const step = plan(
              { t: 'voidSpray', pick: sprays.indexOf(s), confirm: 'none' },
              farm,
              nowMs,
              null
            )!;
            const before = await projectAsGuard(TZ, nowMs);
            const ask = await attempt(tier, step.fn, step.opts, nowMs);
            const diffBefore = shortenings(before, await projectAsGuard(TZ, nowMs));
            expect(isEmptyDiff(diffBefore)).toBe(true);
            if (!(ask instanceof AnimalRuleError)) {
              // Nothing to shorten: the void saved as a plain delete.
              expect(listHoldCorrections()).toHaveLength(0);
              return;
            }
            if (tier !== 'owner') {
              expect(ask.code).toBe('OWNER_ONLY');
              return;
            }
            expect(ask.code).toBe('HOLD_WOULD_SHORTEN');
            const hash = ask.extra.diffHash as string;
            const opts = { ...step.opts, void: { ...step.opts.void!, confirmShorten: hash } };
            const done = await attempt(tier, step.fn, opts, nowMs);
            expect(done).not.toBeInstanceOf(Error);
            const diff = shortenings(before, await projectAsGuard(TZ, nowMs));
            expect(isEmptyDiff(diff)).toBe(false);
            expect(diffIsVoidable(diff)).toBe(true);
            const rows = listHoldCorrections();
            expect(rows).toHaveLength(1);
            expect(rows[0].diffJson).toBe(canonicalDiff(diff));
            expect(rows[0].diffHash).toBe(diffHashOf(diff));
            expect(rows[0].diffHash).toBe(hash);
            voided++;
          });
        }
      ),
      { numRuns: 40 }
    );
    expect(voided).toBeGreaterThan(0);
  }, 300_000);

  it('accepts every insert dated now that only adds or closes (P2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            op: fc.oneof(
              fc.record({
                t: fc.constant('spray' as const),
                back: fc.constant(0),
                known: fc.boolean(),
                block: fc.constantFrom(0 as const, 1 as const)
              }),
              fc.record({
                t: fc.constant('dose' as const),
                back: fc.constant(0),
                hen: fc.boolean()
              }),
              fc.record({
                t: fc.constant('move' as const),
                back: fc.constant(0),
                field: fc.constantFrom(0 as const, 1 as const, 2 as const)
              })
            ),
            tier: fc.constantFrom(...TIERS)
          }),
          { minLength: 1, maxLength: 6 }
        ),
        async (steps) => {
          const ownerId = seedOwner('guard-live');
          const start = Date.now();
          const farm = runWithTenant(ownerId, () => seedFarm(start - 30 * DAY));
          await runWithTenantAsync(ownerId, async () => {
            let i = 0;
            for (const { op, tier } of steps) {
              const nowMs = start + ++i * 1000;
              const step = plan({ ...op, back: 0 } as Op, farm, nowMs, null)!;
              const outcome = await attempt(tier, step.fn, step.opts, nowMs);
              expect(outcome).not.toBeInstanceOf(Error);
            }
          });
        }
      ),
      { numRuns: 25 }
    );
  }, 120_000);
});

async function attempt(
  tier: Tier,
  fn: () => unknown,
  opts: GuardOptions,
  nowMs: number
): Promise<unknown> {
  try {
    return await guardedHoldWrite(guardEvent(tier), guardUser(tier), fn, { ...opts, nowMs });
  } catch (e) {
    if (e instanceof Error) return e;
    throw e;
  }
}
