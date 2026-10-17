import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { PlantingRecord } from '$lib/db/blocks';
import type { BriefStorageGoal } from '$lib/garden/preserving';
import { eventsForPlanting, upcomingEvents } from './engine';
import {
  BRING_INDOORS_LEAD_DAYS,
  BRING_INDOORS_LEAD_PROVENANCE,
  RESTART_WINDOW_DAYS,
  bringIndoorsEvents,
  herbEventBody,
  herbEventTitle,
  herbTitleCrop,
  restartEvents,
  type HerbEventContext
} from './herbEvents';
import { isTypicalTimingEvent } from '$lib/schedule/typicalTiming';
import { frostSeasonShape } from '$lib/schedule/frostSeason';
import { parseMmDd } from '$lib/schedule/constants';

const DAY = 86_400_000;

const rosemary: CropPlugin = {
  pluginId: 'rosemary-tuscan-blue',
  type: 'crop',
  displayName: 'Rosemary — Tuscan Blue',
  version: '1.0.0',
  cropFamily: 'herb-culinary',
  harvestStyle: 'continuous-leaf',
  daysToMaturity: { min: 80, max: 90 }
} as CropPlugin;

const chervil: CropPlugin = {
  pluginId: 'chervil',
  type: 'crop',
  displayName: 'Chervil',
  version: '1.0.0',
  cropFamily: 'apiaceae',
  harvestStyle: 'continuous-leaf',
  agronomy: { lifecycle: 'annual' },
  daysToMaturity: { min: 40, max: 50 }
} as CropPlugin;

function planting(crop: CropPlugin, plantingDate: number, id = 'c1'): PlantingRecord {
  return {
    id,
    blockId: 'b1',
    cropPluginId: crop.pluginId,
    varietyDisplayName: crop.pluginId === 'chervil' ? 'Chervil' : 'Rosemary',
    plantingDate
  };
}

function ctx(
  lifecycle: HerbEventContext['lifecycle'],
  goals: BriefStorageGoal[] = [],
  frost: HerbEventContext['frost'] = { lastMmDd: '04-15', firstMmDd: '10-15' }
): HerbEventContext {
  return { lifecycle, goals: new Set(goals), frost };
}

describe('bring-indoors (R-8)', () => {
  const plant = Date.UTC(2026, 4, 1);

  it('opens 14 days before the first fall frost and runs to it, tagged fallback', () => {
    const events = eventsForPlanting(planting(rosemary, plant), rosemary, {
      now: plant,
      herb: ctx('tender-perennial')
    }).filter((e) => e.kind === 'bring-indoors');
    expect(events.map((e) => e.endMs)).toEqual([
      Date.UTC(2026, 9, 15),
      Date.UTC(2027, 9, 15),
      Date.UTC(2028, 9, 15)
    ]);
    const first = events[0];
    expect(BRING_INDOORS_LEAD_DAYS).toBe(14);
    expect(first.startMs).toBe(Date.UTC(2026, 9, 1));
    expect(first.detail).toMatchObject({
      herbEvent: 'bring-indoors',
      leadDays: 14,
      provenance: BRING_INDOORS_LEAD_PROVENANCE,
      typicalTiming: true
    });
    expect(BRING_INDOORS_LEAD_PROVENANCE).toBe('fallback');
    expect(isTypicalTimingEvent(first)).toBe(true);
    expect(first.title).toBe('Bring Rosemary indoors or take cuttings');
    expect(first.cropId).toBe('c1');
    expect(first.blockId).toBe('b1');
  });

  it('only for a tender perennial herb, and only when the caller passes the context', () => {
    const p = planting(rosemary, plant);
    for (const lifecycle of ['perennial-here', 'annual', 'biennial', 'unknown', null] as const) {
      expect(bringIndoorsEvents(p, ctx(lifecycle), [2026])).toEqual([]);
    }
    expect(
      eventsForPlanting(p, rosemary, { now: plant }).some((e) => e.kind === 'bring-indoors')
    ).toBe(false);
    const notHerb = { ...p, cropPluginId: 'tomato-cherokee-purple' };
    expect(bringIndoorsEvents(notHerb, ctx('tender-perennial'), [2026])).toEqual([]);
  });

  it('never opens before the planting date', () => {
    const late = planting(rosemary, Date.UTC(2026, 9, 10));
    const ev = bringIndoorsEvents(late, ctx('tender-perennial'), [2026, 2027]);
    expect(ev.map((e) => e.endMs)).toEqual([Date.UTC(2027, 9, 15)]);
  });

  it('a first fall frost in January belongs to the season before (fall-next-year)', () => {
    const frost = { lastMmDd: '02-10', firstMmDd: '01-20' };
    expect(frostSeasonShape(parseMmDd('02-10')!, parseMmDd('01-20')!)).toBe('fall-next-year');
    const ev = bringIndoorsEvents(
      planting(rosemary, plant),
      ctx('tender-perennial', [], frost),
      [2026]
    );
    expect(ev).toHaveLength(1);
    expect(ev[0].endMs).toBe(Date.UTC(2027, 0, 20));
    expect(ev[0].startMs).toBe(Date.UTC(2027, 0, 6));
  });

  it('a late-year spring frost keeps the fall frost in the season year (spring-prior-year)', () => {
    const frost = { lastMmDd: '12-20', firstMmDd: '11-30' };
    expect(frostSeasonShape(parseMmDd('12-20')!, parseMmDd('11-30')!)).toBe('spring-prior-year');
    const ev = bringIndoorsEvents(
      planting(rosemary, plant),
      ctx('tender-perennial', [], frost),
      [2026]
    );
    expect(ev.map((e) => [e.startMs, e.endMs])).toEqual([
      [Date.UTC(2026, 10, 16), Date.UTC(2026, 10, 30)]
    ]);
  });

  it('a missing frost date uses the calendar default', () => {
    const ev = bringIndoorsEvents(
      planting(rosemary, plant),
      ctx('tender-perennial', [], { lastMmDd: null, firstMmDd: null }),
      [2026]
    );
    expect(ev[0].endMs).toBe(Date.UTC(2026, 9, 15));
  });

  it('always ends on a first fall frost, 14 days after it opens, never before planting', () => {
    const mmdd = fc
      .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
      .map(([m, d]) => `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    fc.assert(
      fc.property(
        mmdd,
        mmdd,
        fc.integer({ min: 0, max: 700 }),
        fc.integer({ min: 2024, max: 2030 }),
        (last, first, offsetDays, year) => {
          const plantMs = Date.UTC(year, 0, 1) + offsetDays * DAY;
          const ev = bringIndoorsEvents(
            planting(rosemary, plantMs),
            ctx('tender-perennial', [], { lastMmDd: last, firstMmDd: first }),
            [year, year + 1, year + 2]
          );
          const [fm, fd] = first.split('-').map(Number);
          for (const e of ev) {
            const end = new Date(e.endMs);
            expect([end.getUTCMonth() + 1, end.getUTCDate()]).toEqual([fm, fd]);
            expect(e.endMs - e.startMs).toBe(14 * DAY);
            expect(e.startMs).toBeGreaterThanOrEqual(plantMs);
          }
          expect(new Set(ev.map((e) => e.endMs)).size).toBe(ev.length);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('reaches /today through upcomingEvents once the window is near', () => {
    const events = eventsForPlanting(planting(rosemary, plant), rosemary, {
      now: plant,
      herb: ctx('tender-perennial')
    });
    const near = upcomingEvents(events, 14, Date.UTC(2026, 8, 25));
    expect(near.some((e) => e.kind === 'bring-indoors')).toBe(true);
    const far = upcomingEvents(events, 14, Date.UTC(2026, 6, 1));
    expect(far.some((e) => e.kind === 'bring-indoors')).toBe(false);
  });
});

describe('restart for a fresh supply', () => {
  const plant = Date.UTC(2026, 4, 1);

  it('suggests sowing again at the family succession interval when the brief wants fresh', () => {
    const ev = eventsForPlanting(planting(chervil, plant), chervil, {
      now: plant,
      herb: ctx('annual', ['fresh', 'dry'])
    }).filter((e) => e.kind === 'restart');
    expect(ev).toHaveLength(1);
    expect(ev[0].startMs).toBe(plant + 14 * DAY);
    expect(ev[0].endMs).toBe(plant + (14 + RESTART_WINDOW_DAYS) * DAY);
    expect(ev[0].detail).toMatchObject({ herbEvent: 'restart', intervalDays: 14 });
    expect(isTypicalTimingEvent(ev[0])).toBe(true);
    expect(ev[0].title).toBe('Sow Chervil again');
  });

  it('nothing without the fresh goal, for a perennial, or for a crop that is not an herb', () => {
    const p = planting(chervil, plant);
    expect(restartEvents(p, chervil, ctx('annual', ['dry']))).toEqual([]);
    expect(restartEvents(p, chervil, ctx('perennial-here', ['fresh']))).toEqual([]);
    expect(restartEvents(p, chervil, ctx('unknown', ['fresh']))).toEqual([]);
    const lettuce = { ...p, cropPluginId: 'lettuce-x' };
    expect(restartEvents(lettuce, chervil, ctx('annual', ['fresh']))).toEqual([]);
    expect(
      restartEvents(p, { cropFamily: 'solanaceae' } as CropPlugin, ctx('annual', ['fresh']))
    ).toEqual([]);
  });

  it('nothing once the same herb was sown again in the bed', () => {
    const p = planting(chervil, plant);
    const later = planting(chervil, plant + 10 * DAY, 'c2');
    expect(restartEvents(p, chervil, ctx('annual', ['fresh']), [p, later])).toEqual([]);
    expect(restartEvents(later, chervil, ctx('annual', ['fresh']), [p, later])).toHaveLength(1);
  });

  it('nothing when sowing again would land on or after the first fall frost', () => {
    const p = planting(chervil, Date.UTC(2026, 9, 5));
    expect(restartEvents(p, chervil, ctx('annual', ['fresh']))).toEqual([]);
  });
});

describe('herb event text', () => {
  it('builds English without a locale and Spanish with one', () => {
    expect(herbEventTitle('bring-indoors', 'Rosemary')).toBe(
      'Bring Rosemary indoors or take cuttings'
    );
    expect(herbEventTitle('restart', 'Basil')).toBe('Sow Basil again');
    expect(herbEventTitle('restart', 'albahaca', 'es')).toBe('Siembre albahaca otra vez');
    expect(herbEventBody('bring-indoors', 'es')).not.toBe(herbEventBody('bring-indoors'));
    expect(herbTitleCrop('bring-indoors', 'Bring Lemon Verbena indoors or take cuttings')).toBe(
      'Lemon Verbena'
    );
    expect(herbTitleCrop('restart', 'Sow Dill again')).toBe('Dill');
    expect(herbTitleCrop('restart', 'Typed by the owner')).toBeNull();
  });
});
