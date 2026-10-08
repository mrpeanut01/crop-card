/**
 * /today priority-action derivation (Phase 25e · #97).
 *
 * Picks the ONE thing to do today out of the open task list + the
 * calendar-engine derived events. The hero card on /today renders this.
 *
 * Ranking (highest first):
 *   1. Overdue open primary task
 *   2. Open primary task scheduled today
 *   3. Open primary task scheduled tomorrow
 *   4. Derived event whose window opens today (spray-window, scout-cadence,
 *      harvest-ready)
 *   5. null — nothing is more important than anything else; UI shows
 *      "All caught up" empty state.
 */

import type { CalendarEvent } from '$lib/calendar/engine';
import type { Task } from '$lib/db/tasks';
import { DEFAULT_TIME_ZONE } from '$lib/profile';
import { dueYmd, formatDueDay, withYearIfOther, ymdInZone } from '$lib/prefs';
import { t } from '$lib/i18n';
import { taskDisplayBody, taskDisplayTitle } from '$lib/tasks/title';

export type PriorityActionKind = 'task' | 'derived';

export interface PriorityAction {
  kind: PriorityActionKind;
  /** Short imperative title — renders as the serif H2. */
  title: string;
  /** One-paragraph explanation. May reference scout counts, frost dates, etc. */
  body?: string;
  /** "today · do this first" pill tone — drives the chemistry-class chip. */
  toneTag: 'scout' | 'spray' | 'harvest' | 'fertility' | 'planting' | 'task';
  /** Scope key/value pairs rendered in the bottom band of the hero card. */
  scope: Array<[string, string]>;
  /** Primary CTA href ("Start scouting", "Open spray flow", etc.). */
  ctaHref: string;
  /** CTA label. */
  ctaLabel: string;
  /** Block this action targets, if any — drives the Provenance "your records" badge. */
  blockId?: string;
  /** Overdue by N days, if applicable. */
  overdueDays?: number;
  /** Task row id when kind==='task' — drives the Skip-with-reason flow (#104). */
  taskId?: string;
  /** A plain task with no flow of its own: the CTA opens the Done sheet
   *  instead of following `ctaHref` (F1-12). */
  markDone?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Subset of CalendarEvent kinds we surface as a priority action. The rest
 *  are passive (stage transitions, emergence) and don't deserve a hero card. */
const DERIVED_TONE_MAP: Record<string, PriorityAction['toneTag']> = {
  'spray-window': 'spray',
  'harvest-window': 'harvest',
  'cover-termination': 'planting',
  'seasonal-task': 'task',
  'curing-ready': 'harvest'
};

function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(toYmd) - Date.parse(fromYmd)) / DAY_MS);
}

function ctaForTask(
  task: Task,
  locale: string | null | undefined
): { href: string; label: string; markDone?: boolean } {
  const openSpray = t(locale, 'today.pa.cta.openSpray');
  switch (task.relatedEventTable) {
    case 'spray_event':
      return { href: '/spray', label: openSpray };
    case 'insecticide_event':
      return { href: '/spray/insecticide', label: openSpray };
    case 'fungicide_event':
      return { href: '/spray/fungicide', label: openSpray };
    case 'harvest_event':
      return { href: '/harvest', label: t(locale, 'today.pa.cta.recordHarvest') };
    case 'hay_cutting':
      return { href: '/hay', label: t(locale, 'today.pa.cta.openHay') };
    default:
      return { href: '/today', label: t(locale, 'today.pa.cta.markDone'), markDone: true };
  }
}

function toneForTask(task: Task): PriorityAction['toneTag'] {
  switch (task.relatedEventTable) {
    case 'spray_event':
    case 'insecticide_event':
    case 'fungicide_event':
      return 'spray';
    case 'harvest_event':
    case 'hay_cutting':
      return 'harvest';
    case 'fertility_application':
      return 'fertility';
    default:
      return 'task';
  }
}

function ctaForDerived(
  kind: string,
  locale: string | null | undefined
): { href: string; label: string } {
  switch (kind) {
    case 'spray-window':
      return { href: '/spray', label: t(locale, 'today.pa.cta.openSpray') };
    case 'scout-cadence':
      return { href: '/scout', label: t(locale, 'today.pa.cta.startScouting') };
    case 'harvest-window':
      return { href: '/harvest', label: t(locale, 'today.pa.cta.recordHarvest') };
    default:
      return { href: '/plan', label: t(locale, 'today.pa.cta.scheduleTask') };
  }
}

export interface DerivePriorityInputs {
  openPrimaries: Task[];
  derivedEvents: CalendarEvent[];
  /** Block lookup so we can stamp a friendly scope label. */
  blockNameById: Map<string, string>;
  now?: number;
  /** The viewer's language for the CTA and scope labels; English when unset. */
  locale?: string | null;
  /** The owner's zone: what "today" is and which day a timed task falls on. */
  timeZone?: string;
}

export function derivePriorityAction(inputs: DerivePriorityInputs): PriorityAction | null {
  const now = inputs.now ?? Date.now();
  const locale = inputs.locale;
  const timeZone = inputs.timeZone ?? DEFAULT_TIME_ZONE;
  const prefs = { timeZone, units: 'us' as const, locale: locale ?? undefined };
  const today = ymdInZone(now, timeZone);

  const candidates = [...inputs.openPrimaries]
    .filter((t) => daysBetweenYmd(today, dueYmd(t.scheduledFor, timeZone)) <= 1)
    .sort((a, b) => a.scheduledFor - b.scheduledFor);

  const top = candidates[0];
  if (top) {
    const cta = ctaForTask(top, locale);
    const late = daysBetweenYmd(dueYmd(top.scheduledFor, timeZone), today);
    const overdueDays = late > 0 ? late : undefined;
    const blockName = top.blockId ? inputs.blockNameById.get(top.blockId) : undefined;
    const scope: Array<[string, string]> = [];
    if (blockName) scope.push([t(locale, 'today.pa.scope.block'), blockName]);
    if (top.equipmentId) scope.push([t(locale, 'today.pa.scope.equipment'), top.equipmentId]);
    scope.push([
      t(locale, 'today.pa.scope.scheduled'),
      formatDueDay(
        top.scheduledFor,
        prefs,
        'month-day',
        withYearIfOther(dueYmd(top.scheduledFor, timeZone), today, { weekday: 'short' })
      )
    ]);
    return {
      kind: 'task',
      title: taskDisplayTitle(top, locale),
      body: taskDisplayBody(top, locale),
      toneTag: toneForTask(top),
      scope,
      ctaHref: cta.href,
      ctaLabel: cta.label,
      blockId: top.blockId,
      overdueDays,
      taskId: top.id,
      ...(cta.markDone ? { markDone: true } : {})
    };
  }

  // Fall back to a derived event opening today (only user-actionable kinds).
  const dayEvents = inputs.derivedEvents
    .filter((e) => dueYmd(e.startMs, timeZone) === today)
    .filter((e) => DERIVED_TONE_MAP[e.kind] !== undefined)
    .sort((a, b) => a.startMs - b.startMs);
  const ev = dayEvents[0];
  if (ev) {
    const cta = ctaForDerived(ev.kind, locale);
    const tone = DERIVED_TONE_MAP[ev.kind] ?? 'task';
    const blockName = ev.blockId ? inputs.blockNameById.get(ev.blockId) : undefined;
    const scope: Array<[string, string]> = [];
    if (blockName) scope.push([t(locale, 'today.pa.scope.block'), blockName]);
    scope.push([
      t(locale, 'today.pa.scope.windowCloses'),
      formatDueDay(ev.endMs, prefs, 'month-day', { weekday: 'short' })
    ]);
    return {
      kind: 'derived',
      title: ev.title,
      body: undefined,
      toneTag: tone,
      scope,
      ctaHref: cta.href,
      ctaLabel: cta.label,
      blockId: ev.blockId
    };
  }

  return null;
}
