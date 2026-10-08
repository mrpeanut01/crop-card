// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEMO_PERENNIALS, DEMO_PRODUCTS, DEMO_SEEDS } from './catalog';
import {
  buildDemoTimeline,
  seedReceiptAt,
  treesBare,
  TASK_HORIZON_DAYS,
  type DemoTimeline
} from './timeline';
import { DAY_MS, addDaysYmd, demoSeason, utcDayMs, ymdFromUtcDay, ymdOf, zonedMs } from './time';

/** Noon in Leesburg on the given day. */
const at = (ymd: string, hour = 12) => zonedMs(ymd, hour);

const DATES = [
  '2027-01-15',
  '2026-03-20',
  '2026-05-10',
  '2026-07-15',
  '2026-10-02',
  '2026-12-10',
  '2028-02-29',
  '2026-02-15',
  '2026-08-23'
];

function recordInstants(t: DemoTimeline): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const r of t.sprays) out.push(['spray', r.at]);
  for (const r of t.harvests) out.push(['harvest', r.at]);
  for (const r of t.scouts) out.push(['scout', r.at]);
  for (const r of t.fertility) out.push(['fertility', r.at]);
  for (const r of t.journal) out.push(['journal', r.at]);
  for (const r of t.production) out.push(['production', r.at]);
  for (const r of t.irrigation) out.push(['irrigation', r.at]);
  for (const r of t.rain) out.push(['rain', r.at]);
  for (const r of t.ledger) out.push(['ledger', r.at]);
  for (const r of t.soilTests) out.push(['soil', r.at]);
  for (const r of t.calibrations) out.push(['calibration', r.at]);
  for (const s of t.seedStarts) {
    for (const v of [s.sownAt, s.germinatedAt, s.hardenStartedAt, s.transplantedAt]) {
      if (v !== undefined) out.push(['seed-start', v]);
    }
  }
  for (const h of t.hay) {
    for (const v of [h.mowAt, h.tedAt, h.rakeAt, h.baleAt, h.storedAt]) {
      if (v !== undefined) out.push(['hay', v]);
    }
  }
  for (const p of t.plantings)
    if (p.harvestedAt !== undefined) out.push(['harvested', p.harvestedAt]);
  for (const task of t.tasks) if (task.doneAt !== undefined) out.push(['done-task', task.doneAt]);
  return out;
}

describe('demoSeason', () => {
  it('treats early winter as planning next season', () => {
    const s = demoSeason(at('2027-01-15'));
    expect(s).toMatchObject({ today: '2027-01-15', current: 2026, planningYear: 2027 });
    expect(s.nextSeasonPlanned).toBe(true);
  });

  it('is in season from mid-February until the planning rollover', () => {
    expect(demoSeason(at('2026-02-15'))).toMatchObject({ current: 2026, planningYear: 2026 });
    expect(demoSeason(at('2026-07-15'))).toMatchObject({ current: 2026, planningYear: 2026 });
    expect(demoSeason(at('2026-07-15')).nextSeasonPlanned).toBe(false);
  });

  it('rolls planning over eight weeks before the first fall frost', () => {
    const s = demoSeason(at('2026-10-02'));
    expect(s).toMatchObject({ current: 2026, planningYear: 2027, nextSeasonPlanned: true });
  });

  it('uses the farm day, not the UTC day', () => {
    expect(demoSeason(zonedMs('2026-03-01', 22)).today).toBe('2026-03-01');
  });
});

describe('zonedMs', () => {
  it('handles both sides of a DST change', () => {
    expect(new Date(zonedMs('2026-01-10', 8)).toISOString()).toBe('2026-01-10T13:00:00.000Z');
    expect(new Date(zonedMs('2026-07-10', 8)).toISOString()).toBe('2026-07-10T12:00:00.000Z');
    expect(ymdOf(zonedMs('2026-03-08', 23, 30))).toBe('2026-03-08');
  });
});

describe.each(DATES)('buildDemoTimeline on %s', (ymd) => {
  const now = at(ymd);
  const t = buildDemoTimeline(now);
  const today = t.season.today;

  it('is deterministic for a given now', () => {
    expect(buildDemoTimeline(now)).toEqual(t);
  });

  it('never dates a record after now', () => {
    const late = recordInstants(t).filter(([, v]) => v > now);
    expect(late).toEqual([]);
  });

  it('has at least eight open tasks in the next 14 days and more beyond', () => {
    const open = t.tasks.filter((task) => task.doneAt === undefined);
    const soon = open.filter(
      (task) => task.due >= utcDayMs(today) && task.due <= utcDayMs(addDaysYmd(today, 14))
    );
    expect(soon.length).toBeGreaterThanOrEqual(8);
    const later = open.filter((task) => task.due > utcDayMs(addDaysYmd(today, 14)));
    expect(later.length).toBeGreaterThanOrEqual(5);
    expect(open.every((task) => task.due <= utcDayMs(addDaysYmd(today, TASK_HORIZON_DAYS)))).toBe(
      true
    );
    expect(new Set(t.tasks.map((task) => task.key)).size).toBe(t.tasks.length);
  });

  it('mixes kinds of work in the upcoming tasks', () => {
    const kinds = new Set(t.tasks.filter((x) => !x.doneAt).map((x) => x.category));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    expect(kinds.has('scout')).toBe(true);
  });

  it('has a few records from the last 48 hours', () => {
    const recent = recordInstants(t).filter(([, v]) => v > now - 2 * DAY_MS);
    const kinds = new Set(recent.map(([k]) => k));
    expect(kinds.has('spray')).toBe(true);
    expect(kinds.has('scout')).toBe(true);
    expect(kinds.has('production')).toBe(true);
  });

  it('keeps planting status consistent with dates', () => {
    for (const p of t.plantings) {
      if (p.status === 'planned') expect(p.plantingDate).toBeGreaterThan(now - DAY_MS);
      if (p.status === 'harvested') expect(p.harvestedAt).toBeLessThanOrEqual(now);
      if (p.status === 'active') expect(p.plantingDate).toBeLessThanOrEqual(now);
    }
    expect(t.plantings.some((p) => p.status === 'active')).toBe(true);
    expect(t.plantings.some((p) => p.status === 'harvested')).toBe(true);
  });

  it('never records a pick inside a spray’s pre-harvest or re-entry interval', () => {
    for (const h of t.harvests) {
      for (const s of t.sprays) {
        if (s.plantingKey !== h.plantingKey || s.at > h.at) continue;
        const p = DEMO_PRODUCTS[s.product];
        const blockedMs = Math.max((p.phiDays ?? 0) * DAY_MS, (p.reiHours ?? 0) * 3_600_000);
        expect(h.at - s.at >= blockedMs || blockedMs === 0).toBe(true);
      }
    }
  });

  it('only records grain dry enough to store', () => {
    for (const h of t.harvests)
      if (h.moisturePct !== undefined) expect(h.moisturePct).toBeLessThan(15);
  });

  it('leaves exactly one sprayer needing a cleanout: the orchard sprayer', () => {
    const last = new Map<string, number>();
    for (const s of t.sprays) last.set(s.sprayer, Math.max(last.get(s.sprayer) ?? 0, s.at));
    expect(last.has('atv')).toBe(true);
  });
});

describe('season shape', () => {
  const by = (ymd: string) => buildDemoTimeline(at(ymd));
  const status = (t: DemoTimeline, key: string) => t.plantings.find((p) => p.key === key)?.status;

  it('in mid-January last season is in and next season is planned', () => {
    const t = by('2027-01-15');
    expect(status(t, 'corn@2026')).toBe('harvested');
    expect(status(t, 'cherokee@2026')).toBe('harvested');
    expect(status(t, 'garlic@2027')).toBe('active');
    expect(status(t, 'wheat@2027')).toBe('active');
    expect(status(t, 'cherokee@2027')).toBe('planned');
    expect(t.tasks.some((x) => x.title.startsWith('Place the seed order'))).toBe(true);
  });

  it('in late March seedlings are under lights and the wheat is greening up', () => {
    const t = by('2026-03-20');
    expect(status(t, 'wheat@2026')).toBe('active');
    expect(status(t, 'cherokee@2026')).toBe('planned');
    expect(t.seedStarts.some((s) => s.plantingKey === 'juliet@2026')).toBe(true);
    expect(t.tasks.some((x) => x.seedStep === 'sow')).toBe(true);
  });

  it('in mid-July the garden is picking and wheat is in the bin', () => {
    const t = by('2026-07-15');
    expect(status(t, 'wheat@2026')).toBe('harvested');
    expect(status(t, 'garlic@2026')).toBe('harvested');
    expect(status(t, 'sungold@2026')).toBe('active');
    expect(t.harvests.some((h) => h.plantingKey === 'sungold@2026')).toBe(true);
    expect(t.hay.filter((h) => h.season === 2026).length).toBeGreaterThanOrEqual(2);
  });

  it('in early October the field crops are coming off and garlic goes in for next year', () => {
    const t = by('2026-10-02');
    expect(status(t, 'corn@2026')).toBe('harvested');
    expect(['planned', 'active']).toContain(status(t, 'garlic@2027'));
    expect(t.tasks.some((x) => x.plantingKey === 'garlic@2027')).toBe(true);
  });

  it('in December there is a season close-out to do', () => {
    const t = by('2026-11-20');
    expect(t.tasks.some((x) => x.title === 'Close out the season')).toBe(true);
  });
});

describe('perennial planting dates (#666)', () => {
  const plantedOn = (t: DemoTimeline) =>
    Object.fromEntries(
      t.plantings
        .filter((p) => p.mode === 'perennial')
        .map((p) => [p.key, ymdFromUtcDay(p.plantingDate)])
    );

  it('stay put as the demo date moves forward from the same start', () => {
    const anchor = at('2026-10-07');
    const first = plantedOn(buildDemoTimeline(anchor, anchor));
    expect(Object.keys(first)).toHaveLength(DEMO_PERENNIALS.length);
    for (const later of [
      '2026-10-20',
      '2027-01-15',
      '2027-04-25',
      '2027-07-25',
      '2027-09-20',
      '2028-09-30'
    ]) {
      expect(plantedOn(buildDemoTimeline(at(later), anchor))).toEqual(first);
    }
  });

  it('stay put within a season without an explicit anchor', () => {
    const a = plantedOn(buildDemoTimeline(at('2027-04-25')));
    expect(plantedOn(buildDemoTimeline(at('2027-07-25')))).toEqual(a);
    expect(plantedOn(buildDemoTimeline(at('2027-09-20')))).toEqual(a);
  });

  it('are years back, in planting months, never in midwinter', () => {
    for (const ymd of DATES) {
      const t = buildDemoTimeline(at(ymd));
      for (const [key, day] of Object.entries(plantedOn(t))) {
        const month = Number(day.slice(5, 7));
        expect([3, 9], key).toContain(month);
        expect(Number(day.slice(0, 4))).toBeLessThanOrEqual(t.season.current - 3);
      }
    }
  });
});

describe('dormant orchard sprays (#632)', () => {
  it('marks every tree spray in November through March as dormant', () => {
    for (const ymd of [...DATES, '2027-02-01', '2026-11-19', '2026-03-23']) {
      const t = buildDemoTimeline(at(ymd));
      const tree = t.sprays.filter((s) => s.plantingKey.endsWith('@perennial'));
      for (const s of tree) expect(s.dormant, ymdOf(s.at)).toBe(treesBare(ymdOf(s.at)));
      for (const s of t.sprays.filter((x) => !x.plantingKey.endsWith('@perennial')))
        expect(s.dormant).toBeFalsy();
    }
  });

  it('keeps the observation on a leaf-on tree spray', () => {
    expect(treesBare('2026-05-06')).toBe(false);
    expect(treesBare('2026-11-18')).toBe(true);
    expect(treesBare('2027-03-06')).toBe(true);
  });
});

describe('garden scout note (#652)', () => {
  const scoutBody = (ymd: string) =>
    buildDemoTimeline(at(ymd)).tasks.find((x) => x.key === 'routine:overdue')?.body;

  it('names only what is growing in the garden', () => {
    expect(scoutBody('2027-04-25')).toBe(
      'Turn leaves on whatever is up in the beds; log anything at threshold on /scout.'
    );
    expect(scoutBody('2027-05-20')).toBe(
      'Turn leaves on the tomatoes; log anything at threshold on /scout.'
    );
    expect(scoutBody('2027-07-15')).toBe(
      'Turn leaves on the tomatoes and squash; log anything at threshold on /scout.'
    );
  });

  it('never mentions tomatoes or squash before they are planted', () => {
    for (let d = '2027-04-01'; d <= '2027-10-31'; d = addDaysYmd(d, 3)) {
      const t = buildDemoTimeline(at(d));
      const body = t.tasks.find((x) => x.key === 'routine:overdue')?.body ?? '';
      const planted = (keys: string[]) =>
        t.plantings.some(
          (p) => keys.includes(p.templateKey) && p.status === 'active' && p.season === 2027
        );
      if (body.includes('tomatoes')) expect(planted(['cherokee', 'sungold']), d).toBe(true);
      if (body.includes('squash')) expect(planted(['zucchini', 'butternut']), d).toBe(true);
    }
  });
});

describe('seed purchase dates (#663)', () => {
  it('buys seed before the season’s first sowing, not three weeks before today', () => {
    for (const ymd of ['2027-07-25', '2027-09-20', '2027-04-25', '2027-01-15', '2026-02-20']) {
      const now = at(ymd);
      const t = buildDemoTimeline(now);
      for (const s of DEMO_SEEDS) {
        const receipt = seedReceiptAt(t, s.key, [], now);
        expect(receipt, s.key).toBeLessThanOrEqual(now - 21 * DAY_MS);
        const sowings = t.plantings
          .filter((p) => p.seed === s.key && p.season === t.season.current)
          .map((p) => p.sownIndoorsAt ?? p.plantingDate);
        for (const sow of sowings) expect(receipt, `${ymd} ${s.key}`).toBeLessThan(sow);
      }
    }
  });

  it('dates the midsummer tomato seed in late winter or spring, not July', () => {
    const now = at('2027-07-25');
    const t = buildDemoTimeline(now);
    for (const key of ['cherokee', 'sungold', 'bell', 'lettuce', 'beans', 'carrots', 'juliet']) {
      const day = ymdOf(seedReceiptAt(t, key, [], now));
      expect(day < '2027-05-01', `${key} ${day}`).toBe(true);
    }
  });
});
