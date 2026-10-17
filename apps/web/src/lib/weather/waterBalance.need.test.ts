import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  WINDOW_HOURS,
  waterBalance,
  windowBounds,
  type BedInput,
  type WaterBalanceInput,
  type WaterLog
} from './waterBalance';
import { bedNeed } from './waterNeed';
import type { RainHour } from './metarRain';

const H = 3_600_000;
const NOW = Date.parse('2026-07-15T14:20:00Z');
const { startMs } = windowBounds(NOW);

function rainHours(total: number, covered = WINDOW_HOURS): RainHour[] {
  const out: RainHour[] = [];
  for (let i = 0; i < covered; i++) {
    out.push({ t: startMs + i * H, inches: i === 0 ? total : 0 });
  }
  return out;
}

function input(over: Partial<WaterBalanceInput> = {}): WaterBalanceInput {
  return {
    nowMs: NOW,
    areaKind: 'garden',
    areaSqFt: 400,
    target: { inches: 1, provenance: 'fallback' },
    station: { name: 'Leesburg Executive AP (KJYO)', distanceMi: 4 },
    stationRain: rainHours(0),
    gauges: [],
    logs: [],
    beds: [{ id: 'b1', name: 'Bed 1', sqFt: 100, rainCover: null }],
    ...over
  };
}

const needs = fc.constantFrom('low', 'medium', 'high', 'mixed', null) as fc.Arbitrary<
  BedInput['needLine']
>;
const logs: fc.Arbitrary<WaterLog[]> = fc.array(
  fc.record({
    occurredAtMs: fc.integer({ min: startMs - 24 * H, max: NOW + 2 * H }),
    blockId: fc.constantFrom(null, 'b1'),
    inches: fc.option(fc.double({ min: 0, max: 2, noNaN: true }), { nil: null }),
    gallons: fc.option(fc.double({ min: 0, max: 200, noNaN: true }), { nil: null }),
    durationMin: fc.constant(null)
  }),
  { maxLength: 4 }
);

describe('a bed target and a water need never turn water into skip (R-10)', () => {
  it('holds over random rain, logs, needs and bed targets', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 3, noNaN: true }),
        fc.integer({ min: 120, max: WINDOW_HOURS }),
        logs,
        needs,
        fc.option(fc.double({ min: 0.1, max: 5, noNaN: true }), { nil: undefined }),
        (rain, covered, ls, need, bedTarget) => {
          const plain = waterBalance(input({ stationRain: rainHours(rain, covered), logs: ls }));
          const withNeed = waterBalance(
            input({
              stationRain: rainHours(rain, covered),
              logs: ls,
              beds: [
                {
                  id: 'b1',
                  name: 'Bed 1',
                  sqFt: 100,
                  rainCover: null,
                  needLine: need,
                  needCropPluginIds: ['thyme-english'],
                  ...(bedTarget !== undefined
                    ? { target: { inches: bedTarget, provenance: 'fallback' as const } }
                    : {})
                }
              ]
            })
          );
          if (plain.perBed[0].verdict === 'water') {
            expect(withNeed.perBed[0].verdict).not.toBe('skip');
          }
          if (bedTarget === undefined) {
            expect(withNeed.perBed[0].verdict).toBe(plain.perBed[0].verdict);
            expect(withNeed.perBed[0].shortIn).toBe(plain.perBed[0].shortIn);
          }
        }
      ),
      { numRuns: 400 }
    );
  });

  it('uses the Area target when the bed has none', () => {
    const b = waterBalance(input({ stationRain: rainHours(0.6) }));
    expect(b.perBed[0]).toMatchObject({ verdict: 'water', shortIn: 0.4 });
  });

  it('lets a lower bed target read ok but never skip on rain alone', () => {
    const b = waterBalance(
      input({
        stationRain: rainHours(0.6),
        beds: [
          {
            id: 'b1',
            name: 'Bed 1',
            sqFt: 100,
            rainCover: null,
            target: { inches: 0.5, provenance: 'fallback' }
          }
        ]
      })
    );
    expect(b.perBed[0].verdict).toBe('ok');
  });
});

describe('the need is words only', () => {
  it('marks check-soil-first on a dry-loving bed told to water', () => {
    const b = waterBalance(
      input({
        beds: [
          {
            id: 'b1',
            name: 'Bed 1',
            sqFt: 100,
            rainCover: null,
            needLine: 'low',
            needCropPluginIds: ['thyme']
          }
        ]
      })
    );
    expect(b.perBed[0]).toMatchObject({ verdict: 'water', checkSoilFirst: true, needLine: 'low' });
  });

  it('never marks it for a mixed bed or a bed that has enough', () => {
    const mixed = waterBalance(
      input({ beds: [{ id: 'b1', name: 'Bed 1', sqFt: 100, rainCover: null, needLine: 'mixed' }] })
    );
    expect(mixed.perBed[0].checkSoilFirst).toBe(false);
    const wet = waterBalance(
      input({
        stationRain: rainHours(1.5),
        beds: [{ id: 'b1', name: 'Bed 1', sqFt: 100, rainCover: null, needLine: 'low' }]
      })
    );
    expect(wet.perBed[0]).toMatchObject({ verdict: 'skip', checkSoilFirst: false });
  });
});

describe('bedNeed', () => {
  it('is the one need, or the highest with a mixed line, and unknown when any crop is', () => {
    expect(bedNeed([{ cropPluginId: 'thyme', waterNeed: 'low' }])).toEqual({
      line: 'low',
      level: 'low',
      cropPluginIds: ['thyme']
    });
    expect(
      bedNeed([
        { cropPluginId: 'thyme', waterNeed: 'low' },
        { cropPluginId: 'basil', waterNeed: 'high' }
      ])
    ).toEqual({ line: 'mixed', level: 'high', cropPluginIds: ['basil'] });
    expect(
      bedNeed([
        { cropPluginId: 'thyme', waterNeed: 'low' },
        { cropPluginId: 'mint', waterNeed: null }
      ]).line
    ).toBeNull();
    expect(bedNeed([]).line).toBeNull();
  });
});

describe('indoor Areas and timer runs', () => {
  it('reads an indoor Area unknown with the indoors reason, whatever the rain', () => {
    const b = waterBalance(input({ indoors: true, stationRain: rainHours(0) }));
    expect(b).toMatchObject({ verdict: 'unknown', reason: 'indoors' });
    expect(b.perBed[0]).toMatchObject({ verdict: 'unknown', reason: 'indoors' });
  });

  it('counts a timer run with inches, and names the timer when the amount is not known', () => {
    const run = (inches: number | null): WaterLog => ({
      occurredAtMs: NOW - 10 * H,
      blockId: null,
      inches,
      gallons: null,
      durationMin: 20,
      provenance: 'manual',
      timer: { equipmentId: 'eq', label: 'Drip timer' }
    });
    const known = waterBalance(input({ stationRain: rainHours(0.7), logs: [run(0.4)] }));
    expect(known.perBed[0]).toMatchObject({ verdict: 'ok', wateredIn: 0.4 });
    const unknown = waterBalance(input({ stationRain: rainHours(0.2), logs: [run(null)] }));
    expect(unknown.perBed[0]).toMatchObject({
      verdict: 'unknown',
      reason: 'amount-not-logged',
      unknownLogTimer: 'Drip timer'
    });
  });
});
