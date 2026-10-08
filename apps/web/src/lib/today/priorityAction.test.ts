import { describe, it, expect } from 'vitest';
import { derivePriorityAction } from './priorityAction';
import type { Task } from '$lib/db/tasks';
import type { CalendarEvent } from '$lib/calendar/engine';

const NOW = new Date('2026-05-24T15:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const dayStart = Date.UTC(2026, 4, 24);

function task(over: Partial<Task>): Task {
  return {
    id: over.id ?? 't1',
    title: over.title ?? 'Scout Block A',
    body: over.body,
    kind: 'primary',
    scheduledFor: over.scheduledFor ?? NOW,
    userOverridden: false,
    staleAnchor: false,
    createdAt: NOW,
    relatedEventTable: over.relatedEventTable,
    blockId: over.blockId,
    equipmentId: over.equipmentId,
    ...over
  };
}

function ev(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    kind: 'spray-window',
    blockId: 'block-1',
    cropPluginId: 'crop:tomato',
    varietyDisplayName: 'Tomato',
    startMs: over.startMs ?? NOW,
    endMs: over.endMs ?? NOW + DAY,
    title: over.title ?? 'Spray window opens',
    ...over
  };
}

const blocks = new Map([
  ['block-1', 'Block A'],
  ['block-2', 'Block B']
]);

describe('derivePriorityAction', () => {
  it('returns null when nothing is open', () => {
    expect(
      derivePriorityAction({
        openPrimaries: [],
        derivedEvents: [],
        blockNameById: blocks,
        now: NOW
      })
    ).toBeNull();
  });

  it('prefers overdue tasks over today tasks', () => {
    const result = derivePriorityAction({
      openPrimaries: [
        task({ id: 't-today', title: 'Today task', scheduledFor: NOW }),
        task({ id: 't-overdue', title: 'Overdue task', scheduledFor: NOW - 3 * DAY })
      ],
      derivedEvents: [],
      blockNameById: blocks,
      now: NOW
    });
    expect(result?.title).toBe('Overdue task');
    // Due May 21, today is May 24 in the owner's zone.
    expect(result?.overdueDays).toBe(3);
  });

  it('falls back to today derived event if no tasks are due', () => {
    const result = derivePriorityAction({
      openPrimaries: [],
      derivedEvents: [
        ev({
          kind: 'spray-window',
          startMs: dayStart,
          title: 'Herbicide window opens'
        })
      ],
      blockNameById: blocks,
      now: NOW
    });
    expect(result?.kind).toBe('derived');
    expect(result?.title).toBe('Herbicide window opens');
    expect(result?.ctaHref).toBe('/spray');
  });

  it('ignores non-actionable derived events (stage transitions, emergence)', () => {
    const result = derivePriorityAction({
      openPrimaries: [],
      derivedEvents: [
        ev({ kind: 'emergence', title: 'Emergence', startMs: NOW }),
        ev({ kind: 'stage-window', title: 'V8', startMs: NOW })
      ],
      blockNameById: blocks,
      now: NOW
    });
    expect(result).toBeNull();
  });

  it('routes spray-flavored tasks to /spray flow with the right tone', () => {
    const result = derivePriorityAction({
      openPrimaries: [
        task({
          id: 't',
          title: 'Apply Roundup',
          relatedEventTable: 'spray_event',
          blockId: 'block-1'
        })
      ],
      derivedEvents: [],
      blockNameById: blocks,
      now: NOW
    });
    expect(result?.ctaHref).toBe('/spray');
    expect(result?.toneTag).toBe('spray');
    expect(result?.scope).toContainEqual(['Block', 'Block A']);
  });

  it('labels a day-granular task by its calendar day, not a zone-shifted one', () => {
    const result = derivePriorityAction({
      openPrimaries: [task({ scheduledFor: Date.UTC(2026, 4, 24) })],
      derivedEvents: [],
      blockNameById: blocks,
      now: NOW
    });
    expect(result?.scope).toContainEqual(['Scheduled', 'Sun, May 24']);
  });

  it("judges today in the owner's zone, not the server's", () => {
    // 9 PM in New York on May 24 is already May 25 in UTC.
    const evening = Date.parse('2026-05-25T01:00:00Z');
    const result = derivePriorityAction({
      openPrimaries: [task({ scheduledFor: Date.UTC(2026, 4, 24) })],
      derivedEvents: [],
      blockNameById: blocks,
      now: evening,
      timeZone: 'America/New_York'
    });
    expect(result?.overdueDays).toBeUndefined();
    expect(result?.scope).toContainEqual(['Scheduled', 'Sun, May 24']);
  });

  it('labels a timed task by its day in the owner zone', () => {
    const result = derivePriorityAction({
      openPrimaries: [task({ scheduledFor: Date.parse('2026-05-25T01:00:00Z') })],
      derivedEvents: [],
      blockNameById: blocks,
      now: Date.parse('2026-05-24T15:00:00Z'),
      timeZone: 'America/New_York'
    });
    expect(result?.overdueDays).toBeUndefined();
    expect(result?.scope).toContainEqual(['Scheduled', 'Sun, May 24']);
  });

  it('leaves out tasks due after tomorrow in the owner zone', () => {
    const result = derivePriorityAction({
      openPrimaries: [task({ scheduledFor: Date.UTC(2026, 4, 27) })],
      derivedEvents: [],
      blockNameById: blocks,
      now: Date.parse('2026-05-26T03:00:00Z'),
      timeZone: 'America/New_York'
    });
    expect(result).toBeNull();
  });

  it('routes insecticide tasks to /spray/insecticide', () => {
    const result = derivePriorityAction({
      openPrimaries: [task({ relatedEventTable: 'insecticide_event' })],
      derivedEvents: [],
      blockNameById: blocks,
      now: NOW
    });
    expect(result?.ctaHref).toBe('/spray/insecticide');
  });

  it('routes harvest tasks to /harvest', () => {
    const result = derivePriorityAction({
      openPrimaries: [task({ relatedEventTable: 'harvest_event' })],
      derivedEvents: [],
      blockNameById: blocks,
      now: NOW
    });
    expect(result?.ctaHref).toBe('/harvest');
    expect(result?.toneTag).toBe('harvest');
    expect(result?.markDone).toBeUndefined();
  });

  it('marks a plain task for the Done sheet (F1-12)', () => {
    const result = derivePriorityAction({
      openPrimaries: [task({ relatedEventTable: undefined })],
      derivedEvents: [],
      blockNameById: blocks,
      now: NOW
    });
    expect(result?.ctaLabel).toBe('Mark done');
    expect(result?.markDone).toBe(true);
  });

  it('shows the year on a due day from an earlier year (#747)', () => {
    const result = derivePriorityAction({
      openPrimaries: [task({ scheduledFor: Date.UTC(2025, 9, 8) })],
      derivedEvents: [],
      blockNameById: blocks,
      now: NOW
    });
    expect(result?.scope).toContainEqual(['Scheduled', 'Wed, Oct 8, 2025']);
    expect(result?.overdueDays).toBe(228);
  });
});
