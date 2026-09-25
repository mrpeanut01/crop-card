import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  aggregatePollinatorData,
  checkPollinatorProtection,
  isDaylight,
  pollinatorDataFor,
  pollinatorViolations,
  type BeeToxicity,
  type BloomRestriction,
  type BloomStatus,
  type PollinatorCheckStatus,
  type PollinatorData,
  type PollinatorProtectionInput
} from './pollinatorProtection';
import type { SunTimes } from './sunTimes';

const SUN: SunTimes = {
  sunrise: new Date('2026-06-21T09:45:00Z'),
  sunset: new Date('2026-06-22T00:40:00Z')
};
const NOON = new Date('2026-06-21T16:00:00Z');
const NIGHT = new Date('2026-06-22T02:00:00Z');
const LATE_NIGHT = new Date('2026-06-22T08:30:00Z');

const NEONIC: PollinatorData = {
  beeToxicity: 'highly-toxic',
  bloomRestriction: 'prohibited-during-bloom'
};
const PYRETHROID: PollinatorData = {
  beeToxicity: 'highly-toxic',
  bloomRestriction: 'dusk-to-dawn-only'
};
const SPINOSAD: PollinatorData = {
  beeToxicity: 'highly-toxic',
  bloomRestriction: 'dusk-to-dawn-only',
  residualToxicityHours: 3
};
const BT: PollinatorData = { beeToxicity: 'relatively-nontoxic', bloomRestriction: 'none' };
const HT_NONE: PollinatorData = { beeToxicity: 'highly-toxic', bloomRestriction: 'none' };

function run(
  pollinator: PollinatorData | undefined,
  bloomStatus: BloomStatus,
  applicationTime: Date,
  extra: Partial<PollinatorProtectionInput> = {}
) {
  return checkPollinatorProtection({
    products: [{ pluginId: 'p', pollinator }],
    bloomStatus,
    applicationTime,
    sunTimes: SUN,
    ...extra
  });
}

function check(r: ReturnType<typeof run>, id: string) {
  return r.checks.find((c) => c.id === id)!;
}

describe('checkPollinatorProtection — label bloom prohibition', () => {
  it('blocks a prohibited-during-bloom product on an in-bloom block', () => {
    const r = run(NEONIC, 'in-bloom', NIGHT);
    expect(r.overall).toBe('block');
    expect(check(r, 'bloom').status).toBe('block');
  });

  it('blocks until bloom status is attested', () => {
    const r = run(NEONIC, 'unknown', NIGHT);
    expect(r.overall).toBe('block');
    expect(check(r, 'bloom').reason).toMatch(/attest bloom status/);
  });

  it('passes the bloom check when the operator attests no bloom', () => {
    const r = run(NEONIC, 'not-in-bloom', NOON);
    expect(check(r, 'bloom').status).toBe('pass');
    expect(r.overall).toBe('pass');
  });

  it('attestedNoForagers never lifts a bloom prohibition', () => {
    const r = run(NEONIC, 'in-bloom', NIGHT, { attestedNoForagers: true });
    expect(r.overall).toBe('block');
  });
});

describe('checkPollinatorProtection — dusk-to-dawn', () => {
  it('blocks in daylight while in bloom', () => {
    const r = run(PYRETHROID, 'in-bloom', NOON);
    expect(check(r, 'time-of-day').status).toBe('block');
    expect(r.overall).toBe('block');
  });

  it('blocks in daylight when bloom is unknown', () => {
    expect(run(PYRETHROID, 'unknown', NOON).overall).toBe('block');
  });

  it('allows after sunset (warns on bee toxicity)', () => {
    const r = run(PYRETHROID, 'in-bloom', NIGHT);
    expect(check(r, 'time-of-day').status).toBe('pass');
    expect(check(r, 'bee-toxicity').status).toBe('warn');
    expect(r.overall).toBe('warn');
  });

  it('does not restrict time of day when the block is not in bloom', () => {
    expect(run(PYRETHROID, 'not-in-bloom', NOON).overall).toBe('pass');
  });

  it('sunset boundary: exactly at sunset is night, exactly at sunrise is day', () => {
    expect(check(run(PYRETHROID, 'in-bloom', SUN.sunset), 'time-of-day').status).toBe('pass');
    expect(check(run(PYRETHROID, 'in-bloom', SUN.sunrise), 'time-of-day').status).toBe('block');
  });

  it('missing sun times → block until the operator attests no foragers, then warn', () => {
    expect(run(PYRETHROID, 'in-bloom', NOON, { sunTimes: null }).overall).toBe('block');
    const attested = run(PYRETHROID, 'in-bloom', NOON, {
      sunTimes: null,
      attestedNoForagers: true
    });
    expect(check(attested, 'time-of-day').status).toBe('warn');
    expect(attested.overall).toBe('warn');
  });
});

describe('checkPollinatorProtection — toxicity-only + residual', () => {
  it('highly toxic with no label restriction only warns in bloom', () => {
    const r = run(HT_NONE, 'in-bloom', NOON);
    expect(r.overall).toBe('warn');
    expect(r.checks.every((c) => c.status !== 'block')).toBe(true);
  });

  it('relatively-nontoxic passes every check even in daylight bloom', () => {
    const r = run(BT, 'in-bloom', NOON);
    expect(r.overall).toBe('pass');
    expect(run(BT, 'unknown', NOON, { sunTimes: null }).overall).toBe('pass');
  });

  it('missing plugin data with no/unknown legacy risk is treated as bloom-prohibited', () => {
    const r = run(undefined, 'in-bloom', NIGHT);
    expect(r.effective).toEqual({
      beeToxicity: 'unknown',
      bloomRestriction: 'prohibited-during-bloom'
    });
    expect(r.overall).toBe('block');
    expect(run(undefined, 'not-in-bloom', NOON).overall).toBe('pass');
  });

  it('missing plugin data with a legacy low/none risk only warns in bloom', () => {
    for (const pollinatorRisk of ['low', 'none'] as const) {
      const r = checkPollinatorProtection({
        products: [{ pluginId: 'p', pollinatorRisk }],
        bloomStatus: 'in-bloom',
        applicationTime: NOON,
        sunTimes: SUN
      });
      expect(r.effective.beeToxicity).toBe('unknown');
      expect(r.overall).toBe('warn');
    }
  });

  it('declared pollinator data wins over the legacy risk hint', () => {
    expect(pollinatorDataFor({ pluginId: 'p', pollinator: BT, pollinatorRisk: 'high' })).toEqual(
      BT
    );
    expect(pollinatorDataFor({ pluginId: 'p', pollinatorRisk: 'moderate' }).bloomRestriction).toBe(
      'prohibited-during-bloom'
    );
  });

  it('warns when residue outlasts the time left before sunrise', () => {
    const r = run(SPINOSAD, 'in-bloom', LATE_NIGHT);
    expect(check(r, 'residual').status).toBe('warn');
    expect(check(run(SPINOSAD, 'in-bloom', NIGHT), 'residual').status).toBe('pass');
  });

  it('residual check is skipped when not in bloom and warns without sun times', () => {
    expect(check(run(SPINOSAD, 'not-in-bloom', LATE_NIGHT), 'residual').status).toBe('pass');
    expect(
      check(
        run(SPINOSAD, 'in-bloom', NIGHT, { sunTimes: null, attestedNoForagers: true }),
        'residual'
      ).status
    ).toBe('warn');
  });

  it('always emits the four checks in a stable order', () => {
    expect(run(BT, 'unknown', NOON).checks.map((c) => c.id)).toEqual([
      'bee-toxicity',
      'bloom',
      'time-of-day',
      'residual'
    ]);
  });
});

describe('aggregatePollinatorData', () => {
  it('takes the worst toxicity, strictest restriction and longest residual', () => {
    expect(
      aggregatePollinatorData([
        { pluginId: 'a', pollinator: BT },
        { pluginId: 'b', pollinator: SPINOSAD },
        { pluginId: 'c', pollinator: NEONIC }
      ])
    ).toEqual({
      beeToxicity: 'highly-toxic',
      bloomRestriction: 'prohibited-during-bloom',
      residualToxicityHours: 3
    });
  });

  it('an empty tank is unknown', () => {
    expect(aggregatePollinatorData([]).beeToxicity).toBe('unknown');
  });
});

describe('pollinatorViolations', () => {
  it('emits one POLLINATOR_BLOCK carrying every check when blocked', () => {
    const v = pollinatorViolations(run(NEONIC, 'in-bloom', NOON));
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe('POLLINATOR_BLOCK');
    expect((v[0].detail?.checks as unknown[]).length).toBe(4);
  });

  it('is empty for warn and pass', () => {
    expect(pollinatorViolations(run(HT_NONE, 'in-bloom', NOON))).toEqual([]);
    expect(pollinatorViolations(run(BT, 'in-bloom', NOON))).toEqual([]);
  });
});

// ─── Property tests ───────────────────────────────────────────────────

const TOX: BeeToxicity[] = ['relatively-nontoxic', 'toxic', 'unknown', 'highly-toxic'];
const RESTR: BloomRestriction[] = ['none', 'dusk-to-dawn-only', 'prohibited-during-bloom'];
const BLOOM: BloomStatus[] = ['not-in-bloom', 'unknown', 'in-bloom'];
const RANK: Record<PollinatorCheckStatus, number> = { pass: 0, warn: 1, block: 2 };

const arbTime = fc
  .integer({
    min: SUN.sunrise.getTime() - 12 * 3_600_000,
    max: SUN.sunset.getTime() + 12 * 3_600_000
  })
  .map((t) => new Date(t));
const arbSun = fc.option(fc.constant(SUN), { nil: null });
const arbData = fc.record(
  {
    beeToxicity: fc.constantFrom(...TOX),
    bloomRestriction: fc.constantFrom(...RESTR),
    residualToxicityHours: fc.integer({ min: 0, max: 48 })
  },
  { requiredKeys: ['beeToxicity', 'bloomRestriction'] }
);
const arbInput = fc.record({
  data: arbData,
  bloom: fc.constantFrom(...BLOOM),
  at: arbTime,
  sun: arbSun,
  attested: fc.boolean()
});

function evaluate(i: {
  data: PollinatorData;
  bloom: BloomStatus;
  at: Date;
  sun: SunTimes | null;
  attested: boolean;
}) {
  return checkPollinatorProtection({
    products: [{ pluginId: 'p', pollinator: i.data }],
    bloomStatus: i.bloom,
    applicationTime: i.at,
    sunTimes: i.sun,
    attestedNoForagers: i.attested
  });
}

describe('checkPollinatorProtection — properties', () => {
  it('prohibited-during-bloom + in-bloom always blocks, at any time, for any toxicity', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        const r = evaluate({
          ...i,
          bloom: 'in-bloom',
          data: { ...i.data, bloomRestriction: 'prohibited-during-bloom' }
        });
        expect(r.overall).toBe('block');
      })
    );
  });

  it('prohibited-during-bloom with unattested bloom always blocks', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        const r = evaluate({
          ...i,
          bloom: 'unknown',
          data: { ...i.data, bloomRestriction: 'prohibited-during-bloom' }
        });
        expect(r.overall).toBe('block');
      })
    );
  });

  it('relatively-nontoxic with no restriction never blocks', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        const r = evaluate({
          ...i,
          data: { ...i.data, beeToxicity: 'relatively-nontoxic', bloomRestriction: 'none' }
        });
        expect(r.overall).not.toBe('block');
      })
    );
  });

  it('no label restriction never blocks (toxicity alone only warns)', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        expect(evaluate({ ...i, data: { ...i.data, bloomRestriction: 'none' } }).overall).not.toBe(
          'block'
        );
      })
    );
  });

  it('dusk-to-dawn-only in bloom (known sun times) blocks iff the time is in daylight', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        const r = evaluate({
          ...i,
          bloom: 'in-bloom',
          sun: SUN,
          data: { ...i.data, bloomRestriction: 'dusk-to-dawn-only' }
        });
        expect(r.overall === 'block').toBe(isDaylight(i.at, SUN));
      })
    );
  });

  it('not-in-bloom never blocks', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        expect(evaluate({ ...i, bloom: 'not-in-bloom' }).overall).not.toBe('block');
      })
    );
  });

  it('monotonic: a worse toxicity, stricter restriction, or longer residual never lowers the verdict', () => {
    fc.assert(
      fc.property(
        arbInput,
        fc.constantFrom(...TOX),
        fc.constantFrom(...RESTR),
        fc.integer({ min: 0, max: 48 }),
        (i, tox2, restr2, extraResidual) => {
          const base = evaluate(i);
          const worse: PollinatorData = {
            beeToxicity:
              TOX.indexOf(tox2) > TOX.indexOf(i.data.beeToxicity) ? tox2 : i.data.beeToxicity,
            bloomRestriction:
              RESTR.indexOf(restr2) > RESTR.indexOf(i.data.bloomRestriction)
                ? restr2
                : i.data.bloomRestriction,
            residualToxicityHours:
              i.data.residualToxicityHours === undefined
                ? undefined
                : i.data.residualToxicityHours + extraResidual
          };
          const r = evaluate({ ...i, data: worse });
          expect(RANK[r.overall]).toBeGreaterThanOrEqual(RANK[base.overall]);
        }
      )
    );
  });

  it('monotonic: moving from not-in-bloom to in-bloom never lowers the verdict', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        const off = evaluate({ ...i, bloom: 'not-in-bloom' });
        const on = evaluate({ ...i, bloom: 'in-bloom' });
        expect(RANK[on.overall]).toBeGreaterThanOrEqual(RANK[off.overall]);
      })
    );
  });

  it('adding a product to the tank never lowers the verdict', () => {
    fc.assert(
      fc.property(arbInput, arbData, (i, other) => {
        const single = evaluate(i);
        const mix = checkPollinatorProtection({
          products: [
            { pluginId: 'p', pollinator: i.data },
            { pluginId: 'q', pollinator: other }
          ],
          bloomStatus: i.bloom,
          applicationTime: i.at,
          sunTimes: i.sun,
          attestedNoForagers: i.attested
        });
        expect(RANK[mix.overall]).toBeGreaterThanOrEqual(RANK[single.overall]);
      })
    );
  });

  it('overall is the worst per-check status and a block always yields a violation', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        const r = evaluate(i);
        const worst = Math.max(...r.checks.map((c) => RANK[c.status]));
        expect(RANK[r.overall]).toBe(worst);
        expect(pollinatorViolations(r).length > 0).toBe(r.overall === 'block');
      })
    );
  });
});
