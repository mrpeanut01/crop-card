/**
 * The Monday summary as a Card (F4-9), used for the email body and print.
 * Record-only: never in the offline snapshot, and `/c/dg_<monday>` opens
 * /today. Money appears only when the digest carries it, which only the
 * owner's email does.
 */

import { numberFormat } from '$lib/intlCache';
import {
  DIGEST_LIST_LIMIT,
  digestHours,
  digestLineText,
  limited,
  shortDay,
  type WeeklyDigest
} from '$lib/digest/weekly';
import { cardKey, type CardFact, type CardModel, type CardSection } from '../model';

export const DIGEST_HREF = '/today';

export interface DigestCardOptions {
  asOf: number;
  farmName?: string | null;
  /** The person's own name, for the kicker on a helper's copy. */
  viewerName?: string | null;
  /** Lines per list before "And N more". The printed page lists them all. */
  listLimit?: number;
}

const USD: Intl.NumberFormatOptions = { style: 'currency', currency: 'USD' };

function money(cents: number): string {
  return numberFormat('en-US', USD).format(cents / 100);
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function digestCardKey(weekStartYmd: string): string {
  return cardKey('digest', weekStartYmd);
}

export function buildDigestCard(d: WeeklyDigest, opts: DigestCardOptions): CardModel {
  const cap = (items: string[]) => limited(items, opts.listLimit ?? DIGEST_LIST_LIMIT);
  const facts: CardFact[] = [
    {
      label: d.isOwner ? 'Tasks this week' : 'Your tasks this week',
      value: String(d.dueThisWeekCount),
      provenance: 'data'
    },
    { label: 'Overdue', value: String(d.overdueCount), provenance: 'data' }
  ];
  if (!d.isOwner && d.unassignedCount > 0) {
    facts.push({
      label: 'Not assigned to anyone',
      value: String(d.unassignedCount),
      provenance: 'data'
    });
  }
  if (d.careDueCount > 0) {
    facts.push({ label: 'Animal care', value: String(d.careDueCount), provenance: 'data' });
  }
  if (d.lowStockCount > 0) {
    facts.push({ label: 'Running low', value: String(d.lowStockCount), provenance: 'data' });
  }

  const sections: CardSection[] = [];
  if (d.overdue.length > 0) {
    sections.push({
      title: 'Overdue',
      items: cap(d.overdue.map((l) => digestLineText(l, { withAssignee: d.isOwner }))),
      provenance: 'data'
    });
  }
  sections.push({
    title: d.isOwner ? 'This week' : 'Your week',
    items:
      d.dueThisWeek.length > 0
        ? cap(d.dueThisWeek.map((l) => digestLineText(l, { withAssignee: d.isOwner })))
        : ['Nothing on the task list for the rest of this week.'],
    provenance: 'data'
  });
  if (d.isOwner && d.byPerson.length > 0) {
    sections.push({
      title: 'Who has what',
      items: d.byPerson.map((p) => `${p.name}: ${count(p.count, 'task', 'tasks')}`),
      provenance: 'data'
    });
  }
  if (d.careDue.length > 0) {
    sections.push({
      title: 'Animal care',
      items: cap(d.careDue.map((l) => `${shortDay(l.dueYmd)}: ${l.text}`)),
      provenance: 'data'
    });
  }
  const lw = d.lastWeek;
  if (lw) {
    const items = [
      `${d.isOwner ? 'Tasks finished' : 'Your tasks finished'}: ${lw.done}`,
      ...(lw.skipped > 0 ? [`Skipped: ${lw.skipped}`] : [])
    ];
    if (lw.minutes !== null && lw.minutes > 0) {
      items.push(`${d.isOwner ? 'Time logged' : 'Your time logged'}: ${digestHours(lw.minutes)}`);
      if (d.isOwner && lw.minutesByPerson.length > 1) {
        for (const p of lw.minutesByPerson) items.push(`${p.name}: ${digestHours(p.count)}`);
      }
    }
    if (lw.harvests !== null && lw.harvests > 0) {
      items.push(`Harvests recorded: ${lw.harvests}`);
    }
    sections.push({
      title: `Last week (${shortDay(lw.fromYmd)} to ${shortDay(lw.toYmd)})`,
      items,
      provenance: 'data'
    });
  }
  if (d.isOwner && d.cash) {
    sections.push({
      title: 'Money last week',
      items: [
        `Income: ${money(d.cash.incomeCents)}`,
        `Expenses: ${money(d.cash.expenseCents)}`,
        `Net: ${money(d.cash.netCents)}`
      ],
      provenance: 'manual'
    });
  }

  const kicker = [
    `Week of ${shortDay(d.weekStartYmd)}`,
    ...(opts.farmName ? [opts.farmName] : []),
    ...(!d.isOwner && opts.viewerName ? [opts.viewerName] : [])
  ].join(' · ');

  return {
    kind: 'digest',
    key: digestCardKey(d.weekStartYmd),
    kicker,
    title: 'Your week',
    facts,
    sections,
    asOf: opts.asOf,
    provenance: [
      { source: 'data', detail: 'From your tasks, time and harvest records' },
      ...(d.cash ? [{ source: 'manual' as const, detail: 'Money you entered on the farm ledger' }] : [])
    ],
    href: DIGEST_HREF,
    notices: ['Safety alerts are not in this summary. They still come on their own.']
  };
}

/** The Card as plain text, for the email body. */
export function digestCardText(card: CardModel): string {
  const out: string[] = [card.kicker, ''];
  for (const f of card.facts) out.push(`${f.label}: ${f.value}`);
  for (const s of card.sections) {
    out.push('', s.title);
    for (const item of s.items) out.push(`- ${item}`);
  }
  if (card.notices?.length) out.push('', ...card.notices);
  return out.join('\n');
}
