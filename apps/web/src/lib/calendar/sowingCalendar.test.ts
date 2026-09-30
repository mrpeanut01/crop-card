import { describe, expect, it } from 'vitest';
import {
  buildSowingCalendar,
  rowNoteText,
  type SowingCalendarInput,
  type SowingPlantingIn
} from './sowingCalendar';

const DAY = 86_400_000;
const Y = 2026;
const FROM = Date.UTC(2026, 0, 1);
const TO = Date.UTC(2026, 11, 31);
const NOW = Date.UTC(2026, 5, 1);

function planting(over: Partial<SowingPlantingIn> = {}): SowingPlantingIn {
  return {
    id: 'c1',
    name: 'Tomato',
    blockId: 'b1',
    blockName: 'Bed 1',
    plantingDate: Date.UTC(2026, 4, 10),
    status: 'active',
    ...over
  };
}

function input(over: Partial<SowingCalendarInput> = {}): SowingCalendarInput {
  return {
    year: Y,
    now: NOW,
    fromMs: FROM,
    toMs: TO,
    plantings: [planting()],
    events: [],
    windows: {},
    frostByBlock: {},
    frostLines: [
      { kind: 'last-spring', ms: Date.UTC(2026, 3, 20), provenance: 'data' },
      { kind: 'first-fall', ms: Date.UTC(2026, 9, 15), provenance: 'manual' }
    ],
    latLon: null,
    ...over
  };
}

const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe('buildSowingCalendar', () => {
  it('keeps the planting order and one row per planting', () => {
    const cal = buildSowingCalendar(
      input({
        plantings: [planting({ id: 'b', name: 'B' }), planting({ id: 'a', name: 'A' })]
      })
    );
    expect(cal.rows.map((r) => r.plantingId)).toEqual(['b', 'a']);
  });

  it('turns indoor-sow and transplant events into bars; indoor solid only when recorded', () => {
    const t = Date.UTC(2026, 4, 10);
    const cal = buildSowingCalendar(
      input({
        events: [
          {
            kind: 'indoor-sow',
            cropId: 'c1',
            startMs: t - 42 * DAY,
            endMs: t,
            title: 'x',
            detail: { recorded: false }
          },
          { kind: 'transplant', cropId: 'c1', startMs: t, endMs: t, title: 'y' },
          { kind: 'harvest-window', cropId: 'c1', startMs: t, endMs: t + DAY, title: 'z' }
        ]
      })
    );
    const bars = cal.rows[0].bars;
    expect(bars.map((b) => b.kind)).toEqual(['indoor-sow', 'transplant']);
    expect(bars[0].recorded).toBe(false);
    expect(bars[1].recorded).toBe(true);
  });

  it('a planned in-ground date is not marked done', () => {
    const t = Date.UTC(2026, 6, 10);
    const cal = buildSowingCalendar(
      input({
        plantings: [planting({ plantingDate: t, status: 'planned' })],
        events: [{ kind: 'direct-sow', cropId: 'c1', startMs: t, endMs: t, title: 's' }]
      })
    );
    expect(cal.rows[0].bars[0].recorded).toBe(false);
  });

  it('an undated plan shows its window as a planned Window bar', () => {
    const cal = buildSowingCalendar(
      input({
        plantings: [planting({ plantingDate: null, status: 'planned' })],
        windows: { c1: { startMs: Date.UTC(2026, 3, 1), endMs: Date.UTC(2026, 5, 1) } }
      })
    );
    expect(cal.rows[0].bars).toEqual([
      expect.objectContaining({ kind: 'window', recorded: false, label: 'Window' })
    ]);
  });

  it('a dated planting ignores any window', () => {
    const cal = buildSowingCalendar(
      input({ windows: { c1: { startMs: FROM, endMs: FROM + DAY } } })
    );
    expect(cal.rows[0].bars).toEqual([]);
  });

  it('grows the range to hold every bar and every frost line', () => {
    const early = Date.UTC(2025, 10, 20);
    const cal = buildSowingCalendar(
      input({
        events: [
          {
            kind: 'indoor-sow',
            cropId: 'c1',
            startMs: early,
            endMs: Date.UTC(2026, 1, 1),
            title: 'x'
          }
        ],
        frostLines: [
          { kind: 'first-fall', ms: Date.UTC(2027, 1, 15), provenance: 'fallback' },
          { kind: 'last-spring', ms: Date.UTC(2026, 3, 20), provenance: 'data' }
        ]
      })
    );
    expect(cal.fromMs).toBe(early);
    expect(cal.toMs).toBe(Date.UTC(2027, 1, 15));
    expect(cal.frostLines.map((l) => l.kind)).toEqual(['last-spring', 'first-fall']);
  });

  it('no farm location gives no band', () => {
    expect(buildSowingCalendar(input()).shortDays).toEqual({ status: 'no-location' });
  });

  it('a Virginia farm gets a winter short-day band', () => {
    const cal = buildSowingCalendar(input({ latLon: { lat: 39.14, lon: -77.71 } }));
    expect(cal.shortDays.status).toBe('spans');
  });

  it('row notes: heated, covered, unknown shift, plain', () => {
    const base = {
      lastSpringFrostMs: Date.UTC(2026, 3, 2),
      firstFallFrostMs: Date.UTC(2026, 10, 1),
      springShiftDays: 0,
      fallShiftDays: 0
    };
    const cal = buildSowingCalendar(
      input({
        plantings: [
          planting({ id: 'h', blockId: 'bh' }),
          planting({ id: 'c', blockId: 'bc' }),
          planting({ id: 'u', blockId: 'bu' }),
          planting({ id: 'p', blockId: 'bp' })
        ],
        frostByBlock: {
          bh: { ...base, frostFree: true },
          bc: { ...base, frostFree: false, springShiftDays: 18 },
          bu: { ...base, frostFree: false, unknownShift: ['row-cover'] },
          bp: { ...base, frostFree: false }
        }
      })
    );
    const notes = cal.rows.map((r) => (r.note ? rowNoteText(r.note, date) : null));
    expect(notes).toEqual([
      'Heated: no frost',
      'Covered: frost from 2026-04-02',
      'Covered: shift not known',
      null
    ]);
  });

  it('covered note with both shifts names both dates', () => {
    expect(
      rowNoteText(
        { kind: 'covered', springMs: Date.UTC(2026, 3, 2), fallMs: Date.UTC(2026, 10, 1) },
        date
      )
    ).toBe('Covered: frost from 2026-04-02 to 2026-11-01');
    expect(
      rowNoteText({ kind: 'covered', springMs: null, fallMs: Date.UTC(2026, 10, 1) }, date)
    ).toBe('Covered: fall frost 2026-11-01');
  });

  it('copy has no em dashes', () => {
    const text = [
      rowNoteText({ kind: 'heated' }, date),
      rowNoteText({ kind: 'cover-unknown' }, date)
    ].join(' ');
    expect(text).not.toMatch(/—/);
  });
});
