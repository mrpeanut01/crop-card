import { describe, expect, it } from 'vitest';
import { waterBalance, windowBounds, WINDOW_HOURS, type WaterBalanceInput } from './waterBalance';
import {
  GALLONS_NO_SIZE_LINE,
  GAUGE_PARTIAL_LINE,
  GREENHOUSE_LINE,
  RAIN_UNKNOWN_LINE,
  inchesText,
  joinNames,
  wateringCard,
  waterDetail
} from './waterCopy';
import { SPRAY_WORDS } from '$lib/plugins/schemas';

const H = 3_600_000;
const NOW = Date.parse('2026-07-15T14:20:00Z');
const { startMs } = windowBounds(NOW);
const dry = Array.from({ length: WINDOW_HOURS }, (_, i) => ({ t: startMs + i * H, inches: 0 }));

function base(over: Partial<WaterBalanceInput> = {}): WaterBalanceInput {
  return {
    nowMs: NOW,
    areaKind: 'garden',
    areaSqFt: 400,
    target: { inches: 1, provenance: 'fallback' },
    station: { name: 'Leesburg Executive AP (KJYO)', distanceMi: 4 },
    stationRain: dry,
    gauges: [],
    logs: [],
    beds: [
      { id: 'b1', name: 'Bed 1', sqFt: 100, rainCover: null },
      { id: 'b4', name: 'Bed 4', sqFt: 100, rainCover: null }
    ],
    ...over
  };
}

function card(over: Partial<WaterBalanceInput> = {}, extra: { forecastIn?: number | null } = {}) {
  const balance = waterBalance(base(over));
  return wateringCard({
    fieldId: 'f1',
    areaName: 'Kitchen beds',
    balance,
    nearestStation: balance.station,
    forecastIn: extra.forecastIn ?? null,
    timeZone: 'America/New_York'
  });
}

function allText(c: ReturnType<typeof card>): string[] {
  return [c.title, ...c.lines, c.detail ?? '', ...c.actions.map((a) => a.label)];
}

describe('wateringCard copy', () => {
  it('says skip in the plan wording', () => {
    const wet = dry.map((h, i) => (i === 5 ? { ...h, inches: 1.3 } : h));
    const c = card({ stationRain: wet });
    expect(c.title).toBe('Skip watering the Kitchen beds today');
    expect(c.detail).toContain('Leesburg Executive AP (KJYO), 4 mi away');
    expect(c.provenance).toBe('data');
  });

  it('says water with the shortfall', () => {
    const c = card();
    expect(c.title).toBe('Water the Kitchen beds');
    expect(c.lines[0]).toBe('About 1 in short this week.');
    expect(c.tone).toBe('wheat');
  });

  it('names the far station and says rain unknown', () => {
    const c = card({ station: { name: 'Far AP (KFAR)', distanceMi: 25 } });
    expect(c.lines).toContain(RAIN_UNKNOWN_LINE);
    expect(c.detail).toContain('Far AP (KFAR), 25 mi away, too far to count');
    expect(c.provenance).toBe('fallback');
  });

  it('lists beds that disagree (E4-10)', () => {
    const c = card({
      logs: [{ occurredAtMs: NOW - H, blockId: 'b4', inches: 1, gallons: null, durationMin: null }]
    });
    expect(c.title).toBe('Watering the Kitchen beds');
    expect(c.lines[0]).toBe('Water Bed 1. About 1 in short this week.');
    expect(c.lines[1]).toBe('Bed 4: watered enough this week.');
  });

  it('adds covered beds as check by hand', () => {
    const c = card({
      beds: [
        { id: 'b1', name: 'Bed 1', sqFt: 100, rainCover: null },
        { id: 'b3', name: 'Bed 3', sqFt: 100, rainCover: 'high-tunnel' }
      ]
    });
    expect(c.lines.some((l) => l.startsWith('Check Bed 3 by hand.'))).toBe(true);
  });

  it('says when watering had no amount', () => {
    const c = card({
      logs: [
        {
          occurredAtMs: Date.parse('2026-07-14T13:00:00Z'),
          blockId: null,
          inches: null,
          gallons: null,
          durationMin: 20
        }
      ]
    });
    expect(c.lines[0]).toBe('You watered Tue, amount not logged.');
  });

  it('says gallons need a size instead of "amount not logged"', () => {
    const c = card({
      areaSqFt: null,
      logs: [
        {
          occurredAtMs: Date.parse('2026-07-14T13:00:00Z'),
          blockId: null,
          inches: null,
          gallons: 40,
          durationMin: null
        }
      ]
    });
    expect(c.lines).toEqual(expect.arrayContaining(['You watered Tue.', GALLONS_NO_SIZE_LINE]));
    expect(allText(c).join(' ')).not.toContain('amount not logged');
  });

  it('never states a partial rain total as the week', () => {
    const c = card({
      station: { name: 'Far AP (KFAR)', distanceMi: 25 },
      gauges: [{ fromMs: NOW - 24 * H, toMs: NOW, inches: 1.5 }]
    });
    const text = allText(c).join(' ');
    expect(text).not.toContain('Rain in the last 7 days');
    expect(text).not.toContain(RAIN_UNKNOWN_LINE);
    expect(c.title).toBe('Kitchen beds: rain only partly known');
    expect(c.lines).toContain(GAUGE_PARTIAL_LINE);
    expect(c.lines).toContain('Rain known for only 1 day of the last 7: at least 1.5 in.');
  });

  it('states the week total once rain is trusted', () => {
    const wet = dry.map((h, i) => (i === 5 ? { ...h, inches: 1.3 } : h));
    expect(card({ stationRain: wet }).lines).toContain('Rain in the last 7 days: about 1.3 in.');
  });

  it('shows forecast rain as display only', () => {
    const c = card({}, { forecastIn: 0.4 });
    expect(c.lines).toContain('Rain forecast: about 0.4 in over the next 24 hours (NWS).');
    expect(c.title).toBe('Water the Kitchen beds');
  });

  it('marks gauge rain as manual and says so', () => {
    const c = card({
      station: null,
      stationRain: [],
      gauges: [{ fromMs: startMs - H, toMs: NOW, inches: 1.2 }]
    });
    expect(c.provenance).toBe('manual');
    expect(c.detail).toContain('Rain from your gauge');
  });

  it('never mentions spraying in any rendered string', () => {
    const variants = [
      card(),
      card({ station: null, stationRain: [] }),
      card({ areaKind: 'greenhouse' }),
      card({ target: null }),
      card({
        logs: [{ occurredAtMs: NOW, blockId: null, inches: null, gallons: 5, durationMin: 5 }]
      }),
      card({ beds: [{ id: 'b', name: 'Bed 9', sqFt: 1, rainCover: 'cloche' }] })
    ];
    for (const v of variants) for (const t of allText(v)) expect(t).not.toMatch(SPRAY_WORDS);
    expect(GREENHOUSE_LINE).not.toMatch(SPRAY_WORDS);
  });

  it('never uses an em dash', () => {
    for (const t of allText(card())) expect(t).not.toContain('—');
  });
});

describe('helpers', () => {
  it('formats inches and names', () => {
    expect(inchesText(0.62)).toBe('0.6 in');
    expect(inchesText(1)).toBe('1 in');
    expect(inchesText(0.02)).toBe('<0.1 in');
    expect(joinNames(['Bed 1', 'Bed 2', 'Bed 4'])).toBe('Bed 1, Bed 2 and Bed 4');
  });

  it('asks for a location when there is none', () => {
    const balance = waterBalance(base({ station: null, stationRain: [] }));
    expect(
      waterDetail({
        fieldId: 'f',
        areaName: 'A',
        balance,
        nearestStation: null,
        forecastIn: null,
        timeZone: 'UTC',
        noLocation: true
      })
    ).toContain('Set the farm location');
  });
});
