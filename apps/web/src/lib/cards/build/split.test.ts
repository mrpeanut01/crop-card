import { describe, expect, it } from 'vitest';
import { buildPlantingCard } from './planting';
import { buildAreaCard } from './area';
import { sampleSnapshot } from './fixtures';
import { snapshotSplitFor } from './split';
import type { FarmSnapshot } from '../snapshot';

const prefs = { timeZone: 'America/New_York', units: 'us' as const };
const now = Date.parse('2026-06-04T16:00:00Z');
const SG = 'sg_0f3c2a1b-test';

function splitSnapshot(blockIds: string[] = ['b_bed1', 'b_bed3']): FarmSnapshot {
  const base = sampleSnapshot();
  return {
    ...base,
    plantings: base.plantings.map((p) =>
      p.id === 'p_tom' || p.id === 'p_bean' ? { ...p, splitGroupId: SG } : p
    ),
    splitGroups: { [SG]: blockIds }
  };
}

describe('snapshotSplitFor', () => {
  it('reads beds when every part is in a garden or greenhouse Area', () => {
    const snap = splitSnapshot();
    const tom = snap.plantings.find((p) => p.id === 'p_tom')!;
    const split = snapshotSplitFor(snap, tom)!;
    expect(split.n).toBe(2);
    expect(split.noun).toBe('beds');
    expect(split.others.map((b) => b.id)).toEqual(['b_bed1']);
  });

  it('reads blocks when a part sits outside a bed Area', () => {
    const snap = splitSnapshot(['b_bed3', 'b_hay']);
    const tom = snap.plantings.find((p) => p.id === 'p_tom')!;
    expect(snapshotSplitFor(snap, tom)?.noun).toBe('blocks');
  });

  it('is null for a planting with no group, a one-block group, or an older bundle', () => {
    const snap = splitSnapshot();
    const alf = snap.plantings.find((p) => p.id === 'p_alf')!;
    expect(snapshotSplitFor(snap, alf)).toBeNull();
    const one = { ...snap, splitGroups: { [SG]: ['b_bed3'] } };
    expect(snapshotSplitFor(one, one.plantings.find((p) => p.id === 'p_tom')!)).toBeNull();
    const old = { ...snap, splitGroups: undefined };
    expect(snapshotSplitFor(old, old.plantings.find((p) => p.id === 'p_tom')!)).toBeNull();
  });
});

describe('split seed lots on offline Cards', () => {
  it('the Planting Card shows the /plan line and the other beds', () => {
    const card = buildPlantingCard(splitSnapshot(), 'p_tom', { now, prefs })!;
    const section = card.sections.find((s) => s.title === 'One seed lot in 2 beds');
    expect(section?.items).toEqual(['Also in: Bed 1']);
  });

  it('the Planting Card reads in Spanish', () => {
    const card = buildPlantingCard(splitSnapshot(), 'p_tom', {
      now,
      prefs: { ...prefs, locale: 'es' }
    })!;
    const section = card.sections.find((s) => s.title === 'Un lote de semilla en 2 camas');
    expect(section?.items).toEqual(['También en: Bed 1']);
  });

  it('a planting that is not a part has no split section', () => {
    const card = buildPlantingCard(sampleSnapshot(), 'p_tom', { now, prefs })!;
    expect(card.sections.some((s) => s.title.startsWith('One seed lot'))).toBe(false);
  });

  it('the Area Card bed lists name the split on each part', () => {
    const card = buildAreaCard(splitSnapshot(), 'f_garden', { now, prefs })!;
    const lines = card.sections.flatMap((s) => s.items);
    expect(lines.filter((l) => l.endsWith(' · One seed lot in 2 beds'))).toHaveLength(2);
    const plain = buildAreaCard(sampleSnapshot(), 'f_garden', { now, prefs })!;
    expect(plain.sections.flatMap((s) => s.items).some((l) => l.includes('seed lot'))).toBe(false);
  });
});
