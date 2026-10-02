/**
 * The Monday summary as a Card (F4-9), used for the email body and print.
 * Record-only: never in the offline snapshot, and `/c/dg_<monday>` opens
 * /today. Money appears only when the digest carries it, which only the
 * owner's email does.
 */

import { numberFormat } from '$lib/intlCache';
import { t } from '$lib/i18n';
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
  /** The reader's language; unset is English. */
  locale?: string | null;
}

const USD: Intl.NumberFormatOptions = { style: 'currency', currency: 'USD' };

function money(cents: number): string {
  return numberFormat('en-US', USD).format(cents / 100);
}

export function digestCardKey(weekStartYmd: string): string {
  return cardKey('digest', weekStartYmd);
}

export function buildDigestCard(d: WeeklyDigest, opts: DigestCardOptions): CardModel {
  const loc = opts.locale;
  const cap = (items: string[]) => limited(items, opts.listLimit ?? DIGEST_LIST_LIMIT, loc);
  const line = (l: Parameters<typeof digestLineText>[0]) =>
    digestLineText(l, { withAssignee: d.isOwner }, loc);
  const facts: CardFact[] = [
    {
      label: t(loc, d.isOwner ? 'digest.card.tasksThisWeek' : 'digest.card.yourTasksThisWeek'),
      value: String(d.dueThisWeekCount),
      provenance: 'data'
    },
    { label: t(loc, 'digest.card.overdue'), value: String(d.overdueCount), provenance: 'data' }
  ];
  if (!d.isOwner && d.unassignedCount > 0) {
    facts.push({
      label: t(loc, 'digest.card.notAssigned'),
      value: String(d.unassignedCount),
      provenance: 'data'
    });
  }
  if (d.careDueCount > 0) {
    facts.push({
      label: t(loc, 'digest.card.animalCare'),
      value: String(d.careDueCount),
      provenance: 'data'
    });
  }
  if (d.lowStockCount > 0) {
    facts.push({
      label: t(loc, 'digest.card.runningLow'),
      value: String(d.lowStockCount),
      provenance: 'data'
    });
  }

  const sections: CardSection[] = [];
  if (d.overdue.length > 0) {
    sections.push({
      title: t(loc, 'digest.card.overdue'),
      items: cap(d.overdue.map(line)),
      provenance: 'data'
    });
  }
  sections.push({
    title: t(loc, d.isOwner ? 'digest.card.thisWeek' : 'digest.card.yourWeek'),
    items:
      d.dueThisWeek.length > 0
        ? cap(d.dueThisWeek.map(line))
        : [t(loc, 'digest.card.nothingThisWeek')],
    provenance: 'data'
  });
  if (d.isOwner && d.byPerson.length > 0) {
    sections.push({
      title: t(loc, 'digest.card.whoHasWhat'),
      items: d.byPerson.map((p) =>
        t(loc, 'digest.card.personTasks', { name: p.name, count: p.count })
      ),
      provenance: 'data'
    });
  }
  if (d.careDue.length > 0) {
    sections.push({
      title: t(loc, 'digest.card.animalCare'),
      items: cap(
        d.careDue.map((l) =>
          t(loc, 'digest.card.dayLine', { day: shortDay(l.dueYmd, loc), text: l.text })
        )
      ),
      provenance: 'data'
    });
  }
  const lw = d.lastWeek;
  if (lw) {
    const items = [
      t(loc, d.isOwner ? 'digest.card.tasksFinished' : 'digest.card.yourTasksFinished', {
        count: lw.done
      }),
      ...(lw.skipped > 0 ? [t(loc, 'digest.card.skipped', { count: lw.skipped })] : [])
    ];
    if (lw.minutes !== null && lw.minutes > 0) {
      items.push(
        t(loc, d.isOwner ? 'digest.card.timeLogged' : 'digest.card.yourTimeLogged', {
          time: digestHours(lw.minutes, loc)
        })
      );
      if (d.isOwner && lw.minutesByPerson.length > 1) {
        for (const p of lw.minutesByPerson) {
          items.push(t(loc, 'digest.card.personTime', { name: p.name, time: digestHours(p.count, loc) }));
        }
      }
    }
    if (lw.harvests !== null && lw.harvests > 0) {
      items.push(t(loc, 'digest.card.harvests', { count: lw.harvests }));
    }
    sections.push({
      title: t(loc, 'digest.card.lastWeek', {
        from: shortDay(lw.fromYmd, loc),
        to: shortDay(lw.toYmd, loc)
      }),
      items,
      provenance: 'data'
    });
  }
  if (d.isOwner && d.cash) {
    sections.push({
      title: t(loc, 'digest.card.money'),
      items: [
        t(loc, 'digest.card.income', { amount: money(d.cash.incomeCents) }),
        t(loc, 'digest.card.expenses', { amount: money(d.cash.expenseCents) }),
        t(loc, 'digest.card.net', { amount: money(d.cash.netCents) })
      ],
      provenance: 'manual'
    });
  }

  const kicker = [
    t(loc, 'digest.card.weekOf', { day: shortDay(d.weekStartYmd, loc) }),
    ...(opts.farmName ? [opts.farmName] : []),
    ...(!d.isOwner && opts.viewerName ? [opts.viewerName] : [])
  ].join(' · ');

  return {
    kind: 'digest',
    key: digestCardKey(d.weekStartYmd),
    kicker,
    title: t(loc, 'digest.card.title'),
    facts,
    sections,
    asOf: opts.asOf,
    provenance: [
      { source: 'data', detail: t(loc, 'digest.card.fromRecords') },
      ...(d.cash ? [{ source: 'manual' as const, detail: t(loc, 'digest.card.fromLedger') }] : [])
    ],
    href: DIGEST_HREF,
    notices: [t(loc, 'digest.card.safetyNotice')]
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
