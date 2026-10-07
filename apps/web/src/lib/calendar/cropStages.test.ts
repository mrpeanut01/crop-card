import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { PlantingRecord } from '$lib/db/blocks';
import { eventsForPlanting, type CalendarEvent } from './engine';
import { harvestWindowFor, pickHarvestWindow } from './harvestWindow';
import { isTypicalTimingEvent } from '$lib/schedule/typicalTiming';
import { buildZadoksTimeline } from '$lib/plan/smallGrain';

const DAY = 86_400_000;
const PLUGIN_DIR = path.resolve(__dirname, '../../../../../plugins/crops');

function plugin(id: string): CropPlugin {
  return JSON.parse(readFileSync(path.join(PLUGIN_DIR, `${id}.json`), 'utf8')) as CropPlugin;
}

function planting(crop: CropPlugin, plantingDate: number, id = `p_${crop.pluginId}`) {
  return {
    id,
    blockId: 'b1',
    cropPluginId: crop.pluginId,
    varietyDisplayName: crop.displayName,
    plantingDate
  } satisfies PlantingRecord;
}

const of = (events: CalendarEvent[], kind: CalendarEvent['kind']) =>
  events.filter((e) => e.kind === kind);

describe('#617 cover crops and perennial forage', () => {
  const rye = plugin('cereal-rye-cover');
  const sown = Date.UTC(2025, 9, 3);

  it('never offers a cover crop as a harvest', () => {
    const events = eventsForPlanting(planting(rye, sown), rye);
    expect(of(events, 'harvest-window')).toEqual([]);
    expect(of(events, 'cover-termination')).toHaveLength(1);
  });

  it('keeps cover stages inside one season, unscaled by days to maturity', () => {
    const events = eventsForPlanting(planting(rye, sown), rye);
    const stages = of(events, 'stage-window');
    expect(stages.length).toBeGreaterThan(0);
    for (const s of stages) expect(s.endMs - sown).toBeLessThanOrEqual(195 * DAY + 1);
  });

  it('ends every cover stage before the next planting in the block', () => {
    const soy = { ...planting(rye, Date.UTC(2026, 4, 10), 'p_soy'), cropPluginId: 'soy' };
    const cover = planting(rye, sown);
    const events = eventsForPlanting(cover, rye, { blockPlantings: [cover, soy] });
    const term = of(events, 'cover-termination')[0];
    for (const s of of(events, 'stage-window')) expect(s.endMs).toBeLessThanOrEqual(term.endMs);
  });

  it('titles simple-system stages by name, not by id', () => {
    const titles = of(eventsForPlanting(planting(rye, sown), rye), 'stage-window').map(
      (e) => e.title
    );
    expect(titles).toContain('Termination window');
    expect(titles.some((t) => /^terminate —/.test(t))).toBe(false);
  });

  it('treats an archetype cover in another family as a cover crop', () => {
    const mustard = plugin('mustard-tillage-cover');
    const events = eventsForPlanting(planting(mustard, sown), mustard);
    expect(of(events, 'harvest-window')).toEqual([]);
    expect(of(events, 'cover-termination')).toHaveLength(1);
  });

  it('gives established perennial forage no day-from-planting stages or targets', () => {
    for (const id of ['orchard-grass-potomac', 'alfalfa-vernema']) {
      const crop = plugin(id);
      const events = eventsForPlanting(planting(crop, Date.UTC(2023, 5, 14)), crop, {
        now: Date.UTC(2026, 9, 7)
      });
      expect(of(events, 'stage-window'), id).toEqual([]);
      expect(of(events, 'harvest-window'), id).toEqual([]);
    }
  });
});

describe('#624 corn harvest by use', () => {
  it('gives field corn only the dry-storage target', () => {
    const corn = plugin('corn-feed-dent-pioneer');
    const sown = Date.UTC(2026, 4, 1);
    const windows = of(eventsForPlanting(planting(corn, sown), corn), 'harvest-window');
    expect(windows.map((w) => w.detail?.stageCode)).toEqual(['R6']);
    expect(windows[0].startMs).toBeGreaterThan(Date.UTC(2026, 8, 1));
  });

  it('gives sweet corn only the fresh-eating target', () => {
    for (const id of ['corn-sweet-bodacious', 'sweet-corn-american-dream-f1-seed']) {
      const corn = plugin(id);
      const windows = of(
        eventsForPlanting(planting(corn, Date.UTC(2026, 4, 1)), corn),
        'harvest-window'
      );
      expect(
        windows.map((w) => w.detail?.useCase),
        id
      ).toEqual(['fresh-eating']);
    }
  });

  it('keeps both targets on a dual-purpose corn', () => {
    const corn = plugin('corn-bloody-butcher');
    const windows = of(
      eventsForPlanting(planting(corn, Date.UTC(2026, 4, 1)), corn),
      'harvest-window'
    );
    expect(windows).toHaveLength(2);
  });
});

describe('#629 winter wheat over winter', () => {
  const wheat = plugin('wheat-soft-red-winter');
  const sown = Date.UTC(2026, 9, 12);
  const events = eventsForPlanting(planting(wheat, sown), wheat);
  const stage = (code: string) =>
    of(events, 'stage-window').find((e) => e.detail?.stageCode === code);

  it('puts jointing in spring, not January', () => {
    const z30 = stage('Z30')!;
    expect(z30).toBeDefined();
    expect(new Date(z30.startMs).getUTCFullYear()).toBe(2027);
    expect(new Date(z30.startMs).getUTCMonth()).toBeGreaterThanOrEqual(2);
    expect(z30.body).toMatch(/N topdress/);
    expect(isTypicalTimingEvent(z30)).toBe(true);
  });

  it('matches the /plan/wheat timeline for every stage', () => {
    const timeline = buildZadoksTimeline(
      {
        pluginId: wheat.pluginId,
        displayName: wheat.displayName,
        daysToMaturity: wheat.daysToMaturity,
        growthStageTable: wheat.growthStageTable
      },
      sown,
      'winter'
    );
    for (const s of timeline) expect(stage(s.code)?.startMs, s.code).toBe(s.startMs);
  });

  it('puts the harvest in early summer, marked as typical timing', () => {
    const [h] = of(events, 'harvest-window');
    expect(new Date(h.startMs).getUTCMonth()).toBe(5);
    expect(isTypicalTimingEvent(h)).toBe(true);
  });

  it('never projects a stage from jointing on into winter for any fall sowing', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 75 }), (d) => {
        const plant = Date.UTC(2026, 8, 15) + d * DAY;
        const ev = eventsForPlanting(planting(wheat, plant), wheat);
        for (const e of of(ev, 'stage-window')) {
          const z = Number(String(e.detail?.stageCode).slice(1));
          if (z < 30) continue;
          const m = new Date(e.startMs).getUTCMonth();
          expect(m >= 2 && m <= 6).toBe(true);
        }
      }),
      { numRuns: 40 }
    );
  });
});

describe('#642 cucurbits picked immature', () => {
  it('drops ripening stages and the "fully ripe" target from cucumbers and zucchini', () => {
    for (const id of ['cucumber-marketmore-76', 'zucchini-black-beauty']) {
      const crop = plugin(id);
      const sown = Date.UTC(2026, 4, 15);
      const events = eventsForPlanting(planting(crop, sown), crop);
      const codes = of(events, 'stage-window').map((e) => e.detail?.stageCode);
      expect(codes, id).not.toContain('BBCH-81');
      expect(codes, id).not.toContain('BBCH-89');
      expect(of(events, 'stage-window').some((e) => /Vine begins/.test(e.body ?? ''))).toBe(false);
      const [h] = of(events, 'harvest-window');
      expect(h.startMs, id).toBe(sown + crop.daysToMaturity!.min * DAY);
    }
  });

  it('keeps the ripe-fruit target for melons', () => {
    const melon = plugin('cantaloupe-hales-best');
    const windows = of(
      eventsForPlanting(planting(melon, Date.UTC(2026, 4, 15)), melon),
      'harvest-window'
    );
    expect(windows.map((w) => w.detail?.stageCode)).toEqual(['BBCH-89']);
  });
});

describe('#686 perennial fruit each year', () => {
  const now = Date.UTC(2026, 9, 7);

  it('gives an old grape vine a harvest window this year', () => {
    const grape = plugin('grape-concord');
    const w = harvestWindowFor(planting(grape, Date.UTC(2016, 3, 15)), grape, { now });
    expect(w).not.toBeNull();
    expect(new Date(w!.startMs).getFullYear()).toBe(2026);
  });

  it('borrows no apple-season window for a peach', () => {
    const peach = plugin('peach-redhaven');
    const events = eventsForPlanting(planting(peach, Date.UTC(2020, 3, 1)), peach, { now });
    expect(of(events, 'harvest-window')).toEqual([]);
    expect(of(events, 'stage-window')).toEqual([]);
  });

  it('shows no harvest before the years to first crop have passed', () => {
    const berry = plugin('strawberry-jewel');
    const sown = Date.UTC(2026, 3, 10);
    const events = eventsForPlanting(planting(berry, sown), berry, { now: Date.UTC(2026, 5, 1) });
    const years = of(events, 'harvest-window').map((e) => new Date(e.startMs).getFullYear());
    expect(years).not.toContain(2026);
    expect(years).toContain(2027);
  });
});

describe('#680 one harvest window', () => {
  it('reads the engine window, not a one-day DTM span', () => {
    const carrot = plugin('carrot-scarlet-nantes-seed');
    const p = planting(carrot, Date.UTC(2027, 3, 1));
    const now = Date.UTC(2027, 5, 1);
    const w = harvestWindowFor(p, carrot, { now })!;
    const [h] = of(eventsForPlanting(p, carrot, { now }), 'harvest-window');
    expect(w).toEqual({ startMs: h.startMs, endMs: h.endMs });
    expect(w.endMs).toBeGreaterThan(w.startMs);
  });

  it('picks the open window, then the next, then the latest past one', () => {
    const a = { startMs: 10, endMs: 20 };
    const b = { startMs: 30, endMs: 40 };
    expect(pickHarvestWindow([a, b], 15)).toEqual(a);
    expect(pickHarvestWindow([a, b], 25)).toEqual(b);
    expect(pickHarvestWindow([a, b], 50)).toEqual(b);
    expect(pickHarvestWindow([], 50)).toBeNull();
  });
});
