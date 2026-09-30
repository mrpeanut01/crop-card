/**
 * Phase 32F (F4-8). The Monday summary card on /today. Built only from the
 * rows the loader already read (`ctx.digest`), so it adds no queries. Shown
 * on the viewer's Monday to everyone who can see /today, opted in or not:
 * it is an on-screen card, not a message. Never any money.
 */

import { ymdInZone } from '$lib/prefs';
import { weekdayOfYmd } from '$lib/today/views';
import type { TodayAdviceCard, TodayAdviceContext } from '$lib/today/advice';
import { buildWeeklyDigest, type WeeklyDigest } from './weekly';

export const DIGEST_PRINT_HREF = '/today/digest';

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function digestCardLines(d: WeeklyDigest): string[] {
  const lines: string[] = [];
  const due = d.isOwner
    ? `${count(d.dueThisWeekCount, 'task', 'tasks')} due this week`
    : `${count(d.dueThisWeekCount, 'task', 'tasks')} for you this week`;
  lines.push(d.overdueCount > 0 ? `${due}, ${d.overdueCount} overdue.` : `${due}.`);
  if (d.isOwner && d.byPerson.length > 0) {
    lines.push(d.byPerson.map((p) => `${p.name}: ${p.count}`).join(', ') + '.');
  }
  if (!d.isOwner && d.unassignedCount > 0) {
    lines.push(
      `${count(d.unassignedCount, 'more task is', 'more tasks are')} not assigned to anyone.`
    );
  }
  if (d.careDue.length > 0) {
    const titles = d.careDue.slice(0, 3).map((l) => l.text);
    const more = d.careDue.length > 3 ? ` and ${d.careDue.length - 3} more` : '';
    lines.push(`Animal care: ${titles.join(', ')}${more}.`);
  }
  if (d.lowStockCount > 0) {
    lines.push(`${count(d.lowStockCount, 'item is', 'items are')} running low.`);
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
    lowStockCount: input.lowStockCount
  });
  const actions: TodayAdviceCard['actions'] = [
    { kind: 'link', label: 'Print this summary', href: DIGEST_PRINT_HREF }
  ];
  if (input.isOwner) {
    actions.push({ kind: 'link', label: "See last week's money", href: '/finance' });
  }
  return [
    {
      id: `digest:${today}`,
      kind: 'digest',
      title: 'Your week',
      lines: digestCardLines(digest),
      provenance: 'data',
      detail: 'From your task list',
      tone: 'info',
      actions,
      sortKey: -1000
    }
  ];
}
