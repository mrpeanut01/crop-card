/**
 * Phase 32F (F4-8). The Monday summary card on /today. Built only from the
 * rows the loader already read (`ctx.digest`), so it adds no queries. Shown
 * on the viewer's Monday to everyone who can see /today, opted in or not:
 * it is an on-screen card, not a message. Never any money.
 */

import { ymdInZone } from '$lib/prefs';
import { weekdayOfYmd } from '$lib/today/views';
import type { TodayAdviceCard, TodayAdviceContext } from '$lib/today/advice';
import { t } from '$lib/i18n';
import { buildWeeklyDigest, type WeeklyDigest } from './weekly';

export const DIGEST_PRINT_HREF = '/today/digest';

export function digestCardLines(d: WeeklyDigest, locale?: string | null): string[] {
  const lines: string[] = [];
  const due = t(locale, d.isOwner ? 'digest.today.dueOwner' : 'digest.today.dueHelper', {
    count: d.dueThisWeekCount
  });
  lines.push(
    d.overdueCount > 0
      ? t(locale, 'digest.today.dueOverdue', { due, count: d.overdueCount })
      : t(locale, 'digest.today.dueOnly', { due })
  );
  if (d.isOwner && d.byPerson.length > 0) {
    lines.push(
      d.byPerson
        .map((p) => t(locale, 'digest.today.personCount', { name: p.name, count: p.count }))
        .join(', ') + '.'
    );
  }
  if (!d.isOwner && d.unassignedCount > 0) {
    lines.push(t(locale, 'digest.today.unassigned', { count: d.unassignedCount }));
  }
  if (d.careDue.length > 0) {
    const titles = d.careDue
      .slice(0, 3)
      .map((l) => l.text)
      .join(', ');
    lines.push(
      d.careDue.length > 3
        ? t(locale, 'digest.today.careMore', { titles, count: d.careDue.length - 3 })
        : t(locale, 'digest.today.care', { titles })
    );
  }
  if (d.lowStockCount > 0) {
    lines.push(t(locale, 'digest.today.lowStock', { count: d.lowStockCount }));
  }
  return lines;
}

export async function digestAdvice(ctx: TodayAdviceContext): Promise<TodayAdviceCard[]> {
  const input = ctx.digest;
  if (!input) return [];
  const zone = input.viewerTimeZone ?? ctx.timeZone ?? 'America/New_York';
  const today = ymdInZone(ctx.nowMs, zone);
  if (weekdayOfYmd(today) !== 1) return [];
  const digest = buildWeeklyDigest({
    viewerId: input.viewerId,
    isOwner: input.isOwner,
    weekStartYmd: today,
    timeZone: zone,
    nowMs: ctx.nowMs,
    openTasks: input.openTasks,
    careDue: input.careDue,
    lowStockCount: input.lowStockCount,
    locale: ctx.locale
  });
  const actions: TodayAdviceCard['actions'] = [
    { kind: 'link', label: t(ctx.locale, 'digest.today.print'), href: DIGEST_PRINT_HREF }
  ];
  if (input.isOwner) {
    actions.push({ kind: 'link', label: t(ctx.locale, 'digest.today.money'), href: '/finance' });
  }
  return [
    {
      id: `digest:${today}`,
      kind: 'digest',
      title: t(ctx.locale, 'digest.today.title'),
      lines: digestCardLines(digest, ctx.locale),
      provenance: 'data',
      detail: t(ctx.locale, 'digest.today.detail'),
      tone: 'info',
      actions,
      sortKey: -1000
    }
  ];
}
