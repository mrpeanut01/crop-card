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
  type Food,
  type FoodSubject
} from './animalWithdrawal';
import { exposureHolds, exposureSpans, type ExposureStay } from './grazingExposure';
import type { GrazingApplication } from './grazingInterval';
import {
  HOLD_KINDS,
  holdMapKey,
  isEmptyDiff,
  projectHolds,
  shortenings,
  spansContain,
  type HoldProjection
} from './holdLedger';
import {
  DAY,
  NOW,
  T0,
  TZ,
  appArb,
  ctx,
  doseArb,
  factsOf,
  farmArb,
  mutate,
  mutationArb,
  stayArb,
  timeArb,
  treatment,
  type Farm
} from './__reference__/ledgerArbitraries';

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
