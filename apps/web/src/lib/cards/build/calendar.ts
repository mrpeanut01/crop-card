import { firstDayOfWeek } from '$lib/intlCache';
import { dueYmd, formatCalendarDate, ymdInZone } from '$lib/prefs';
import { t, t as translate } from '$lib/i18n';
import {
  cardHref,
  cardKey,
  cardShortUrl,
  type CardCalendar,
  type CardCalendarDay,
  type CardCalendarEntry,
  type CardFact,
  type CardKind,
  type CardModel
} from '../model';
import type { FarmSnapshot, SnapshotTask } from '../snapshot';
import {
  addDaysYmd,
  areaDisplayName,
  blockDisplayName,
  resolveOptions,
  sortTasks,
  ymdToUtcMs,
  type BuildOptions,
  type ResolvedOptions
} from './common';
import { isCalibratedGpa, sprayCardId } from './spray';
import {
  PRINTED_MIX_PATTERN,
  PRINTED_RATE_PATTERN,
  TASK_DETAILS_HINT,
  TASK_DETAILS_TEXT,
  isSprayTaskLike,
  unsafeOnPaper
} from '$lib/tasks/printSafe';

const DAY_MS = 86_400_000;
/** Bundles saved before 32F carry no `taskWindow`; they were cut at this. */
const LEGACY_PAST_DAYS = 14;
const LEGACY_FUTURE_DAYS = 30;

export const WEEK_PER_DAY = 12;
export const MONTH_PER_DAY = 4;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

export const OUTSIDE_WINDOW_NOTE =
  'Week and Month Cards cover the last two weeks and the next two months. See this period in Today.';
export const EARLIER_DAYS_NOTE = 'Earlier days are not on this card.';

export function outsideWindowNote(locale?: string | null): string {
  return t(locale, 'cards.cal.outsideWindow');
}

/** /today's Week or Month view for the period a Week or Month Card key
 *  names (`wk_2027-05-03`, `mo_2027-05`); /today when the key is not one. */
export function periodTodayHref(kind: string, key: string): string {
  const id = key.slice(key.indexOf('_') + 1);
  if (kind === 'week' && /^\d{4}-\d{2}-\d{2}$/.test(id)) return `/today?view=week&at=${id}`;
  if (kind === 'month' && /^\d{4}-\d{2}$/.test(id)) return `/today?view=month&at=${id}-01`;
  return '/today';
}

/** English keeps the hand-built names; other languages use `Intl`. */
function intlDates(locale: string | null | undefined): locale is string {
  return !!locale && locale !== 'en';
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export { PRINTED_MIX_PATTERN, PRINTED_RATE_PATTERN };

export interface CalendarFilters {
  /** Keep tasks whose block is in this Area. */
  area?: string | null;
  /** A user id, or `unassigned`. */
  who?: string | null;
}

export interface CalendarBuildOptions extends BuildOptions, CalendarFilters {
  /** 0 = Sunday. Defaults to the one /today's calendar uses. */
  firstDay?: number;
}

export function defaultFirstDay(): number {
  return firstDayOfWeek('en-US');
}

export function startOfWeekYmd(ymd: string, firstDay: number): string {
  const ms = ymdToUtcMs(ymd)!;
  const back = (new Date(ms).getUTCDay() - firstDay + 7) % 7;
  return addDaysYmd(ymd, -back)!;
}

export function monthName(ym: string, locale?: string | null): string {
  if (intlDates(locale))
    return capitalize(
      formatCalendarDate(`${ym}-01`, 'date', { month: 'long', day: undefined }, locale)
    );
  return `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

function shortMonthDay(ymd: string, locale?: string | null): string {
  if (intlDates(locale)) return formatCalendarDate(ymd, 'month-day', {}, locale);
  return `${MONTHS[Number(ymd.slice(5, 7)) - 1].slice(0, 3)} ${Number(ymd.slice(8, 10))}`;
}

export function weekRangeLabel(fromYmd: string, toYmd: string, locale?: string | null): string {
  const sameMonth = fromYmd.slice(0, 7) === toYmd.slice(0, 7);
  if (intlDates(locale)) {
    const from = sameMonth ? `${Number(fromYmd.slice(8, 10))}` : shortMonthDay(fromYmd, locale);
    return t(locale, 'cards.cal.range', { from, to: shortMonthDay(toYmd, locale) });
  }
  if (sameMonth)
    return t(locale, 'cards.cal.range', {
      from: shortMonthDay(fromYmd),
      to: `${Number(toYmd.slice(8, 10))}`
    });
  return t(locale, 'cards.cal.range', { from: shortMonthDay(fromYmd), to: shortMonthDay(toYmd) });
}

function weekdayOf(ymd: string): number {
  return new Date(ymdToUtcMs(ymd)!).getUTCDay();
}

function weekdayName(ymd: string, locale?: string | null): string {
  return intlDates(locale)
    ? formatCalendarDate(ymd, 'weekday', {}, locale)
    : WEEKDAYS[weekdayOf(ymd)];
}

/** "Mon Oct 5" ("lun, 5 oct" in Spanish). */
export function calendarDayLabel(ymd: string, locale?: string | null): string {
  if (intlDates(locale))
    return formatCalendarDate(ymd, 'month-day', { weekday: 'short' }, locale);
  return `${WEEKDAYS[weekdayOf(ymd)]} ${shortMonthDay(ymd)}`;
}

/** First and last day whose open tasks the snapshot holds in full. */
export function completeDays(
  snapshot: FarmSnapshot,
  timeZone: string
): { firstYmd: string; lastYmd: string } {
  const w = snapshot.taskWindow ?? {
    fromMs: snapshot.generatedAt - LEGACY_PAST_DAYS * DAY_MS,
    toMs: snapshot.generatedAt + LEGACY_FUTURE_DAYS * DAY_MS
  };
  return {
    firstYmd: addDaysYmd(ymdInZone(w.fromMs, timeZone), 1)!,
    lastYmd: addDaysYmd(ymdInZone(w.toMs, timeZone), -1)!
  };
}

function shortName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function taskBlockId(snapshot: FarmSnapshot, t: SnapshotTask): string | null {
  if (t.blockId) return t.blockId;
  const planting = t.cropId ? snapshot.plantings.find((p) => p.id === t.cropId) : undefined;
  return planting?.blockId ?? null;
}

function whereText(
  snapshot: FarmSnapshot,
  t: SnapshotTask,
  locale?: string | null
): string | undefined {
  const blockId = taskBlockId(snapshot, t);
  const block = blockId ? snapshot.blocks.find((b) => b.id === blockId) : undefined;
  if (!block) return undefined;
  const area = block.areaId ? snapshot.areas.find((a) => a.id === block.areaId) : undefined;
  const parts = [area && areaDisplayName(area, locale), blockDisplayName(block, locale)].filter(
    (p): p is string => !!p
  );
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  return unique.length ? unique.join(', ') : undefined;
}

function isSprayTask(t: SnapshotTask): boolean {
  return isSprayTaskLike(t);
}

function isCareTask(t: SnapshotTask): boolean {
  return (t.category as string | null) === 'animal-care';
}

/** The Spray Card a spray task should point at: its sprayer's card when
 *  it names one that is uncalibrated or has a single product, else the
 *  task's own card, which leads to the right one. */
export function sprayCardKeyFor(snapshot: FarmSnapshot, t: SnapshotTask): string {
  const sprayer = t.equipmentId
    ? snapshot.equipment.find((e) => e.id === t.equipmentId && e.type === 'sprayer')
    : undefined;
  if (sprayer) {
    if (!isCalibratedGpa(sprayer.state?.calibratedGpa)) return cardKey('spray', sprayer.id);
    const products = Object.keys(snapshot.sprayProducts ?? {});
    if (products.length === 1) return cardKey('spray', sprayCardId(sprayer.id, products[0]));
  }
  return cardKey('task', t.id);
}

export function calendarEntry(
  snapshot: FarmSnapshot,
  t: SnapshotTask,
  todayYmd: string,
  timeZone: string,
  locale?: string | null
): CardCalendarEntry {
  const overdue = dueYmd(t.scheduledFor, timeZone) < todayYmd || undefined;
  const person = t.assigneeUserId
    ? snapshot.people?.find((p) => p.id === t.assigneeUserId)
    : undefined;
  const who = person ? shortName(person.name) : undefined;
  if (isCareTask(t)) {
    const text = unsafeOnPaper(t.title) ? translate(locale, 'cards.cal.careTask') : t.title;
    return { text, ...(who ? { who } : {}), ...(overdue ? { overdue } : {}) };
  }
  let where = whereText(snapshot, t, locale);
  if (where && unsafeOnPaper(where)) where = undefined;
  if (isSprayTask(t)) {
    const key = sprayCardKeyFor(snapshot, t);
    return {
      text: translate(locale, 'cards.cal.sprayTask'),
      ...(where ? { where } : {}),
      ...(who ? { who } : {}),
      ...(overdue ? { overdue } : {}),
      see: translate(
        locale,
        key.startsWith('sp_') ? 'cards.cal.seeSprayCard' : 'cards.cal.seeTaskSprayCard'
      ),
      seeUrl: cardShortUrl(snapshot.origin, key)
    };
  }
  if (unsafeOnPaper(t.title)) {
    return {
      text: locale ? translate(locale, 'cards.cal.taskDetails') : TASK_DETAILS_TEXT,
      ...(where ? { where } : {}),
      ...(who ? { who } : {}),
      ...(overdue ? { overdue } : {}),
      see: locale ? translate(locale, 'cards.cal.taskDetailsHint') : TASK_DETAILS_HINT,
      seeUrl: cardShortUrl(snapshot.origin, cardKey('task', t.id))
    };
  }
  return {
    text: t.title,
    ...(where ? { where } : {}),
    ...(who ? { who } : {}),
    ...(overdue ? { overdue } : {})
  };
}

export interface FilteredTasks {
  tasks: SnapshotTask[];
  farmWideHidden: number;
}

export function filterCalendarTasks(
  snapshot: FarmSnapshot,
  tasks: readonly SnapshotTask[],
  filters: CalendarFilters
): FilteredTasks {
  let farmWideHidden = 0;
  const out: SnapshotTask[] = [];
  for (const t of tasks) {
    if (filters.who) {
      const assignee = t.assigneeUserId ?? null;
      if (filters.who === 'unassigned' ? assignee !== null : assignee !== filters.who) continue;
    }
    if (filters.area) {
      const blockId = taskBlockId(snapshot, t);
      const block = blockId ? snapshot.blocks.find((b) => b.id === blockId) : undefined;
      if (!block) {
        farmWideHidden += 1;
        continue;
      }
      if (block.areaId !== filters.area) continue;
    }
    out.push(t);
  }
  return { tasks: out, farmWideHidden };
}

function filterLabels(
  snapshot: FarmSnapshot,
  filters: CalendarFilters,
  opts: ResolvedOptions
): string[] {
  const { tr } = opts;
  const out: string[] = [];
  if (filters.area) {
    const area = snapshot.areas.find((a) => a.id === filters.area);
    out.push(area ? areaDisplayName(area, opts.prefs.locale) : tr('cards.cal.oneArea'));
  }
  if (filters.who === 'unassigned') out.push(tr('cards.cal.unassigned'));
  else if (filters.who) {
    const person = snapshot.people?.find((p) => p.id === filters.who);
    out.push(
      person ? tr('cards.cal.forPerson', { name: shortName(person.name) }) : tr('cards.cal.forOne')
    );
  }
  return out;
}

interface PeriodSpec {
  kind: Extract<CardKind, 'week' | 'month'>;
  keyId: string;
  /** Grid rows, each seven days. */
  weeks: string[][];
  /** The days that belong to the period (a week, or the month's days). */
  firstYmd: string;
  lastYmd: string;
  title: string;
  kickerDates: string;
  perDay: number;
  dayLabel: (ymd: string, locale?: string | null) => string;
}

function buildPeriodCard(
  snapshot: FarmSnapshot,
  spec: PeriodSpec,
  options: CalendarBuildOptions
): CardModel | null {
  const opts = resolveOptions(snapshot, options);
  const { tr } = opts;
  const loc = opts.prefs.locale;
  const tz = opts.prefs.timeZone;
  const today = ymdInZone(opts.now, tz);
  const window = completeDays(snapshot, tz);
  if (spec.lastYmd > window.lastYmd || spec.lastYmd < window.firstYmd) return null;

  const filters: CalendarFilters = { area: options.area ?? null, who: options.who ?? null };
  const inPeriod = sortTasks(snapshot.tasks).filter((t) => {
    const ymd = dueYmd(t.scheduledFor, tz);
    return ymd >= spec.firstYmd && ymd <= spec.lastYmd && ymd >= window.firstYmd;
  });
  const { tasks, farmWideHidden } = filterCalendarTasks(snapshot, inPeriod, filters);

  const byDay = new Map<string, CardCalendarEntry[]>();
  for (const t of tasks) {
    const ymd = dueYmd(t.scheduledFor, tz);
    const list = byDay.get(ymd) ?? [];
    list.push(calendarEntry(snapshot, t, today, tz, loc));
    byDay.set(ymd, list);
  }

  let earlierShown = false;
  const weeks: CardCalendarDay[][] = spec.weeks.map((row) =>
    row.map((ymd) => {
      const within = ymd >= spec.firstYmd && ymd <= spec.lastYmd;
      const earlier = within && ymd < window.firstYmd;
      if (earlier) earlierShown = true;
      return {
        ymd,
        label: spec.dayLabel(ymd, loc),
        inPeriod: within,
        earlier,
        today: ymd === today,
        entries: within ? (byDay.get(ymd) ?? []) : []
      };
    })
  );
  const overflow = weeks.some((row) => row.some((d) => d.entries.length > spec.perDay));
  const calendar: CardCalendar = {
    period: spec.kind,
    weekdays: spec.weeks[0].map((ymd) => weekdayName(ymd, loc)),
    weeks,
    perDay: spec.perDay,
    overflow
  };

  const overdueCount = tasks.filter((t) => dueYmd(t.scheduledFor, tz) < today).length;
  const facts: CardFact[] = [
    {
      label: tr('cards.cal.openTasks'),
      value: tasks.length ? `${tasks.length}` : tr('cards.nothingScheduled'),
      provenance: 'data'
    }
  ];
  if (overdueCount)
    facts.push({ label: tr('cards.overdue'), value: `${overdueCount}`, provenance: 'data' });

  const notices: string[] = [];
  if (earlierShown) notices.push(tr('cards.cal.earlierDays'));
  const olderOpen = snapshot.taskWindow?.olderOpen ?? 0;
  if (olderOpen > 0 && (earlierShown || (spec.firstYmd <= today && today <= spec.lastYmd)))
    notices.push(
      tr('cards.cal.olderOpen', {
        count: olderOpen,
        date: shortMonthDay(window.firstYmd, loc)
      })
    );
  if (farmWideHidden) notices.push(tr('cards.cal.farmWideHidden', { count: farmWideHidden }));
  if (tasks.some((t) => isSprayTask(t)))
    notices.push(tr('cards.cal.sprayNotice'));

  const key = cardKey(spec.kind, spec.keyId);
  const kicker = [
    spec.kind === 'week' ? tr('cards.cal.week') : tr('cards.cal.month'),
    spec.kickerDates,
    ...filterLabels(snapshot, filters, opts)
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    kind: spec.kind,
    key,
    kicker,
    title: spec.title,
    facts,
    sections: [],
    asOf: snapshot.generatedAt,
    provenance: [{ source: 'data', detail: tr('cards.prov.taskList') }],
    href: cardHref(spec.kind, key),
    ...(notices.length ? { notices } : {}),
    calendar
  };
}

export function buildWeekPeriodCard(
  snapshot: FarmSnapshot,
  anyDayYmd: string,
  options: CalendarBuildOptions = {}
): CardModel | null {
  if (ymdToUtcMs(anyDayYmd) === null) return null;
  const firstDay = options.firstDay ?? defaultFirstDay();
  const from = startOfWeekYmd(anyDayYmd, firstDay);
  const row = Array.from({ length: 7 }, (_, i) => addDaysYmd(from, i)!);
  const to = row[6];
  const loc = resolveOptions(snapshot, options).prefs.locale;
  return buildPeriodCard(
    snapshot,
    {
      kind: 'week',
      keyId: from,
      weeks: [row],
      firstYmd: from,
      lastYmd: to,
      title: t(loc, 'cards.cal.weekOf', { date: shortMonthDay(from, loc) }),
      kickerDates: weekRangeLabel(from, to, loc),
      perDay: WEEK_PER_DAY,
      dayLabel: calendarDayLabel
    },
    options
  );
}

const YM = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function buildMonthPeriodCard(
  snapshot: FarmSnapshot,
  ym: string,
  options: CalendarBuildOptions = {}
): CardModel | null {
  if (!YM.test(ym)) return null;
  const firstDay = options.firstDay ?? defaultFirstDay();
  const first = `${ym}-01`;
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const gridFrom = startOfWeekYmd(first, firstDay);
  const loc = resolveOptions(snapshot, options).prefs.locale;
  const weeks: string[][] = [];
  for (let start = gridFrom; start <= last; start = addDaysYmd(start, 7)!) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDaysYmd(start, i)!));
  }
  return buildPeriodCard(
    snapshot,
    {
      kind: 'month',
      keyId: ym,
      weeks,
      firstYmd: first,
      lastYmd: last,
      title: monthName(ym, loc),
      kickerDates: '',
      perDay: MONTH_PER_DAY,
      dayLabel: (ymd) => `${Number(ymd.slice(8, 10))}`
    },
    options
  );
}

/** Every string a printed Week or Month Card shows, for the no-rates test. */
export function printedCalendarText(card: CardModel): string[] {
  const out = [card.kicker, card.title, ...(card.notices ?? [])];
  for (const f of card.facts) out.push(f.label, f.value);
  for (const row of card.calendar?.weeks ?? [])
    for (const d of row) {
      out.push(d.label);
      for (const e of d.entries)
        out.push(e.text, e.where ?? '', e.who ?? '', e.see ?? '', e.seeUrl ?? '');
    }
  return out.filter(Boolean);
}

/** Days back and ahead of today a fresh snapshot holds in full; mirrors
 *  SNAPSHOT_TASK_PAST_DAYS and SNAPSHOT_TASK_FUTURE_DAYS less the partial
 *  day at each end. */
export const PRINTABLE_PAST_DAYS = 13;
export const PRINTABLE_FUTURE_DAYS = 61;
export const PRINT_RANGE_NOTE = 'Printing covers the last two weeks and the next two months.';

export function printRangeNote(locale?: string | null): string {
  return t(locale, 'cards.cal.printRange');
}

/** Whether a /today Week or Month view can be printed from the saved Cards,
 *  using the same test the Card builder uses (its last day inside the window). */
export function periodPrintable(
  view: 'week' | 'month',
  anchorYmd: string,
  todayYmd: string,
  firstDay = defaultFirstDay()
): boolean {
  let lastYmd: string;
  if (view === 'week') {
    lastYmd = addDaysYmd(startOfWeekYmd(anchorYmd, firstDay), 6)!;
  } else {
    const y = Number(anchorYmd.slice(0, 4));
    const m = Number(anchorYmd.slice(5, 7));
    lastYmd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  return (
    lastYmd >= addDaysYmd(todayYmd, -PRINTABLE_PAST_DAYS)! &&
    lastYmd <= addDaysYmd(todayYmd, PRINTABLE_FUTURE_DAYS)!
  );
}

/** Where a /today Week or Month view's Print button goes: that period's
 *  Card with `?print=1`, carrying /today's Mine filter as the viewer's id. */
export function periodCardPrintHref(
  view: 'week' | 'month',
  anchorYmd: string,
  opts: { who?: string | null; viewerId?: string | null; area?: string | null } = {}
): string {
  const kind = view === 'week' ? 'week' : 'month';
  const key = cardKey(kind, view === 'week' ? anchorYmd : anchorYmd.slice(0, 7));
  const q = new URLSearchParams({ print: '1' });
  if (opts.area) q.set('area', opts.area);
  if (opts.who === 'mine' && opts.viewerId) q.set('who', opts.viewerId);
  else if (opts.who && opts.who !== 'all' && opts.who !== 'mine') q.set('who', opts.who);
  return `${cardHref(kind, key)}?${q.toString()}`;
}
