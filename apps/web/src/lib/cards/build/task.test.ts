import { describe, expect, it } from 'vitest';
import { buildCard } from './index';
import { buildTaskCard, buildTaskCardFromSnapshot } from './task';
import { sampleSnapshot } from './fixtures';

const prefs = { timeZone: 'America/New_York', units: 'us' as const };
const now = Date.parse('2026-06-04T16:00:00Z');

describe('buildTaskCard', () => {
  const base = {
    id: 't1',
    title: 'Stake + prune suckers',
    category: 'prune' as const,
    scheduledFor: Date.parse('2026-06-02T14:00:00Z'),
    blockId: 'b_bed3'
  };

  it('a late job: kicker, derived status pill and plain facts', () => {
    const card = buildTaskCard(
      base,
      { where: 'Cherokee Purple tomato · Bed 3', asOf: now, href: '/plan?block=b_bed3' },
      { now, prefs }
    );
    expect(card.kind).toBe('task');
    expect(card.key).toBe('tk_t1');
    expect(card.kicker).toBe('Task · Prune');
    expect(card.title).toBe('Stake + prune suckers');
    expect(card.status).toEqual({ id: 'late', label: 'Late', tone: 'rust' });
    expect(card.facts).toEqual([
      { label: 'When', value: 'Was due Tue, Jun 2' },
      { label: 'Where', value: 'Cherokee Purple tomato · Bed 3', provenance: 'data' }
    ]);
    expect(card.href).toBe('/plan?block=b_bed3');
    expect(card.provenance).toEqual([{ source: 'data', detail: 'your task list' }]);
  });

  it('status follows the stamps and the queue, never a stored value', () => {
    const today = { ...base, scheduledFor: Date.parse('2026-06-04T20:00:00Z') };
    expect(buildTaskCard(today, { asOf: now }, { now, prefs }).status?.id).toBe('due-today');
    expect(buildTaskCard(today, { asOf: now }, { now, prefs }).facts[0].value).toBe('Today');
    const tomorrow = { ...base, scheduledFor: Date.parse('2026-06-05T20:00:00Z') };
    expect(buildTaskCard(tomorrow, { asOf: now }, { now, prefs }).status?.label).toBe('Planned');
    const queued = buildTaskCard(base, { asOf: now, queued: 'complete' }, { now, prefs });
    expect(queued.status).toEqual({ id: 'done', label: 'Done', tone: 'forest' });
  });

  it('a skipped job keeps its reason as a manual fact', () => {
    const card = buildTaskCard(
      { ...base, abortedAt: now - 3_600_000, abortReason: '  rain all week ' },
      { asOf: now },
      { now, prefs }
    );
    expect(card.status?.id).toBe('skipped');
    expect(card.facts).toContainEqual({
      label: 'Why skipped',
      value: 'rain all week',
      provenance: 'manual'
    });
    expect(card.facts[0].value).toBe('Skipped Jun 4');
  });

  it('prep, follow-up and notes become sections; calendar tasks cite the plugin', () => {
    const card = buildTaskCard(
      {
        ...base,
        kind: 'pre-task',
        category: 'other',
        body: 'Bring twine',
        pluginTemplateKey: 'crop:tomato:pre:stake'
      },
      { asOf: now, before: ['Sharpen pruners'], after: ['Burn prunings'], equipmentLabel: 'Cart' },
      { now, prefs }
    );
    expect(card.kicker).toBe('Get ready');
    expect(card.sections).toEqual([
      { title: 'Notes', items: ['Bring twine'] },
      { title: 'Get ready', items: ['Sharpen pruners'] },
      { title: 'Follow-up', items: ['Burn prunings'] }
    ]);
    expect(card.facts).toContainEqual({ label: 'Equipment', value: 'Cart' });
    expect(card.provenance).toEqual([{ source: 'plugin', detail: 'crop calendar' }]);
    expect(card.href).toBe('/cards/task/tk_t1');
  });
});

describe('task cards from the offline snapshot', () => {
  const base = {
    id: 't1',
    title: 'Stake + prune suckers',
    scheduledFor: Date.parse('2026-06-02T14:00:00Z')
  };
  const snap = sampleSnapshot();

  it('builds an open task by key, naming its planting and bed', () => {
    const card = buildTaskCardFromSnapshot(snap, 't_stake', { prefs, now })!;
    expect(card.title).toBe('Stake + prune suckers');
    expect(card.status?.id).toBe('due-today');
    expect(card.facts.find((f) => f.label === 'Where')?.value).toBe(
      'Cherokee Purple tomato · Bed 3'
    );
    expect(buildCard(snap, 'tk_t_stake', { prefs, now })).toEqual(card);
    expect(card.href).toBe('/cards/task/tk_t_stake');
    expect(card.links).toEqual([
      { label: 'Planting card, care and photo help', href: '/cards/planting/pl_p_tom' }
    ]);
  });

  it('finds the bed through the planting when the task names none', () => {
    const card = buildTaskCardFromSnapshot(snap, 't_scout', { prefs, now })!;
    expect(card.facts.find((f) => f.label === 'Where')?.value).toContain('Bed 3');
  });

  it('a task on a planting links to its Planting Card; one without a planting links nowhere', () => {
    const onPlanting = buildTaskCard(
      { ...base, cropId: 'p_tom' },
      { asOf: now },
      { now, prefs }
    );
    expect(onPlanting.links).toEqual([
      { label: 'Planting card, care and photo help', href: '/cards/planting/pl_p_tom' }
    ]);
    expect(buildTaskCard(base, { asOf: now }, { now, prefs }).links).toBeUndefined();
  });

  it('unknown ids build nothing', () => {
    expect(buildTaskCardFromSnapshot(snap, 'nope')).toBeNull();
    expect(buildCard(snap, 'tk_nope')).toBeNull();
  });
});
