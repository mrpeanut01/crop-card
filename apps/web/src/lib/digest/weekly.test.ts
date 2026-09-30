import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  buildWeeklyDigest,
  cashForDays,
  digestHours,
  digestPushBody,
  isSprayTask,
  mondayOf,
  SPRAY_TASK_LABEL,
  type DigestTask,
  type WeeklyDigestInput
} from './weekly';
import { buildDigestCard, digestCardKey, digestCardText } from '$lib/cards/build/digest';
import { RECORD_ONLY_CARD_KINDS, parseCardKey } from '$lib/cards/model';

const TZ = 'America/New_York';
const MONDAY = '2026-09-28';
const NOW = Date.parse('2026-09-28T14:00:00Z');
const day = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);

function task(id: string, ymd: string, extra: Partial<DigestTask> = {}): DigestTask {
  return { id, title: `Task ${id}`, scheduledFor: day(ymd), ...extra };
}

function base(extra: Partial<WeeklyDigestInput> = {}): WeeklyDigestInput {
  return {
    viewerId: 'owner',
    isOwner: true,
    weekStartYmd: MONDAY,
    timeZone: TZ,
    nowMs: NOW,
    openTasks: [],
    lowStockCount: 0,
    ...extra
  };
}

const MONEY = /\$\s?\d|\d+\.\d{2}\b|USD/;
/** F4-6: the words of the immediate safety alerts. */
const SAFETY = /decon|lock|frost|freeze|withdrawal|grazing|graze|hold|all clear|calibrat|safe to/i;

describe('mondayOf', () => {
  it('snaps any day to the Monday that starts its week', () => {
    expect(mondayOf('2026-09-28')).toBe('2026-09-28');
    expect(mondayOf('2026-10-04')).toBe('2026-09-28');
    expect(mondayOf('2026-09-30')).toBe('2026-09-28');
    expect(mondayOf('2026-10-05')).toBe('2026-10-05');
  });
});

describe('buildWeeklyDigest', () => {
  it('splits overdue from this week and ignores later weeks', () => {
    const d = buildWeeklyDigest(
      base({
        openTasks: [
          task('late', '2026-09-25'),
          task('mon', '2026-09-28'),
          task('sun', '2026-10-04'),
          task('next', '2026-10-05'),
          task('done', '2026-09-29', { completedAt: NOW })
        ]
      })
    );
    expect(d.weekEndYmd).toBe('2026-10-04');
    expect(d.dueThisWeek.map((l) => l.id)).toEqual(['mon', 'sun']);
    expect(d.overdue.map((l) => l.id)).toEqual(['late']);
    expect(d.dueThisWeekCount).toBe(2);
    expect(d.overdueCount).toBe(1);
  });

  it('gives the owner every task with counts per person, unassigned last', () => {
    const d = buildWeeklyDigest(
      base({
        openTasks: [
          task('a', '2026-09-29', { assigneeUserId: 'maria' }),
          task('b', '2026-09-30', { assigneeUserId: 'maria' }),
          task('c', '2026-09-30', { assigneeUserId: 'sam', assigneeName: 'Sam' }),
          task('d', '2026-10-01')
        ],
        people: { maria: 'Maria', sam: 'Sam R' }
      })
    );
    expect(d.dueThisWeekCount).toBe(4);
    expect(d.byPerson).toEqual([
      { userId: 'maria', name: 'Maria', count: 2 },
      { userId: 'sam', name: 'Sam', count: 1 },
      { userId: null, name: 'Not assigned', count: 1 }
    ]);
  });

  it('shows no per-person line when nothing is assigned yet', () => {
    const d = buildWeeklyDigest(base({ openTasks: [task('a', '2026-09-29')] }));
    expect(d.byPerson).toEqual([]);
  });

  it('gives a helper only their own tasks plus a count of unassigned ones', () => {
    const d = buildWeeklyDigest(
      base({
        viewerId: 'maria',
        isOwner: false,
        openTasks: [
          task('mine', '2026-09-29', { assigneeUserId: 'maria' }),
          task('sams', '2026-09-29', { assigneeUserId: 'sam' }),
          task('free1', '2026-09-30'),
          task('free2', '2026-10-01'),
          task('mylate', '2026-09-20', { assigneeUserId: 'maria' }),
          task('samlate', '2026-09-20', { assigneeUserId: 'sam' })
        ]
      })
    );
    expect(d.dueThisWeek.map((l) => l.id)).toEqual(['mine']);
    expect(d.overdue.map((l) => l.id)).toEqual(['mylate']);
    expect(d.unassignedCount).toBe(2);
    expect(d.byPerson).toEqual([]);
  });

  it('never shows a spray task by its title (F3-4)', () => {
    const d = buildWeeklyDigest(
      base({
        openTasks: [
          task('s', '2026-09-29', {
            title: 'Glyphosate 32 oz per acre, mix step 2',
            isSpray: true,
            where: 'North field'
          })
        ]
      })
    );
    expect(d.dueThisWeek[0].text).toBe(SPRAY_TASK_LABEL);
    const text = digestCardText(buildDigestCard(d, { asOf: NOW }));
    expect(text).toContain('Spray task, North field, See the Spray Card');
    expect(text).not.toMatch(/oz|per acre|mix step|Glyphosate/i);
  });

  it('hides a spray title or a rate typed without the spray category', () => {
    const d = buildWeeklyDigest(
      base({
        openTasks: [
          task('r', '2026-09-29', { title: 'Spray Roundup 2 qt per acre', where: 'Bed 1' }),
          task('u', '2026-09-30', { title: 'Side-dress 2 lb urea per 100 ft' }),
          task('ok', '2026-09-30', { title: 'Turn the compost' })
        ],
        careDue: [task('c', '2026-09-30', { title: 'Deworm the goats 1 ml per 11 lb' })]
      })
    );
    const texts = d.dueThisWeek.map((l) => l.text);
    expect(texts).toEqual([SPRAY_TASK_LABEL, 'Task, details on the Task Card', 'Turn the compost']);
    expect(d.careDue[0].text).toBe('Animal care task');
    const text = digestCardText(buildDigestCard(d, { asOf: NOW }));
    expect(text).toContain('Spray task, Bed 1, See the Spray Card');
    expect(text).toContain('Task, details on the Task Card, See the Task Card');
    expect(text).not.toMatch(/Roundup|urea|qt|\blb\b|\bml\b/i);
  });

  it('prints every line when asked for the full list', () => {
    const openTasks = Array.from({ length: 16 }, (_, i) => task(`t${i}`, '2026-09-30'));
    const d = buildWeeklyDigest(base({ openTasks }));
    const capped = buildDigestCard(d, { asOf: NOW });
    expect(capped.sections.find((s) => s.title === 'This week')!.items.at(-1)).toBe('And 8 more');
    const full = buildDigestCard(d, { asOf: NOW, listLimit: Number.POSITIVE_INFINITY });
    expect(full.sections.find((s) => s.title === 'This week')!.items).toHaveLength(16);
  });

  it('counts last week from closed tasks, time and harvests; a helper sees only their own', () => {
    const input = base({
      openTasks: [],
      closedTasks: [
        task('d1', '2026-09-22', { completedAt: Date.parse('2026-09-23T15:00:00Z') }),
        task('d2', '2026-09-22', {
          completedAt: Date.parse('2026-09-24T15:00:00Z'),
          assigneeUserId: 'maria'
        }),
        task('s1', '2026-09-22', { abortedAt: Date.parse('2026-09-25T15:00:00Z') }),
        task('old', '2026-09-10', { completedAt: Date.parse('2026-09-12T15:00:00Z') }),
        task('now', '2026-09-28', { completedAt: Date.parse('2026-09-28T13:00:00Z') })
      ],
      timeEntries: [
        { userId: 'owner', minutes: 30, atMs: Date.parse('2026-09-22T15:00:00Z') },
        { userId: 'maria', minutes: 90, atMs: Date.parse('2026-09-23T15:00:00Z') },
        { userId: 'maria', minutes: 45, atMs: Date.parse('2026-09-15T15:00:00Z') }
      ],
      harvestsAt: [Date.parse('2026-09-26T15:00:00Z'), Date.parse('2026-09-14T15:00:00Z')],
      people: { owner: 'Pat', maria: 'Maria' }
    });
    const owner = buildWeeklyDigest(input);
    expect(owner.lastWeek).toMatchObject({
      fromYmd: '2026-09-21',
      toYmd: '2026-09-27',
      done: 2,
      skipped: 1,
      minutes: 120,
      harvests: 1
    });
    expect(owner.lastWeek?.minutesByPerson.map((p) => [p.name, p.count])).toEqual([
      ['Maria', 90],
      ['Pat', 30]
    ]);
    const helper = buildWeeklyDigest({ ...input, viewerId: 'maria', isOwner: false });
    expect(helper.lastWeek).toMatchObject({ done: 1, skipped: 0, minutes: 90 });
    expect(helper.lastWeek?.minutesByPerson).toEqual([]);
  });

  it('keeps last week null when the caller has no such rows (the /today card)', () => {
    expect(buildWeeklyDigest(base()).lastWeek).toBeNull();
  });

  it('carries cash for an owner only', () => {
    const cash = { incomeCents: 12_000, expenseCents: 4_550, netCents: 7_450 };
    expect(buildWeeklyDigest(base({ cash })).cash).toEqual(cash);
    expect(buildWeeklyDigest(base({ cash, viewerId: 'maria', isOwner: false })).cash).toBeNull();
  });

  it('lists animal care titles due by Sunday', () => {
    const d = buildWeeklyDigest(
      base({
        careDue: [
          task('c1', '2026-09-30', { title: 'Deworm goats' }),
          task('c2', '2026-10-12', { title: 'Hoof trim' })
        ]
      })
    );
    expect(d.careDue.map((l) => l.text)).toEqual(['Deworm goats']);
    expect(d.careDueCount).toBe(1);
  });
});

describe('push body (F4-7)', () => {
  it('is short and money-free', () => {
    const d = buildWeeklyDigest(
      base({
        openTasks: [task('a', '2026-09-29'), task('b', '2026-09-20')],
        cash: { incomeCents: 99_999, expenseCents: 1, netCents: 99_998 }
      })
    );
    expect(digestPushBody(d)).toBe('Your week: 1 task, 1 overdue');
  });
});

describe('the digest Card (F4-9)', () => {
  it('is a record-only digest card keyed on the Monday', () => {
    const card = buildDigestCard(buildWeeklyDigest(base()), { asOf: NOW });
    expect(card.key).toBe(digestCardKey(MONDAY));
    expect(parseCardKey(card.key)).toEqual({ kind: 'digest', id: MONDAY });
    expect(RECORD_ONLY_CARD_KINDS).toContain('digest');
    expect(card.href).toBe('/today');
  });

  it("shows money only on an owner's copy with cash", () => {
    const cash = { incomeCents: 123_456, expenseCents: 2_000, netCents: 121_456 };
    const owner = digestCardText(buildDigestCard(buildWeeklyDigest(base({ cash })), { asOf: NOW }));
    expect(owner).toContain('Income: $1,234.56');
    expect(owner).toContain('Net: $1,214.56');
    const helper = digestCardText(
      buildDigestCard(buildWeeklyDigest(base({ cash, viewerId: 'm', isOwner: false })), {
        asOf: NOW
      })
    );
    expect(helper).not.toMatch(MONEY);
  });

  it('formats hours', () => {
    expect(digestHours(45)).toBe('45 min');
    expect(digestHours(90)).toBe('1.5 h');
    expect(digestHours(125)).toBe('2 h');
    expect(digestHours(140)).toBe('2.25 h');
  });
});

describe('properties', () => {
  const ids = ['owner', 'maria', 'sam', 'lee'];
  const dayArb = fc
    .integer({ min: -35, max: 14 })
    .map((n) => new Date(day(MONDAY) + n * 86_400_000).toISOString().slice(0, 10));
  const taskArb = fc.record({
    id: fc.uuid(),
    ymd: dayArb,
    assignee: fc.option(fc.constantFrom(...ids), { nil: null }),
    spray: fc.boolean(),
    closed: fc.boolean()
  });

  it('a helper never sees another person’s task, a spray title, money or safety wording', () => {
    fc.assert(
      fc.property(
        fc.array(taskArb, { maxLength: 30 }),
        fc.constantFrom('maria', 'sam', 'lee'),
        fc.integer({ min: 0, max: 5 }),
        (rows, viewer, low) => {
          const tasks = rows.map((r) =>
            task(r.id, r.ymd, {
              title: r.spray ? 'Liberty 29 oz per acre' : `Weed bed ${r.id.slice(0, 4)}`,
              isSpray: r.spray,
              assigneeUserId: r.assignee,
              completedAt: r.closed ? day(r.ymd) + 3_600_000 : null
            })
          );
          const d = buildWeeklyDigest(
            base({
              viewerId: viewer,
              isOwner: false,
              openTasks: tasks,
              closedTasks: tasks.filter((t) => t.completedAt != null),
              lowStockCount: low,
              cash: { incomeCents: 5_000, expenseCents: 1_000, netCents: 4_000 }
            })
          );
          for (const l of [...d.dueThisWeek, ...d.overdue]) {
            const t = tasks.find((x) => x.id === l.id)!;
            expect(t.assigneeUserId).toBe(viewer);
            if (t.isSpray) expect(l.text).toBe(SPRAY_TASK_LABEL);
          }
          const text = digestCardText(buildDigestCard(d, { asOf: NOW }));
          expect(text).not.toMatch(MONEY);
          expect(text).not.toMatch(/oz per acre/);
          expect(
            `${text}\n${digestPushBody(d)}`.replace(
              /Safety alerts are not in this summary\. They still come on their own\./,
              ''
            )
          ).not.toMatch(SAFETY);
        }
      )
    );
  });

  it('owner counts add up: per-person counts sum to the week total', () => {
    fc.assert(
      fc.property(fc.array(taskArb, { maxLength: 30 }), (rows) => {
        const tasks = rows.map((r) => task(r.id, r.ymd, { assigneeUserId: r.assignee }));
        const d = buildWeeklyDigest(base({ openTasks: tasks }));
        if (d.byPerson.length > 0) {
          expect(d.byPerson.reduce((n, p) => n + p.count, 0)).toBe(d.dueThisWeekCount);
        }
      })
    );
  });
});

describe('cashForDays', () => {
  it('sums by farm-local day', () => {
    const entries = [
      {
        kind: 'income' as const,
        amountCents: 1000,
        occurredAt: Date.parse('2026-09-21T12:00:00Z')
      },
      // 01:00 UTC on the 28th is still the 27th in New York.
      {
        kind: 'expense' as const,
        amountCents: 300,
        occurredAt: Date.parse('2026-09-28T01:00:00Z')
      },
      { kind: 'income' as const, amountCents: 999, occurredAt: Date.parse('2026-09-28T12:00:00Z') }
    ];
    expect(cashForDays(entries, '2026-09-21', '2026-09-27', TZ)).toEqual({
      incomeCents: 1000,
      expenseCents: 300,
      netCents: 700
    });
  });
});

describe('isSprayTask', () => {
  it('matches spray category and the three spray record tables', () => {
    expect(isSprayTask({ category: 'spray' })).toBe(true);
    expect(isSprayTask({ relatedEventTable: 'fungicide_event' })).toBe(true);
    expect(isSprayTask({ relatedEventTable: 'insecticide_event' })).toBe(true);
    expect(isSprayTask({ category: 'harvest', relatedEventTable: 'harvest_event' })).toBe(false);
    expect(isSprayTask({ relatedEventTable: 'spray_event', title: 'pre emergent: Dual' })).toBe(
      true
    );
    expect(isSprayTask({ title: 'Spray Roundup' })).toBe(true);
    expect(isSprayTask({ title: 'post-emergent: Liberty' })).toBe(true);
    expect(isSprayTask({ title: 'Turn the compost' })).toBe(false);
  });
});
