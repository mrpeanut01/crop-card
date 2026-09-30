import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CardModel } from '../model';
import type { FarmSnapshot, SnapshotTask } from '../snapshot';
import { sampleSnapshot } from './fixtures';
import {
  EARLIER_DAYS_NOTE,
  MONTH_PER_DAY,
  PRINTED_MIX_PATTERN,
  PRINTED_RATE_PATTERN,
  WEEK_PER_DAY,
  completeDays,
  periodCardPrintHref,
  periodPrintable,
  printedCalendarText,
  startOfWeekYmd
} from './calendar';
import { buildWeekCard } from './week';
import { buildMonthCard } from './month';
import { buildCard } from './index';

const at = (iso: string) => Date.parse(iso);
const NOW = at('2026-06-01T13:00:00Z');

function task(over: Partial<SnapshotTask> & { id: string }): SnapshotTask {
  return {
    title: 'Weed the beds',
    category: 'other',
    scheduledFor: at('2026-06-03T14:00:00Z'),
    cropId: null,
    blockId: null,
    equipmentId: null,
    ...over
  };
}

function snap(tasks: SnapshotTask[], over: Partial<FarmSnapshot> = {}): FarmSnapshot {
  return sampleSnapshot({
    tasks,
    taskWindow: { fromMs: NOW - 14 * 86_400_000, toMs: NOW + 62 * 86_400_000 },
    ...over
  });
}

function days(card: CardModel) {
  return card.calendar!.weeks.flat();
}

function day(card: CardModel, ymd: string) {
  return days(card).find((d) => d.ymd === ymd)!;
}

describe('Week Card', () => {
  it('snaps any day to the first day of its week and keys on it', () => {
    const card = buildWeekCard(snap([]), '2026-06-03', { firstDay: 0 })!;
    expect(card.key).toBe('wk_2026-05-31');
    expect(card.kind).toBe('week');
    expect(card.href).toBe('/cards/week/wk_2026-05-31');
    expect(days(card).map((d) => d.ymd)).toEqual([
      '2026-05-31',
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
      '2026-06-06'
    ]);
    expect(card.calendar!.weekdays[0]).toBe('Sun');
    expect(buildWeekCard(snap([]), '2026-06-03', { firstDay: 1 })!.key).toBe('wk_2026-06-01');
  });

  it('rebuilds from its own key through buildCard', () => {
    const s = snap([task({ id: 'a' })]);
    const card = buildWeekCard(s, '2026-06-01')!;
    expect(buildCard(s, card.key)).toEqual(card);
  });

  it('lists open tasks by day with where and the assignee short name', () => {
    const s = snap(
      [
        task({ id: 'a', title: 'Stake tomatoes', blockId: 'b_bed3', assigneeUserId: 'u_maria' }),
        task({ id: 'b', title: 'Mow the lane', scheduledFor: at('2026-06-05T14:00:00Z') })
      ],
      { people: [{ id: 'u_maria', name: 'Maria Lopez' }] }
    );
    const card = buildWeekCard(s, '2026-06-01')!;
    const wed = day(card, '2026-06-03');
    expect(wed.entries).toHaveLength(1);
    expect(wed.entries[0].text).toBe('Stake tomatoes');
    expect(wed.entries[0].where).toContain('Kitchen Garden');
    expect(wed.entries[0].who).toBe('Maria');
    expect(day(card, '2026-06-05').entries[0].who).toBeUndefined();
    expect(card.facts[0]).toMatchObject({ label: 'Open tasks', value: '2' });
  });

  it('marks open tasks dated before today overdue', () => {
    const s = snap([task({ id: 'late', scheduledFor: at('2026-05-31T14:00:00Z') })]);
    const card = buildWeekCard(s, '2026-06-01', { firstDay: 0 })!;
    expect(day(card, '2026-05-31').entries[0].overdue).toBe(true);
    expect(card.facts.find((f) => f.label === 'Overdue')?.value).toBe('1');
  });

  it('caps a day at 12 and flags the overflow page', () => {
    const many = Array.from({ length: WEEK_PER_DAY + 3 }, (_, i) => task({ id: `t${i}` }));
    const card = buildWeekCard(snap(many), '2026-06-01')!;
    expect(card.calendar!.perDay).toBe(12);
    expect(card.calendar!.overflow).toBe(true);
    expect(day(card, '2026-06-03').entries).toHaveLength(15);
  });

  it('returns null for a week past the saved task window', () => {
    expect(buildWeekCard(snap([]), '2026-08-20')).toBeNull();
    expect(buildWeekCard(snap([]), '2026-04-01')).toBeNull();
    expect(buildWeekCard(snap([]), 'not-a-date')).toBeNull();
  });
});

describe('Month Card', () => {
  it('builds this month and next month from a 62-day window', () => {
    const s = snap([]);
    expect(buildMonthCard(s, '2026-06')).not.toBeNull();
    expect(buildMonthCard(s, '2026-07')).not.toBeNull();
    expect(buildMonthCard(s, '2026-08')).toBeNull();
  });

  it('draws whole weeks and leaves the neighbouring months blank', () => {
    const card = buildMonthCard(snap([]), '2026-06', { firstDay: 0 })!;
    expect(card.key).toBe('mo_2026-06');
    expect(card.title).toBe('June 2026');
    const all = days(card);
    expect(all.length % 7).toBe(0);
    expect(all[0].ymd).toBe('2026-05-31');
    expect(all[0].inPeriod).toBe(false);
    expect(all.filter((d) => d.inPeriod)).toHaveLength(30);
  });

  it('shades days earlier than the window and says so', () => {
    const card = buildMonthCard(snap([]), '2026-05')!;
    expect(day(card, '2026-05-02').earlier).toBe(true);
    expect(day(card, '2026-05-25').earlier).toBe(false);
    expect(card.notices).toContain(EARLIER_DAYS_NOTE);
  });

  it('shows four per cell and overflows to a list page', () => {
    const five = Array.from({ length: MONTH_PER_DAY + 1 }, (_, i) => task({ id: `t${i}` }));
    const card = buildMonthCard(snap(five), '2026-06')!;
    expect(card.calendar!.perDay).toBe(4);
    expect(card.calendar!.overflow).toBe(true);
    const calm = buildMonthCard(snap(five.slice(0, 4)), '2026-06')!;
    expect(calm.calendar!.overflow).toBe(false);
  });

  it('falls back to the pre-32F window on old bundles', () => {
    const old = sampleSnapshot({ tasks: [] });
    delete old.taskWindow;
    expect(completeDays(old, 'America/New_York')).toEqual({
      firstYmd: '2026-05-19',
      lastYmd: '2026-06-30'
    });
    expect(buildMonthCard(old, '2026-07')).toBeNull();
  });
});

describe('filters', () => {
  const s = snap(
    [
      task({ id: 'g', blockId: 'b_bed3', assigneeUserId: 'u_maria' }),
      task({ id: 'h', blockId: 'b_hay' }),
      task({ id: 'w', title: 'Fix the gate' })
    ],
    { people: [{ id: 'u_maria', name: 'Maria' }] }
  );

  it('keeps one Area and footnotes the farm-wide tasks', () => {
    const card = buildWeekCard(s, '2026-06-01', { area: 'f_garden' })!;
    expect(days(card).flatMap((d) => d.entries)).toHaveLength(1);
    expect(card.notices).toContain('1 farm-wide task not shown.');
    expect(card.kicker).toContain('Kitchen Garden');
  });

  it('keeps one person or the unassigned ones and says so in the kicker', () => {
    const mine = buildWeekCard(s, '2026-06-01', { who: 'u_maria' })!;
    expect(days(mine).flatMap((d) => d.entries)).toHaveLength(1);
    expect(mine.kicker).toContain('For Maria');
    const open = buildWeekCard(s, '2026-06-01', { who: 'unassigned' })!;
    expect(days(open).flatMap((d) => d.entries)).toHaveLength(2);
    expect(open.kicker).toContain('Unassigned');
  });
});

describe('no spray instructions on paper (F3-4)', () => {
  const sprayer = {
    id: 'eq_boom',
    type: 'sprayer' as const,
    label: 'Boom',
    state: {
      calibratedGpa: 20,
      calibrationDate: NOW,
      lastDeconAt: null,
      lastUsedAt: null,
      lastChemistryClass: null,
      winterizedAt: null
    }
  };

  it('prints a spray task as "Spray task" with where and a Spray Card link', () => {
    const s = snap(
      [
        task({
          id: 'sp',
          category: 'spray',
          title: 'Glyphosate 2 qt per acre, fill tank half with water first',
          blockId: 'b_hay',
          equipmentId: 'eq_boom'
        })
      ],
      { equipment: [{ ...sprayer, state: { ...sprayer.state, calibratedGpa: null } }] }
    );
    const card = buildWeekCard(s, '2026-06-01')!;
    const e = day(card, '2026-06-03').entries[0];
    expect(e.text).toBe('Spray task');
    expect(e.where).toContain('Hayfield');
    expect(e.see).toBe('See the Spray Card');
    expect(e.seeUrl).toBe('https://app.cropcard.io/c/sp_eq_boom');
    expect(JSON.stringify(card)).not.toContain('Glyphosate');
  });

  it('sends a spray task with no one Spray Card to its task card', () => {
    const s = snap([task({ id: 'sp2', category: 'spray', title: 'Spray the fence line' })]);
    const e = day(buildWeekCard(s, '2026-06-01')!, '2026-06-03').entries[0];
    expect(e.seeUrl).toBe('https://app.cropcard.io/c/tk_sp2');
  });

  it('treats an Inputs Plan herbicide task as spray work by the record it becomes', () => {
    const s = snap([
      task({
        id: 'pre',
        category: null,
        title: 'pre emergent: Dual II Magnum',
        relatedEventTable: 'spray_event'
      }),
      task({ id: 'post', category: null, title: 'post emergent: Liberty' })
    ]);
    const entries = day(buildWeekCard(s, '2026-06-01')!, '2026-06-03').entries;
    expect(entries.map((e) => e.text)).toEqual(['Spray task', 'Spray task']);
    expect(entries.every((e) => e.seeUrl)).toBe(true);
    expect(JSON.stringify(entries)).not.toMatch(/Dual|Liberty/);
  });

  it('gives a hidden ordinary title a link to its Task Card', () => {
    const s = snap([task({ id: 'h1', title: 'Harvest 20 lb tomatoes' })]);
    const e = day(buildWeekCard(s, '2026-06-01')!, '2026-06-03').entries[0];
    expect(e.text).toBe('Task, details on the Task Card');
    expect(e.see).toBe('See the Task Card');
    expect(e.seeUrl).toBe('https://app.cropcard.io/c/tk_h1');
  });

  it('prints an animal-care task by title only', () => {
    const s = snap([
      task({
        id: 'care',
        category: 'animal-care' as SnapshotTask['category'],
        title: 'Deworm the goats 1 ml per 11 lb',
        blockId: 'b_hay'
      }),
      task({ id: 'care2', category: 'animal-care' as SnapshotTask['category'], title: 'Trim hooves' })
    ]);
    const entries = day(buildWeekCard(s, '2026-06-01')!, '2026-06-03').entries;
    expect(entries.map((e) => e.text).sort()).toEqual(['Animal care task', 'Trim hooves']);
    expect(entries.every((e) => e.where === undefined)).toBe(true);
  });

  const rateUnits = ['oz', 'fl oz', 'qt', 'pt', 'gal', 'lb', 'lbs', 'ml', 'g', 'kg'];
  const titleArb = fc.oneof(
    fc.string({ maxLength: 40 }),
    fc
      .tuple(
        fc.string({ maxLength: 12 }),
        fc.float({ min: Math.fround(0.1), max: 500, noNaN: true }),
        fc.constantFrom(...rateUnits),
        fc.constantFrom('', ' per acre', '/acre', ' per 1,000 sq ft', ' per 1000 square feet')
      )
      .map(([a, n, u, per]) => `${a} ${n.toFixed(1)} ${u}${per}`),
    fc.constantFrom(
      'Fill the tank half with water, add product',
      'Mix order: AMS, then Roundup',
      'Tank-mix with 2,4-D',
      'Step 1 agitate',
      'Spray Roundup 32 oz/acre',
      'Apply 1 pt per acre'
    )
  );
  const categoryArb = fc.constantFrom<SnapshotTask['category']>(
    'spray',
    'fertilize',
    'scout',
    'other',
    'prune',
    null,
    'animal-care' as SnapshotTask['category']
  );

  it('no printed week or month card ever carries a rate or a mixing step', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            title: titleArb,
            category: categoryArb,
            day: fc.integer({ min: 0, max: 40 }),
            block: fc.constantFrom(null, 'b_hay', 'b_bed3')
          }),
          { maxLength: 25 }
        ),
        (rows) => {
          const s = snap(
            rows.map((r, i) =>
              task({
                id: `r${i}`,
                title: r.title,
                category: r.category,
                blockId: r.block,
                scheduledFor: at('2026-06-01T14:00:00Z') + r.day * 86_400_000
              })
            )
          );
          const cards = [
            buildWeekCard(s, '2026-06-01'),
            buildWeekCard(s, '2026-06-20'),
            buildMonthCard(s, '2026-06'),
            buildMonthCard(s, '2026-07')
          ].filter((c): c is CardModel => !!c);
          expect(cards.length).toBe(4);
          for (const card of cards)
            for (const text of printedCalendarText(card)) {
              expect(text).not.toMatch(PRINTED_RATE_PATTERN);
              expect(text).not.toMatch(PRINTED_MIX_PATTERN);
            }
        }
      ),
      { numRuns: 150 }
    );
  });

  it('carries no money', () => {
    const s = snap([task({ id: 'm', title: 'Pick up feed', blockId: 'b_hay' })]);
    for (const card of [buildWeekCard(s, '2026-06-01')!, buildMonthCard(s, '2026-06')!]) {
      const json = JSON.stringify(card);
      expect(json).not.toMatch(/\$\s?\d/);
      expect(json).not.toMatch(/cents|receivedCost|ledger/i);
    }
  });
});

describe('periodPrintable', () => {
  it('agrees with the builder: only periods inside a fresh snapshot print', () => {
    const today = '2026-06-01';
    const s = sampleSnapshot({
      tasks: [],
      generatedAt: NOW,
      taskWindow: { fromMs: NOW - 14 * 86_400_000, toMs: NOW + 62 * 86_400_000 }
    });
    for (let off = -60; off <= 150; off += 3) {
      const d = new Date(Date.parse(`${today}T12:00:00Z`) + off * 86_400_000)
        .toISOString()
        .slice(0, 10);
      expect(periodPrintable('week', d, today, 0)).toBe(
        !!buildWeekCard(s, d, { firstDay: 0 })
      );
      expect(periodPrintable('month', d, today, 0)).toBe(
        !!buildMonthCard(s, d.slice(0, 7), { firstDay: 0 })
      );
    }
    expect(periodPrintable('month', '2027-01-01', today)).toBe(false);
  });
});

describe('helpers', () => {
  it('startOfWeekYmd honours the first day', () => {
    expect(startOfWeekYmd('2026-06-03', 0)).toBe('2026-05-31');
    expect(startOfWeekYmd('2026-06-03', 1)).toBe('2026-06-01');
    expect(startOfWeekYmd('2026-05-31', 1)).toBe('2026-05-25');
  });

  it('periodCardPrintHref maps /today views and the Mine filter', () => {
    expect(periodCardPrintHref('week', '2026-06-03')).toBe(
      '/cards/week/wk_2026-06-03?print=1'
    );
    expect(periodCardPrintHref('month', '2026-06-03')).toBe('/cards/month/mo_2026-06?print=1');
    expect(periodCardPrintHref('week', '2026-06-03', { who: 'mine', viewerId: 'u1' })).toBe(
      '/cards/week/wk_2026-06-03?print=1&who=u1'
    );
    expect(periodCardPrintHref('week', '2026-06-03', { who: 'all', viewerId: 'u1' })).toBe(
      '/cards/week/wk_2026-06-03?print=1'
    );
  });
});
