import { describe, it, expect } from 'vitest';
import { derivePriorityAction } from './priorityAction';
import type { Task } from '$lib/db/tasks';
import type { CalendarEvent } from '$lib/calendar/engine';

const NOW = new Date('2026-05-24T15:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const dayStart = (() => {
  const d = new Date(NOW);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
})();

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
    // 3 days before NOW (15:00), but dayStart (today midnight) is only
    // 2 full days after the task's scheduledFor — that's "2 days late"
    // in the user-perceived sense.
    expect(result?.overdueDays).toBe(2);
  });

  it('falls back to today derived event if no tasks are due', () => {
    const result = derivePriorityAction({
      openPrimaries: [],
      derivedEvents: [
        ev({
          kind: 'spray-window',
          startMs: dayStart + 3 * 60 * 60 * 1000,
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
  });
});
