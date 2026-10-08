import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  WINDOW_HOURS,
  gaugeCountsFrom,
  gaugePeriods,
  logInches,
  summarizeRain,
  waterBalance,
  windowBounds,
  type WaterBalanceInput
} from './waterBalance';
import type { RainHour } from './metarRain';

const H = 3_600_000;
const NOW = Date.parse('2026-07-15T14:20:00Z');
const { startMs, endMs } = windowBounds(NOW);

function stationHours(perHour: number | null, count = WINDOW_HOURS): RainHour[] {
  const out: RainHour[] = [];
  for (let i = 0; i < count; i++) out.push({ t: startMs + i * H, inches: perHour });
  return out;
}

function input(over: Partial<WaterBalanceInput> = {}): WaterBalanceInput {
  return {
    nowMs: NOW,
    areaKind: 'garden',
    areaSqFt: 400,
    target: { inches: 1, provenance: 'fallback' },
    station: { name: 'Leesburg Executive AP (KJYO)', distanceMi: 4 },
    stationRain: stationHours(0),
    gauges: [],
    logs: [],
    beds: [{ id: 'b1', name: 'Bed 1', sqFt: 100, rainCover: null }],
    ...over
  };
}

describe('window', () => {
  it('is the 168 whole hours ending with the current hour', () => {
    expect(endMs - startMs).toBe(WINDOW_HOURS * H);
    expect(endMs).toBe(Date.parse('2026-07-15T15:00:00Z'));
  });
});

describe('waterBalance verdicts', () => {
  it('says water with the shortfall when a near station saw a dry week', () => {
    const b = waterBalance(input());
    expect(b.verdict).toBe('water');
    expect(b.shortIn).toBe(1);
    expect(b.coveragePct).toBe(100);
    expect(b.rainSource).toBe('station');
  });

  it('says skip when rain alone meets the target', () => {
    const rain = stationHours(0);
    rain[10] = { t: rain[10].t, inches: 1.2 };
    const b = waterBalance(input({ stationRain: rain }));
    expect(b.verdict).toBe('skip');
    expect(b.rainIn).toBe(1.2);
  });

  it('says ok when rain plus logged watering meets the target', () => {
    const rain = stationHours(0);
    rain[3] = { t: rain[3].t, inches: 0.4 };
    const b = waterBalance(
      input({
        stationRain: rain,
        logs: [
          {
            occurredAtMs: NOW - 5 * H,
            blockId: null,
            inches: 0.7,
            gallons: null,
            durationMin: null
          }
        ]
      })
    );
    expect(b.verdict).toBe('ok');
  });

  it('is unknown when the only station is 25 miles away, even on a dry week', () => {
    const b = waterBalance(input({ station: { name: 'Far AP (KFAR)', distanceMi: 25 } }));
    expect(b.verdict).toBe('unknown');
    expect(b.reason).toBe('rain-unknown');
    expect(b.coveragePct).toBe(0);
    expect(b.station?.distanceMi).toBe(25);
  });

  it('counts logged watering with the rain known so far when rain is partial (#732)', () => {
    const far = { name: 'Far AP (KFAR)', distanceMi: 25 };
    const gauges = [{ fromMs: NOW - 24 * H, toMs: NOW, inches: 0.4 }];
    const log = (inches: number) => ({
      occurredAtMs: NOW - 2 * H,
      blockId: null,
      inches,
      gallons: null,
      durationMin: null
    });
    const short = waterBalance(input({ station: far, gauges, logs: [log(0.5)] }));
    expect(short.verdict).toBe('unknown');
    expect(short.reason).toBe('rain-unknown');
    expect(short.perBed[0].wateredIn).toBe(0.5);
    const enough = waterBalance(input({ station: far, gauges, logs: [log(0.6)] }));
    expect(enough.verdict).toBe('ok');
    const wateringAlone = waterBalance(input({ station: far, logs: [log(1)] }));
    expect(wateringAlone.verdict).toBe('ok');
  });

  it('is unknown when hourly coverage is under 90%', () => {
    const rain = stationHours(0).slice(0, 150);
    const b = waterBalance(input({ stationRain: rain }));
    expect(b.verdict).toBe('unknown');
    expect(b.coveragePct).toBeLessThan(90);
  });

  it('allows a verdict at exactly 90% coverage (152 of 168 hours)', () => {
    expect(waterBalance(input({ stationRain: stationHours(0).slice(0, 152) })).verdict).toBe(
      'water'
    );
    expect(waterBalance(input({ stationRain: stationHours(0).slice(0, 151) })).verdict).toBe(
      'unknown'
    );
  });

  it('never counts a gauge-out hour (null) as zero', () => {
    const b = waterBalance(input({ stationRain: stationHours(null) }));
    expect(b.verdict).toBe('unknown');
    expect(b.rainIn).toBeNull();
  });

  it('lets gauge readings stand in for a missing station', () => {
    const gauges = gaugePeriods([
      { readAtMs: startMs + 2 * H, inches: 0 },
      { readAtMs: NOW, inches: 1.4 }
    ]);
    const b = waterBalance(input({ station: null, stationRain: [], gauges }));
    expect(b.verdict).toBe('skip');
    expect(b.rainSource).toBe('gauge');
    expect(b.coveragePct).toBe(100);
  });

  it('prefers the gauge over the station inside the gauge period', () => {
    const rain = stationHours(0.05);
    const gauges = gaugePeriods([{ readAtMs: NOW, inches: 0 }]);
    const s = summarizeRain({ nowMs: NOW, station: input().station, stationRain: rain, gauges });
    expect(s.gaugeHours).toBeGreaterThanOrEqual(24);
    expect(s.gaugeHours + s.stationHours).toBe(WINDOW_HOURS);
    expect(s.inches).toBeCloseTo(0.05 * s.stationHours, 5);
  });

  it('is unknown for a greenhouse Area whatever the rain', () => {
    const b = waterBalance(input({ areaKind: 'greenhouse' }));
    expect(b.verdict).toBe('unknown');
    expect(b.reason).toBe('greenhouse');
    expect(b.perBed.every((x) => x.reason === 'greenhouse')).toBe(true);
  });

  it('lists a bed under plastic as check by hand and judges the others', () => {
    const b = waterBalance(
      input({
        beds: [
          { id: 'b1', name: 'Bed 1', sqFt: 100, rainCover: null },
          { id: 'b2', name: 'Bed 2', sqFt: 100, rainCover: 'low-tunnel' }
        ]
      })
    );
    expect(b.verdict).toBe('water');
    expect(b.perBed.find((x) => x.bedId === 'b2')?.reason).toBe('covered');
  });

  it('is unknown with no target', () => {
    const b = waterBalance(input({ target: null }));
    expect(b.verdict).toBe('unknown');
    expect(b.reason).toBe('no-target');
  });

  it('never says water while a watering with no amount is in the window', () => {
    const b = waterBalance(
      input({
        logs: [
          {
            occurredAtMs: NOW - 30 * H,
            blockId: null,
            inches: null,
            gallons: null,
            durationMin: 30
          }
        ]
      })
    );
    expect(b.verdict).toBe('unknown');
    expect(b.reason).toBe('amount-not-logged');
    expect(b.perBed[0].unknownLogAtMs).toBe(NOW - 30 * H);
  });

  it('still says skip when rain alone meets the target despite an unknown amount', () => {
    const rain = stationHours(0);
    rain[0] = { t: rain[0].t, inches: 1.5 };
    const b = waterBalance(
      input({
        stationRain: rain,
        logs: [
          { occurredAtMs: NOW - H, blockId: null, inches: null, gallons: null, durationMin: 20 }
        ]
      })
    );
    expect(b.verdict).toBe('skip');
  });

  it('judges each bed with its own logs (E4-10)', () => {
    const b = waterBalance(
      input({
        beds: [
          { id: 'b1', name: 'Bed 1', sqFt: 100, rainCover: null },
          { id: 'b4', name: 'Bed 4', sqFt: 100, rainCover: null }
        ],
        logs: [
          { occurredAtMs: NOW - H, blockId: 'b4', inches: 1, gallons: null, durationMin: null }
        ]
      })
    );
    expect(b.perBed.map((x) => x.verdict)).toEqual(['water', 'ok']);
    expect(b.verdict).toBe('water');
  });

  it('ignores logs outside the window or in the future', () => {
    const b = waterBalance(
      input({
        logs: [
          { occurredAtMs: startMs - H, blockId: null, inches: 2, gallons: null, durationMin: null },
          { occurredAtMs: NOW + H, blockId: null, inches: 2, gallons: null, durationMin: null }
        ]
      })
    );
    expect(b.verdict).toBe('water');
  });
});

describe('logInches', () => {
  it('turns gallons into inches over a known size', () => {
    const inches = logInches(
      { occurredAtMs: 0, blockId: 'b', inches: null, gallons: 62.3, durationMin: null },
      100
    );
    expect(inches).toBeCloseTo(1, 1);
  });

  it('has no amount for gallons over an unknown size or minutes alone', () => {
    expect(
      logInches(
        { occurredAtMs: 0, blockId: 'b', inches: null, gallons: 50, durationMin: null },
        null
      )
    ).toBeNull();
    expect(
      logInches(
        { occurredAtMs: 0, blockId: 'b', inches: null, gallons: null, durationMin: 30 },
        100
      )
    ).toBeNull();
  });
});

describe('gauge periods (E4-7)', () => {
  it('counts from the previous reading within 7 days, else the 24 hours before', () => {
    const p = gaugePeriods([
      { readAtMs: 100 * H, inches: 0.5 },
      { readAtMs: 130 * H, inches: 0.2 },
      { readAtMs: 400 * H, inches: 1 }
    ]);
    expect(p.map((x) => x.fromMs)).toEqual([76 * H, 100 * H, 376 * H]);
    expect(gaugeCountsFrom(130 * H, 150 * H)).toBe(130 * H);
    expect(gaugeCountsFrom(null, 150 * H)).toBe(126 * H);
    expect(gaugeCountsFrom(10 * H, 400 * H)).toBe(376 * H);
  });
});

describe('waterBalance properties', () => {
  const hour = fc.oneof(fc.constant(null), fc.double({ min: 0, max: 2, noNaN: true }));

  it('never says skip or water without 90% trusted coverage', () => {
    fc.assert(
      fc.property(
        fc.array(hour, { minLength: 0, maxLength: WINDOW_HOURS }),
        fc.double({ min: 0, max: 40, noNaN: true }),
        (vals, miles) => {
          const rain = vals.map((v, i) => ({ t: startMs + i * H, inches: v }));
          const b = waterBalance(
            input({ stationRain: rain, station: { name: 'S', distanceMi: miles } })
          );
          const known = miles <= 10 ? vals.filter((v) => v !== null).length : 0;
          if (known < 152) expect(b.verdict).toBe('unknown');
        }
      )
    );
  });

  it('with rain partly known, says ok exactly when known rain plus watering meets the target', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        (gaugeIn, wateredIn) => {
          const b = waterBalance(
            input({
              station: null,
              gauges: [{ fromMs: NOW - 24 * H, toMs: NOW, inches: gaugeIn }],
              logs: [
                {
                  occurredAtMs: NOW - H,
                  blockId: null,
                  inches: wateredIn,
                  gallons: null,
                  durationMin: null
                }
              ]
            })
          );
          const rain = b.rainIn ?? 0;
          const logged = b.perBed[0].wateredIn;
          if (logged > 0 && rain + logged >= 1) expect(b.verdict).toBe('ok');
          else expect(b.verdict).toBe('unknown');
          expect(['skip', 'water']).not.toContain(b.verdict);
        }
      )
    );
  });

  it('adding rain never turns skip or ok into water', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 0.2, noNaN: true }), {
          minLength: WINDOW_HOURS,
          maxLength: WINDOW_HOURS
        }),
        fc.integer({ min: 0, max: WINDOW_HOURS - 1 }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        (vals, idx, extra) => {
          const rain = vals.map((v, i) => ({ t: startMs + i * H, inches: v }));
          const before = waterBalance(input({ stationRain: rain })).verdict;
          const more = rain.map((h, i) => (i === idx ? { ...h, inches: h.inches! + extra } : h));
          const after = waterBalance(input({ stationRain: more })).verdict;
          if (before !== 'water') expect(after).not.toBe('water');
        }
      )
    );
  });
});
