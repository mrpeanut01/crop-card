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
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Subset of CalendarEvent kinds we surface as a priority action. The rest
 *  are passive (stage transitions, emergence) and don't deserve a hero card. */
const DERIVED_TONE_MAP: Record<string, PriorityAction['toneTag']> = {
  'spray-window': 'spray',
  'harvest-window': 'harvest',
  'cover-termination': 'planting',
  'orchard-task': 'task',
  'seasonal-task': 'task',
  'curing-ready': 'harvest'
};

function startOfToday(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function ctaForTask(task: Task): { href: string; label: string } {
  switch (task.relatedEventTable) {
    case 'spray_event':
      return { href: '/spray', label: 'Open spray flow' };
    case 'insecticide_event':
      return { href: '/spray/insecticide', label: 'Open spray flow' };
    case 'fungicide_event':
      return { href: '/spray/fungicide', label: 'Open spray flow' };
    case 'harvest_event':
      return { href: '/harvest', label: 'Record harvest' };
    case 'hay_cutting':
      return { href: '/hay', label: 'Open hay flow' };
    default:
      return { href: '/today', label: 'Mark done' };
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

function ctaForDerived(kind: string): { href: string; label: string } {
  switch (kind) {
    case 'spray-window':
      return { href: '/spray', label: 'Open spray flow' };
    case 'scout-cadence':
      return { href: '/scout', label: 'Start scouting' };
    case 'harvest-window':
      return { href: '/harvest', label: 'Record harvest' };
    default:
      return { href: '/plan', label: 'Schedule task' };
  }
}

export interface DerivePriorityInputs {
  openPrimaries: Task[];
  derivedEvents: CalendarEvent[];
  /** Block lookup so we can stamp a friendly scope label. */
  blockNameById: Map<string, string>;
  now?: number;
}

export function derivePriorityAction(inputs: DerivePriorityInputs): PriorityAction | null {
  const now = inputs.now ?? Date.now();
  const dayStart = startOfToday(now);
  const tomorrowEnd = dayStart + 2 * DAY_MS;

  const candidates = [...inputs.openPrimaries]
    .filter((t) => t.scheduledFor < tomorrowEnd)
    .sort((a, b) => a.scheduledFor - b.scheduledFor);

  const top = candidates[0];
  if (top) {
    const cta = ctaForTask(top);
    const overdueDays =
      top.scheduledFor < dayStart
        ? Math.floor((dayStart - top.scheduledFor) / DAY_MS)
        : undefined;
    const blockName = top.blockId ? inputs.blockNameById.get(top.blockId) : undefined;
    const scope: Array<[string, string]> = [];
    if (blockName) scope.push(['Block', blockName]);
    if (top.equipmentId) scope.push(['Equipment', top.equipmentId]);
    scope.push([
      'Scheduled',
      new Date(top.scheduledFor).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      })
    ]);
    return {
      kind: 'task',
      title: top.title,
      body: top.body,
      toneTag: toneForTask(top),
      scope,
      ctaHref: cta.href,
      ctaLabel: cta.label,
      blockId: top.blockId,
      overdueDays
    };
  }

  // Fall back to a derived event opening today (only user-actionable kinds).
  const dayEvents = inputs.derivedEvents
    .filter((e) => e.startMs >= dayStart && e.startMs < dayStart + DAY_MS)
    .filter((e) => DERIVED_TONE_MAP[e.kind] !== undefined)
    .sort((a, b) => a.startMs - b.startMs);
  const ev = dayEvents[0];
  if (ev) {
    const cta = ctaForDerived(ev.kind);
    const tone = DERIVED_TONE_MAP[ev.kind] ?? 'task';
    const blockName = ev.blockId ? inputs.blockNameById.get(ev.blockId) : undefined;
    const scope: Array<[string, string]> = [];
    if (blockName) scope.push(['Block', blockName]);
    scope.push([
      'Window closes',
      new Date(ev.endMs).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      })
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
