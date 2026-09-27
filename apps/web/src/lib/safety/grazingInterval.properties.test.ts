import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { GrazingRestrictions } from '$lib/plugins/schemas';
import { ymdInZone } from '$lib/prefs';
import {
  DAY_MS,
  GRAZING_LOOKBACK_DAYS,
  evaluateGrazing,
  evaluateHayCut,
  farmCopyRestrictions,
  labelGrazeDays,
  labelHayDays,
  roundedClearMs,
  startOfNextLocalDay,
  type GrazingApplication,
  type GrazingAttestationInput,
  type GrazingSubject
} from './grazingInterval';

const ZONES = [
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Australia/Lord_Howe',
  'Asia/Kathmandu',
  'Pacific/Kiritimati',
  'America/Santiago',
  'America/St_Johns'
];
const SPECIES = ['sheep', 'goat', 'cattle', 'horse', 'chicken', 'pig'];
const T0 = Date.UTC(2020, 0, 1);
const T1 = Date.UTC(2032, 0, 1);

const zoneArb = fc.constantFrom(...ZONES);
const msArb = fc.integer({ min: T0, max: T1 });
const daysArb = fc.integer({ min: 0, max: 400 });
const optDays = fc.option(daysArb, { nil: undefined });
const speciesArb = fc.constantFrom(...SPECIES);

const exceptionArb = fc.record(
  {
    speciesId: speciesArb,
    lactating: fc.option(fc.boolean(), { nil: undefined }),
    grazeDays: optDays,
    hayDays: optDays
  },
  { requiredKeys: ['speciesId'] }
);

const restrictionsArb: fc.Arbitrary<GrazingRestrictions> = fc
  .record({
    grazeDays: optDays,
    hayDays: optDays,
    lactatingDairyGrazeDays: optDays,
    meatAnimalRemovalBeforeSlaughterDays: optDays,
    notForPasture: fc.option(fc.boolean(), { nil: undefined }),
    speciesExceptions: fc.option(fc.array(exceptionArb, { maxLength: 4 }), { nil: undefined })
  })
  .map((g) => {
    const seen = new Set<string>();
    const speciesExceptions = (g.speciesExceptions ?? []).filter((e) => {
      const k = `${e.speciesId}:${e.lactating === true}`;
      if (seen.has(k) || (e.grazeDays === undefined && e.hayDays === undefined)) return false;
      seen.add(k);
      return true;
    });
    const out: GrazingRestrictions = { source: 'property test' };
    for (const [k, v] of Object.entries(g)) {
      if (v !== undefined && k !== 'speciesExceptions') (out as Record<string, unknown>)[k] = v;
    }
    if (speciesExceptions.length) out.speciesExceptions = speciesExceptions;
    return out;
  });

const applicationArb = (i: number): fc.Arbitrary<GrazingApplication> =>
  fc.record({
    ref: fc.constant(`spray:e${i}`),
    source: fc.constantFrom('spray' as const, 'insecticide' as const, 'fungicide' as const),
    blockId: fc.constantFrom('b1', 'b2'),
    appliedAtMs: msArb,
    productPluginId: fc.constantFrom('p1', 'p2', null),
    productName: fc.constant('Product'),
    restrictions: fc.option(restrictionsArb, { nil: null })
  });

const applicationsArb = fc
  .integer({ min: 0, max: 4 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => applicationArb(i))));

const subjectArb: fc.Arbitrary<GrazingSubject> = fc.record({
  speciesId: fc.option(speciesArb, { nil: null }),
  foodProducing: fc.boolean(),
  lactating: fc.option(fc.boolean(), { nil: undefined })
});

const RUNS = { numRuns: 300 };

interface Oracle {
  days: number | 'unknown';
  /** The longest value the label does state for this subject. */
  floor: number | null;
}

/**
 * C-24, C-25 written out plainly, without the kernel's selectors: a known
 * species takes its own exception in place of the general value (and its
 * own lactating exception in place of the dairy value); an unknown species
 * takes the longest of the general value and every exception. A lactating
 * (or presumed lactating) subject waits the longer of the two paths. Any
 * value the subject needs that the label leaves out is unknown.
 */
function oracleGraze(r: GrazingRestrictions, subject: GrazingSubject): Oracle {
  const exc = r.speciesExceptions ?? [];
  const pieces: (number | undefined)[] = [];
  const pick = (lactating: boolean, fallback: number | undefined) => {
    const matching = exc.filter(
      (e) => (e.lactating === true) === lactating && e.grazeDays !== undefined
    );
    if (subject.speciesId !== null) {
      const own = matching.find((e) => e.speciesId === subject.speciesId);
      pieces.push(own ? own.grazeDays : fallback);
      return;
    }
    pieces.push(fallback);
    for (const e of matching) pieces.push(e.grazeDays);
  };
  pick(false, r.grazeDays);
  if (subject.lactating !== false) pick(true, r.lactatingDairyGrazeDays);
  const known = pieces.filter((d): d is number => d !== undefined);
  return {
    days: known.length === pieces.length ? Math.max(...known) : 'unknown',
    floor: known.length ? Math.max(...known) : null
  };
}

describe('grazing kernel properties', () => {
  it('the rounded clear time is never before the exact clear time, in any zone (C-04)', () => {
    fc.assert(
      fc.property(msArb, daysArb, zoneArb, (from, days, zone) => {
        const rounded = roundedClearMs(from, days, zone);
        expect(rounded).toBeGreaterThanOrEqual(from + days * DAY_MS);
        if (days > 0) {
          expect(rounded - (from + days * DAY_MS)).toBeLessThanOrEqual(DAY_MS + 3_600_000);
        }
      }),
      RUNS
    );
  });

  it('startOfNextLocalDay is the first instant of the next local day', () => {
    fc.assert(
      fc.property(msArb, zoneArb, (ms, zone) => {
        const next = startOfNextLocalDay(ms, zone);
        expect(next).toBeGreaterThan(ms);
        expect(ymdInZone(next, zone)).not.toBe(ymdInZone(ms, zone));
        expect(ymdInZone(next - 1, zone)).toBe(ymdInZone(ms, zone));
      }),
      RUNS
    );
  });

  it('clearance is never before application plus the largest applicable interval', () => {
    fc.assert(
      fc.property(applicationsArb, subjectArb, msArb, zoneArb, (apps, subject, atMs, zone) => {
        const v = evaluateGrazing({ applications: apps, subject, atMs, timeZone: zone });
        for (const f of v.findings) {
          const a = apps.find((x) => x.ref === f.ref)!;
          if (a.restrictions?.notForPasture === true) {
            expect(f.reason).toBe('GRAZING_PROHIBITED');
            continue;
          }
          const want = a.restrictions ? oracleGraze(a.restrictions, subject).days : 'unknown';
          if (want === 'unknown') {
            expect(f.days).toBeNull();
            continue;
          }
          expect(f.days).toBe(want);
          expect(f.clearsAtMs!).toBeGreaterThanOrEqual(f.appliedAtMs + want * DAY_MS);
        }
        if (v.clearsAtMs !== null) {
          for (const f of v.findings.filter((x) => x.active)) {
            expect(v.clearsAtMs).toBeGreaterThanOrEqual(f.appliedAtMs + (f.days ?? 0) * DAY_MS);
          }
        }
      }),
      RUNS
    );
  });

  it('an attestation never yields fewer days than the known part of the label', () => {
    fc.assert(
      fc.property(
        restrictionsArb,
        subjectArb,
        fc.integer({ min: 0, max: 400 }),
        msArb,
        zoneArb,
        (r0, subject, attested, applied, zone) => {
          const r: GrazingRestrictions = { ...r0, notForPasture: undefined };
          const a: GrazingApplication = {
            ref: 'spray:p',
            source: 'spray',
            blockId: 'b1',
            appliedAtMs: applied,
            productPluginId: 'p1',
            productName: 'P',
            restrictions: r
          };
          const v = evaluateGrazing({
            applications: [a],
            subject,
            atMs: applied,
            timeZone: zone,
            attestations: [
              {
                id: 't',
                sprayEventRef: 'spray:p',
                productPluginId: 'p1',
                grazeDays: attested,
                hayDays: null,
                lactatingGrazeDays: attested
              }
            ]
          });
          const f = v.findings[0];
          const want = oracleGraze(r, subject);
          expect(f.days).not.toBeNull();
          if (want.floor !== null) expect(f.days!).toBeGreaterThanOrEqual(want.floor);
          if (want.days === 'unknown') expect(f.days!).toBeGreaterThanOrEqual(attested);
          else expect(f.days).toBe(Math.max(want.days, attested));
        }
      ),
      RUNS
    );
  });

  it('a general-only attestation never clears a lactating path the label leaves unknown', () => {
    fc.assert(
      fc.property(
        restrictionsArb,
        fc.option(speciesArb, { nil: null }),
        fc.integer({ min: 0, max: 400 }),
        msArb,
        zoneArb,
        fc.boolean(),
        (r0, speciesId, attested, applied, zone, withLabel) => {
          const r: GrazingRestrictions = {
            ...r0,
            notForPasture: undefined,
            lactatingDairyGrazeDays: undefined,
            speciesExceptions: r0.speciesExceptions?.filter((e) => e.lactating !== true)
          };
          const v = evaluateGrazing({
            applications: [
              {
                ref: 'spray:p',
                source: 'spray',
                blockId: 'b1',
                appliedAtMs: applied,
                productPluginId: 'p1',
                productName: 'P',
                restrictions: withLabel ? r : null
              }
            ],
            subject: { speciesId, foodProducing: true, lactating: true },
            atMs: applied,
            timeZone: zone,
            attestations: [
              {
                id: 't',
                sprayEventRef: 'spray:p',
                productPluginId: 'p1',
                grazeDays: attested,
                hayDays: null
              }
            ]
          });
          expect(v.findings[0].days).toBeNull();
          expect(v.reason).toBe('GRAZING_UNKNOWN');
        }
      ),
      RUNS
    );
  });

  it('the lactating path is never shorter than the general path', () => {
    fc.assert(
      fc.property(restrictionsArb, fc.option(speciesArb, { nil: null }), (r, speciesId) => {
        const general = labelGrazeDays(r, { speciesId, lactating: false });
        const lact = labelGrazeDays(r, { speciesId, lactating: true });
        if (general === 'unknown') expect(lact).toBe('unknown');
        else if (lact !== 'unknown') expect(lact).toBeGreaterThanOrEqual(general);
      }),
      RUNS
    );
  });

  it('a species with no exception never gets less than the general interval', () => {
    fc.assert(
      fc.property(restrictionsArb, speciesArb, fc.boolean(), (r, speciesId, lactating) => {
        const hasOwn = (r.speciesExceptions ?? []).some((e) => e.speciesId === speciesId);
        fc.pre(!hasOwn && r.grazeDays !== undefined);
        const d = labelGrazeDays(r, { speciesId, lactating });
        if (d !== 'unknown') expect(d).toBeGreaterThanOrEqual(r.grazeDays!);
      }),
      RUNS
    );
  });

  it('a species exception can only come from data: without exceptions every species gets the same days', () => {
    fc.assert(
      fc.property(
        restrictionsArb,
        speciesArb,
        speciesArb,
        fc.boolean(),
        (r0, s1, s2, lactating) => {
          const r: GrazingRestrictions = { ...r0, speciesExceptions: undefined };
          expect(labelGrazeDays(r, { speciesId: s1, lactating })).toBe(
            labelGrazeDays(r, { speciesId: s2, lactating })
          );
        }
      ),
      RUNS
    );
  });

  it('a missing-data block exists only for a food animal with an application in the lookback window', () => {
    fc.assert(
      fc.property(applicationsArb, subjectArb, msArb, zoneArb, (apps, subject, atMs, zone) => {
        const v = evaluateGrazing({ applications: apps, subject, atMs, timeZone: zone });
        if (v.status === 'block' && v.reason === 'GRAZING_UNKNOWN') {
          expect(subject.foodProducing).toBe(true);
          expect(v.lookbackDays).toBeGreaterThanOrEqual(GRAZING_LOOKBACK_DAYS);
          const inWindow = apps.some((a) => a.appliedAtMs >= atMs - v.lookbackDays * DAY_MS);
          expect(inWindow).toBe(true);
        }
        if (!subject.foodProducing) expect(v.status).not.toBe('block');
      }),
      RUNS
    );
  });

  it('unknown data always blocks a food animal while the application is in the window', () => {
    fc.assert(
      fc.property(
        msArb,
        fc.integer({ min: 0, max: GRAZING_LOOKBACK_DAYS }),
        zoneArb,
        speciesArb,
        (applied, ageDays, zone, speciesId) => {
          const a: GrazingApplication = {
            ref: 'spray:u',
            source: 'spray',
            blockId: 'b1',
            appliedAtMs: applied,
            productPluginId: null,
            productName: 'Unknown',
            restrictions: null
          };
          const v = evaluateGrazing({
            applications: [a],
            subject: { speciesId, foodProducing: true },
            atMs: applied + ageDays * DAY_MS,
            timeZone: zone
          });
          expect(v.status).toBe('block');
          expect(v.reason).toBe('GRAZING_UNKNOWN');
        }
      ),
      RUNS
    );
  });

  it('an attestation clears exactly the attested interval and nothing more', () => {
    fc.assert(
      fc.property(
        msArb,
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: -3 * DAY_MS, max: 3 * DAY_MS }),
        zoneArb,
        fc.boolean(),
        (applied, days, delta, zone, hay) => {
          const a: GrazingApplication = {
            ref: 'spray:x',
            source: 'spray',
            blockId: 'b1',
            appliedAtMs: applied,
            productPluginId: 'p1',
            productName: 'P',
            restrictions: null
          };
          const t: GrazingAttestationInput = {
            id: 't',
            sprayEventRef: 'spray:x',
            productPluginId: 'p1',
            grazeDays: hay ? null : days,
            hayDays: hay ? days : null,
            lactatingGrazeDays: hay ? null : days
          };
          const clear = roundedClearMs(applied, days, zone);
          const atMs = clear + delta;
          const input = { applications: [a], attestations: [t], atMs, timeZone: zone };
          const v = hay
            ? evaluateHayCut(input)
            : evaluateGrazing({ ...input, subject: { speciesId: 'sheep', foodProducing: true } });
          expect(v.status).toBe(atMs < clear ? 'block' : 'clear');
          if (atMs < clear) expect(v.clearsAtMs).toBe(clear);
        }
      ),
      RUNS
    );
  });

  it('attestations never shorten a hold or clear a prohibition', () => {
    fc.assert(
      fc.property(
        applicationsArb,
        subjectArb,
        msArb,
        zoneArb,
        fc.array(
          fc.record({
            i: fc.nat(4),
            graze: fc.option(daysArb, { nil: null }),
            hay: fc.option(daysArb, { nil: null })
          }),
          { maxLength: 4 }
        ),
        (apps, subject, atMs, zone, raw) => {
          const attestations: GrazingAttestationInput[] = raw.map((x, k) => ({
            id: `t${k}`,
            sprayEventRef: `spray:e${x.i}`,
            productPluginId: apps[x.i]?.productPluginId ?? null,
            grazeDays: x.graze,
            hayDays: x.hay
          }));
          const without = evaluateGrazing({ applications: apps, subject, atMs, timeZone: zone });
          const withAtt = evaluateGrazing({
            applications: apps,
            subject,
            atMs,
            timeZone: zone,
            attestations
          });
          without.findings.forEach((f, idx) => {
            const g = withAtt.findings[idx];
            if (f.reason === 'GRAZING_PROHIBITED') expect(g.reason).toBe('GRAZING_PROHIBITED');
            if (f.days !== null) expect(g.days!).toBeGreaterThanOrEqual(f.days);
            if (f.active && f.days !== null) expect(g.active).toBe(true);
          });
          const hayWithout = evaluateHayCut({ applications: apps, atMs, timeZone: zone });
          const hayWith = evaluateHayCut({
            applications: apps,
            atMs,
            timeZone: zone,
            attestations
          });
          hayWithout.findings.forEach((f, idx) => {
            if (f.days !== null) expect(hayWith.findings[idx].days!).toBeGreaterThanOrEqual(f.days);
          });
        }
      ),
      RUNS
    );
  });

  it('adding an application never turns a block into clear or brings the clear date forward', () => {
    fc.assert(
      fc.property(
        applicationsArb,
        applicationArb(9),
        subjectArb,
        msArb,
        zoneArb,
        (apps, extra, subject, atMs, zone) => {
          const before = evaluateGrazing({ applications: apps, subject, atMs, timeZone: zone });
          const after = evaluateGrazing({
            applications: [...apps, extra],
            subject,
            atMs,
            timeZone: zone
          });
          const rank = { clear: 0, warn: 1, block: 2 } as const;
          expect(rank[after.status]).toBeGreaterThanOrEqual(rank[before.status]);
          if (before.status !== 'clear' && before.clearsAtMs === null)
            expect(after.clearsAtMs).toBeNull();
          if (before.clearsAtMs !== null && after.clearsAtMs !== null) {
            expect(after.clearsAtMs).toBeGreaterThanOrEqual(before.clearsAtMs);
          }
        }
      ),
      RUNS
    );
  });

  it('a food animal is gated at least as hard as a pet', () => {
    fc.assert(
      fc.property(
        applicationsArb,
        msArb,
        zoneArb,
        fc.option(speciesArb, { nil: null }),
        (apps, atMs, zone, speciesId) => {
          const food = evaluateGrazing({
            applications: apps,
            subject: { speciesId, foodProducing: true },
            atMs,
            timeZone: zone
          });
          const pet = evaluateGrazing({
            applications: apps,
            subject: { speciesId, foodProducing: false },
            atMs,
            timeZone: zone
          });
          expect(food.findings.map((f) => f.active)).toEqual(pet.findings.map((f) => f.active));
          if (pet.status === 'warn') expect(food.status).toBe('block');
        }
      ),
      RUNS
    );
  });

  it('a farm copy of a shared plugin never shortens or clears the shared grazing data', () => {
    fc.assert(
      fc.property(
        fc.option(restrictionsArb, { nil: null }),
        fc.option(restrictionsArb, { nil: null }),
        (base, farm) => {
          const merged = farmCopyRestrictions(base, farm);
          if (base?.notForPasture === true || farm?.notForPasture === true) {
            expect(merged?.notForPasture).toBe(true);
          }
          if (!base) {
            if (merged) expect(merged.notForPasture).toBe(true);
            return;
          }
          expect(merged).not.toBeNull();
          for (const subject of [
            { speciesId: null, lactating: true },
            { speciesId: 'sheep', lactating: false },
            { speciesId: 'cattle', lactating: true },
            { speciesId: 'goat', lactating: undefined }
          ]) {
            const was = oracleGraze(base, { ...subject, foodProducing: true }).days;
            const now = oracleGraze(merged!, { ...subject, foodProducing: true }).days;
            if (was === 'unknown') expect(now).toBe('unknown');
            else if (now !== 'unknown') expect(now).toBeGreaterThanOrEqual(was);
          }
          const hayWas = labelHayDays(base);
          const hayNow = labelHayDays(merged!);
          if (hayWas === 'unknown') expect(hayNow).toBe('unknown');
          else expect(hayNow === 'unknown' || hayNow >= hayWas).toBe(true);
          const meatWas = base.meatAnimalRemovalBeforeSlaughterDays;
          const meatNow = merged!.meatAnimalRemovalBeforeSlaughterDays;
          if (meatWas === undefined) expect(meatNow).toBeUndefined();
          else expect(meatNow!).toBeGreaterThanOrEqual(meatWas);
        }
      ),
      RUNS
    );
  });

  it('a food animal is blocked at every instant inside a known label interval and clear after it', () => {
    const knownArb = fc
      .tuple(restrictionsArb, daysArb, daysArb)
      .map(([r, g, l]): GrazingRestrictions => {
        const out: GrazingRestrictions = {
          ...r,
          grazeDays: r.grazeDays ?? g,
          lactatingDairyGrazeDays: r.lactatingDairyGrazeDays ?? l
        };
        delete out.notForPasture;
        return out;
      });
    fc.assert(
      fc.property(
        knownArb,
        fc.option(speciesArb, { nil: null }),
        fc.option(fc.boolean(), { nil: undefined }),
        msArb,
        fc.integer({ min: 0, max: 450 * 24 }),
        zoneArb,
        (r, speciesId, lactating, applied, hoursAfter, zone) => {
          const subject: GrazingSubject = { speciesId, foodProducing: true, lactating };
          const want = oracleGraze(r, subject);
          if (want.days === 'unknown') return;
          const atMs = applied + hoursAfter * 3_600_000;
          const v = evaluateGrazing({
            applications: [
              {
                ref: 'spray:e0',
                source: 'spray',
                blockId: 'b1',
                appliedAtMs: applied,
                productPluginId: 'p1',
                productName: 'Product',
                restrictions: r
              }
            ],
            subject,
            atMs,
            timeZone: zone
          });
          const lastHeldDay = ymdInZone(applied + want.days * DAY_MS, zone);
          const inside = want.days > 0 && ymdInZone(atMs, zone) <= lastHeldDay;
          expect(v.status).toBe(inside ? 'block' : 'clear');
          if (inside) expect(v.reason).toBe('GRAZING_INTERVAL');
        }
      ),
      RUNS
    );
  });
});
