import { formatCalendarDate, ymdInZone } from '$lib/prefs';
import {
  cardHref,
  cardKey,
  type CardFact,
  type CardModel,
  type CardProvenance,
  type CardSection
} from '../model';
import type { FarmSnapshot, SnapshotTask } from '../snapshot';
import {
  blockDisplayName,
  daysBetweenYmd,
  nextAction,
  resolveOptions,
  sortTasks,
  ymdToUtcMs,
  type BuildOptions,
  type ResolvedOptions
} from './common';

const MAX_ITEMS = 10;

function where(snapshot: FarmSnapshot, t: SnapshotTask, locale?: string | null): string {
  const planting = t.cropId ? snapshot.plantings.find((p) => p.id === t.cropId) : undefined;
  const blockId = t.blockId ?? planting?.blockId ?? null;
  const block = blockId ? snapshot.blocks.find((b) => b.id === blockId) : undefined;
  const parts = [planting?.varietyDisplayName, block && blockDisplayName(block, locale)].filter(
    Boolean
  );
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

function capped(items: string[], opts: ResolvedOptions): string[] {
  return items.length > MAX_ITEMS
    ? [...items.slice(0, MAX_ITEMS), opts.tr('cards.more', { count: items.length - MAX_ITEMS })]
    : items;
}

function dayTitle(ymd: string, today: string, opts: ResolvedOptions): string {
  const diff = daysBetweenYmd(today, ymd);
  if (diff === 0) return opts.tr('cards.day.today');
  if (diff === 1) return opts.tr('cards.day.tomorrow');
  if (diff === -1) return opts.tr('cards.day.yesterday');
  return capitalize(
    formatCalendarDate(ymd, 'date-long', { year: undefined }, opts.prefs.locale)
  );
}

/** Spanish dates start lowercase ("lunes, 5 de octubre"); a title doesn't. */
function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function tasksOn(snapshot: FarmSnapshot, ymd: string, opts: ResolvedOptions): SnapshotTask[] {
  return sortTasks(
    snapshot.tasks.filter((t) => ymdInZone(t.scheduledFor, opts.prefs.timeZone) === ymd)
  );
}

export function buildDayCard(
  snapshot: FarmSnapshot,
  ymd: string,
  options: BuildOptions = {}
): CardModel | null {
  if (ymdToUtcMs(ymd) === null) return null;
  const opts = resolveOptions(snapshot, options);
  const { tr } = opts;
  const loc = opts.prefs.locale;
  const today = ymdInZone(opts.now, opts.prefs.timeZone);
  const due = tasksOn(snapshot, ymd, opts);
  const overdue =
    ymd === today
      ? sortTasks(
          snapshot.tasks.filter((t) => ymdInZone(t.scheduledFor, opts.prefs.timeZone) < today)
        )
      : [];

  const facts: CardFact[] = [
    {
      label: tr('cards.day.due'),
      value: due.length ? `${due.length}` : tr('cards.nothingScheduled'),
      provenance: 'data'
    }
  ];
  if (overdue.length)
    facts.push({ label: tr('cards.overdue'), value: `${overdue.length}`, provenance: 'data' });

  const sections: CardSection[] = [];
  if (overdue.length) {
    sections.push({
      title: tr('cards.overdue'),
      items: capped(
        overdue.map((t) => `${t.title}${where(snapshot, t, loc)}`),
        opts
      )
    });
  }
  if (due.length) {
    sections.push({
      title: ymd === today ? tr('cards.day.dueToday') : tr('cards.day.due'),
      items: capped(
        due.map((t) => `${t.title}${where(snapshot, t, loc)}`),
        opts
      )
    });
  }

  const provenance: CardProvenance[] = [{ source: 'data', detail: tr('cards.prov.taskList') }];
  const key = cardKey('day', ymd);
  const date = formatCalendarDate(ymd, 'date-long', { year: undefined }, loc);
  return {
    kind: 'day',
    key,
    kicker: tr('cards.day.kicker', { date }),
    title: dayTitle(ymd, today, opts),
    facts,
    next: nextAction([...overdue, ...due], opts, snapshot.plantings),
    sections,
    asOf: snapshot.generatedAt,
    provenance,
    href: cardHref('day', key)
  };
}

/** Today plus the next `days - 1` days, from the snapshot's task window. */
export function buildDayCards(
  snapshot: FarmSnapshot,
  options: BuildOptions = {},
  days = 7
): CardModel[] {
  const opts = resolveOptions(snapshot, options);
  const start = ymdToUtcMs(ymdInZone(opts.now, opts.prefs.timeZone))!;
  const out: CardModel[] = [];
  for (let i = 0; i < days; i++) {
    const ymd = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const card = buildDayCard(snapshot, ymd, options);
    if (!card) continue;
    if (i > 0 && !tasksOn(snapshot, ymd, opts).length) continue;
    out.push(card);
  }
  return out;
}
