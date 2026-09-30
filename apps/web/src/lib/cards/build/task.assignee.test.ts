import { describe, expect, it } from 'vitest';
import { buildPlantingCard } from './planting';
import { buildTaskCard, buildTaskCardFromSnapshot } from './task';
import { sampleSnapshot } from './fixtures';

const prefs = { timeZone: 'America/New_York', units: 'us' as const };
const now = Date.parse('2026-06-04T16:00:00Z');

describe('"Assigned to" on task cards (F1-10, F1-11)', () => {
  const base = { id: 't1', title: 'Weed bed 3', scheduledFor: now };

  it('shows the name as a fact when set and nothing when not', () => {
    const given = buildTaskCard(base, { asOf: now, assignee: 'Maria' }, { now, prefs });
    expect(given.facts).toContainEqual({ label: 'Assigned to', value: 'Maria' });
    const open = buildTaskCard(base, { asOf: now }, { now, prefs });
    expect(open.facts.some((f) => f.label === 'Assigned to')).toBe(false);
  });

  it('offline, the snapshot’s people supply the name; absent means unassigned', () => {
    const snap = sampleSnapshot();
    snap.people = [{ id: 'u_maria', name: 'Maria' }];
    snap.tasks = snap.tasks.map((t) => (t.id === 't_stake' ? { ...t, assigneeUserId: 'u_maria' } : t));
    const card = buildTaskCardFromSnapshot(snap, 't_stake', { prefs, now })!;
    expect(card.facts).toContainEqual({ label: 'Assigned to', value: 'Maria' });
    const other = buildTaskCardFromSnapshot(snap, 't_scout', { prefs, now })!;
    expect(other.facts.some((f) => f.label === 'Assigned to')).toBe(false);

    const old = sampleSnapshot();
    delete old.people;
    old.tasks = old.tasks.map((t) => ({ ...t, assigneeUserId: 'u_gone' }));
    const fallback = buildTaskCardFromSnapshot(old, 't_stake', { prefs, now })!;
    expect(fallback.facts.some((f) => f.label === 'Assigned to')).toBe(false);
  });
});

describe('"Time logged" on the Planting Card (F1-17)', () => {
  it('shows the total as data, and nothing when no time was logged', () => {
    const snap = sampleSnapshot();
    const none = buildPlantingCard(snap, 'p_tom', { prefs, now })!;
    expect(none.facts.some((f) => f.label === 'Time logged')).toBe(false);
    snap.plantings = snap.plantings.map((p) => (p.id === 'p_tom' ? { ...p, minutesLogged: 390 } : p));
    const card = buildPlantingCard(snap, 'p_tom', { prefs, now })!;
    expect(card.facts).toContainEqual({ label: 'Time logged', value: '6.5 h', provenance: 'data' });
  });
});
