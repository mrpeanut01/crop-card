import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { waterBalance, windowBounds, WINDOW_HOURS, type WaterBalanceInput } from './waterBalance';
import {
  needLines,
  runWhenText,
  shortCropName,
  wateringCard,
  type TimerCardInfo
} from './waterCopy';
import { POT_HEAT_HIGH_F, POT_HEAT_LOW_F, potHeatApplies } from './waterSources';
import type { RainHour } from './metarRain';

const H = 3_600_000;
const NOW = Date.parse('2026-07-15T14:20:00Z');
const TZ = 'America/New_York';
const { startMs } = windowBounds(NOW);

function rain(total: number): RainHour[] {
  return Array.from({ length: WINDOW_HOURS }, (_, i) => ({
    t: startMs + i * H,
    inches: i === 0 ? total : 0
  }));
}

function balance(over: Partial<WaterBalanceInput> = {}) {
  return waterBalance({
    nowMs: NOW,
    areaKind: 'garden',
    areaSqFt: 400,
    target: { inches: 1, provenance: 'fallback' },
    station: { name: 'Leesburg Executive AP (KJYO)', distanceMi: 4 },
    stationRain: rain(0),
    gauges: [],
    logs: [],
    beds: [{ id: 'b1', name: 'Bed 1', sqFt: 100, rainCover: null }],
    ...over
  });
}

const timer = (over: Partial<TimerCardInfo> = {}): TimerCardInfo => ({
  equipmentId: 'eq-1',
  label: 'Drip timer',
  minutes: 20,
  nextRunAt: Date.parse('2026-07-16T10:00:00Z'),
  inchesPerRun: 0.4,
  lastRunAt: null,
  bedIds: null,
  ...over
});

function card(b: ReturnType<typeof balance>, extra: Record<string, unknown> = {}) {
  return wateringCard({
    fieldId: 'f1',
    areaName: 'Herb garden',
    balance: b,
    nearestStation: b.station,
    forecastIn: null,
    timeZone: TZ,
    nowMs: NOW,
    ...extra
  });
}

describe('water need words (R-10)', () => {
  it('reads "Check the soil first: thyme likes it dry" on a dry-loving bed told to water', () => {
    const b = balance({
      beds: [
        {
          id: 'b1',
          name: 'Bed 1',
          sqFt: 100,
          rainCover: null,
          needLine: 'low',
          needCropPluginIds: ['thyme-english']
        }
      ]
    });
    const c = card(b, { cropNames: { 'thyme-english': 'Thyme — English' } });
    expect(c.title).toBe('Water the Herb garden');
    expect(c.lines).toContain('Check the soil first: thyme likes it dry.');
  });

  it('names the bed when the Area has several, and says mixed needs', () => {
    const b = balance({
      beds: [
        {
          id: 'b1',
          name: 'Bed 1',
          sqFt: 100,
          rainCover: null,
          needLine: 'low',
          needCropPluginIds: ['sage', 'thyme']
        },
        {
          id: 'b2',
          name: 'Bed 2',
          sqFt: 100,
          rainCover: null,
          needLine: 'mixed',
          needCropPluginIds: ['basil']
        }
      ]
    });
    const lines = needLines(b.perBed, { sage: 'Sage', thyme: 'Thyme' });
    expect(lines).toEqual([
      'Bed 1: check the soil first, sage and thyme like it dry.',
      'Bed 2 has plants with different water needs; this goes by the one that needs the most.'
    ]);
    expect(needLines(b.perBed, { sage: 'Sage', thyme: 'Thyme' }, 'es')[0]).toBe(
      'Bed 1: revisa la tierra primero, a sage y thyme les gusta seca.'
    );
  });

  it('shows the need words for a bed with enough water', () => {
    const b = balance({
      stationRain: rain(1.5),
      beds: [
        {
          id: 'b1',
          name: 'Bed 1',
          sqFt: 100,
          rainCover: null,
          needLine: 'high',
          needCropPluginIds: ['basil']
        }
      ]
    });
    expect(needLines(b.perBed, { basil: 'Basil — Genovese' })).toEqual([
      'Bed 1 likes moist soil (basil).'
    ]);
  });

  it('adds nothing when no crop has a sourced need', () => {
    expect(needLines(balance().perBed)).toEqual([]);
  });

  it('shortens crop names and keeps Spanish names', () => {
    expect(shortCropName('basil-genovese', { 'basil-genovese': 'Basil — Genovese' })).toBe('basil');
  });
});

describe('indoor pots (R-11)', () => {
  it('says check the soil instead of rain math', () => {
    const c = card(balance({ indoors: true }));
    expect(c.title).toBe('Herb garden');
    expect(c.lines).toEqual(["Rain doesn't reach indoor pots. Check the soil."]);
  });
});

describe('automatic waterer lines', () => {
  it('says skip it when the week already has enough', () => {
    const b = balance({ stationRain: rain(1.1) });
    const c = card(b, { timers: [timer()], canRecord: true });
    expect(c.lines).toContain(
      'Drip timer gives 0.4 in tomorrow at 6:00 AM; the week is at 1.1 in already, skip it.'
    );
    const skip = c.actions.find((a) => a.kind === 'skip-run');
    expect(skip).toMatchObject({
      equipmentId: 'eq-1',
      scheduledAt: Date.parse('2026-07-16T10:00:00Z'),
      reason: 'turned-off-for-rain'
    });
  });

  it('gives the next run, and no skip button for an inspector', () => {
    const c = card(balance(), { timers: [timer()], canRecord: false });
    expect(c.lines).toContain('Drip timer gives 0.4 in tomorrow at 6:00 AM.');
    expect(c.actions.some((a) => a.kind === 'skip-run')).toBe(false);
  });

  it('pushes the owner to type inches per run, and offers "It didn\'t run"', () => {
    const c = card(balance(), {
      timers: [timer({ inchesPerRun: null, lastRunAt: Date.parse('2026-07-15T10:00:00Z') })],
      canRecord: true,
      canEditTimers: true
    });
    expect(c.lines).toContain('Drip timer runs tomorrow at 6:00 AM for 20 min.');
    expect(c.actions.map((a) => a.label)).toEqual(
      expect.arrayContaining(["Drip timer didn't run Wed", 'Set Drip timer inches per run'])
    );
    const didNot = c.actions.find((a) => a.label === "Drip timer didn't run Wed");
    expect(didNot).toMatchObject({ kind: 'skip-run', reason: 'did-not-run' });
  });

  it('only counts the beds the timer waters', () => {
    const b = balance({
      stationRain: rain(0.2),
      logs: [{ occurredAtMs: NOW - H, blockId: 'b1', inches: 1, gallons: null, durationMin: null }],
      beds: [
        { id: 'b1', name: 'Bed 1', sqFt: 100, rainCover: null },
        { id: 'b2', name: 'Bed 2', sqFt: 100, rainCover: null }
      ]
    });
    const onB1 = card(b, { timers: [timer({ bedIds: ['b1'] })] });
    expect(onB1.lines.join(' ')).toContain('skip it');
    const onB2 = card(b, { timers: [timer({ bedIds: ['b2'] })] });
    expect(onB2.lines.join(' ')).not.toContain('skip it');
  });

  it('writes the run time in Spanish', () => {
    expect(runWhenText(Date.parse('2026-07-16T10:00:00Z'), NOW, TZ, 'es')).toMatch(
      /^mañana a las /
    );
    expect(runWhenText(Date.parse('2026-07-18T10:00:00Z'), NOW, TZ)).toBe('Sat at 6:00 AM');
  });
});

describe('the pots-in-heat line (R-11)', () => {
  it('needs both sourced thresholds; it never shows while either is missing', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -40, max: 130, noNaN: true }),
        fc.double({ min: -40, max: 130, noNaN: true }),
        (highF, lowF) => {
          expect(potHeatApplies({ highF, lowF }, { highF: null, lowF: 70 })).toBe(false);
          expect(potHeatApplies({ highF, lowF }, { highF: 90, lowF: null })).toBe(false);
          if (POT_HEAT_HIGH_F === null || POT_HEAT_LOW_F === null) {
            expect(potHeatApplies({ highF, lowF })).toBe(false);
          }
        }
      )
    );
  });

  it('applies when the day and the night are both above the thresholds', () => {
    const th = { highF: 90, lowF: 70 };
    expect(potHeatApplies({ highF: 95, lowF: 72 }, th)).toBe(true);
    expect(potHeatApplies({ highF: 95, lowF: 65 }, th)).toBe(false);
    expect(potHeatApplies({ highF: 90, lowF: 75 }, th)).toBe(false);
  });

  it('adds the line only when the card is told to', () => {
    expect(card(balance(), { potHeat: true }).lines).toContain(
      'Hot day and warm night ahead: check the pots today.'
    );
    expect(card(balance()).lines.join(' ')).not.toContain('pots');
  });
});
