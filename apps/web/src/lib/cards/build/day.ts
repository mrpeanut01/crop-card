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

function where(snapshot: FarmSnapshot, t: SnapshotTask): string {
  const planting = t.cropId ? snapshot.plantings.find((p) => p.id === t.cropId) : undefined;
  const blockId = t.blockId ?? planting?.blockId ?? null;
  const block = blockId ? snapshot.blocks.find((b) => b.id === blockId) : undefined;
  const parts = [planting?.varietyDisplayName, block && blockDisplayName(block)].filter(Boolean);
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

function capped(items: string[]): string[] {
  return items.length > MAX_ITEMS
    ? [...items.slice(0, MAX_ITEMS), `+${items.length - MAX_ITEMS} more`]
    : items;
}

function dayTitle(ymd: string, today: string): string {
  const diff = daysBetweenYmd(today, ymd);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return formatCalendarDate(ymd, 'date-long', { year: undefined });
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
  const today = ymdInZone(opts.now, opts.prefs.timeZone);
  const due = tasksOn(snapshot, ymd, opts);
  const overdue =
    ymd === today
      ? sortTasks(
          snapshot.tasks.filter((t) => ymdInZone(t.scheduledFor, opts.prefs.timeZone) < today)
        )
      : [];

  const facts: CardFact[] = [
    { label: 'Due', value: due.length ? `${due.length}` : 'Nothing scheduled', provenance: 'data' }
  ];
  if (overdue.length) facts.push({ label: 'Overdue', value: `${overdue.length}`, provenance: 'data' });

  const sections: CardSection[] = [];
  if (overdue.length) {
    sections.push({
      title: 'Overdue',
      items: capped(overdue.map((t) => `${t.title}${where(snapshot, t)}`))
    });
  }
  if (due.length) {
    sections.push({
      title: ymd === today ? 'Due today' : 'Due',
      items: capped(due.map((t) => `${t.title}${where(snapshot, t)}`))
    });
  }

  const provenance: CardProvenance[] = [{ source: 'data', detail: 'your task list' }];
  const key = cardKey('day', ymd);
  const date = formatCalendarDate(ymd, 'date-long', { year: undefined });
  return {
    kind: 'day',
    key,
    kicker: `Day · ${date}`,
    title: dayTitle(ymd, today),
    facts,
    next: nextAction([...overdue, ...due], opts),
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
