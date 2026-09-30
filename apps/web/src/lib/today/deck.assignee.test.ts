import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildTaskDeck, filterByAssignee, type DeckTaskLike } from './deck';

const NY = 'America/New_York';
const now = Date.parse('2026-06-04T16:00:00Z');
const due = Date.parse('2026-06-04T14:00:00Z');

type T = DeckTaskLike & { assigneeUserId?: string | null };

const t = (id: string, assigneeUserId: string | null, extra: Partial<T> = {}): T => ({
  id,
  kind: 'primary',
  scheduledFor: due,
  assigneeUserId,
  ...extra
});

describe('filterByAssignee (F1-8)', () => {
  const tasks: T[] = [
    t('mine', 'u1'),
    t('theirs', 'u2'),
    t('nobody', null),
    t('job', null),
    t('prepForMe', 'u1', { kind: 'pre-task', linkedToTaskId: 'job' })
  ];
  const deck = buildTaskDeck(tasks, { window: 'today', now, timeZone: NY });

  it('Mine keeps my jobs and jobs whose prep is mine, and counts the rest', () => {
    const out = filterByAssignee(deck, 'mine', 'u1');
    expect(out.shown.map((e) => e.task.id).sort()).toEqual(['job', 'mine']);
    expect(out.hiddenCount).toBe(2);
  });

  it('Everyone keeps everything', () => {
    const out = filterByAssignee(deck, 'all', 'u1');
    expect(out.shown).toHaveLength(deck.length);
    expect(out.hiddenCount).toBe(0);
  });

  it('never loses a card: shown plus hidden is the whole deck', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('u1', 'u2', null), { maxLength: 30 }),
        fc.constantFrom<'mine' | 'all'>('mine', 'all'),
        (who, mode) => {
          const d = buildTaskDeck(
            who.map((a, i) => t(`t${i}`, a)),
            { window: 'today', now, timeZone: NY }
          );
          const out = filterByAssignee(d, mode, 'u1');
          expect(out.shown.length + out.hiddenCount).toBe(d.length);
          if (mode === 'mine') for (const e of out.shown) expect(e.task.assigneeUserId).toBe('u1');
        }
      )
    );
  });
});
