import { describe, expect, it } from 'vitest';
import { buildCard } from './index';
import { cardKey } from '../model';
import { sampleSnapshot } from './fixtures';
import { sampleAnimalSnapshot } from './fixturesAnimals';

const LINE = 'Organic (owner-entered, effective May 1, 2026, certifier OCIA)';
const NOW = { now: Date.parse('2026-06-01T13:00:00Z') };

describe('organic status line on Cards (33B, B-16)', () => {
  it('the Area Card shows the owner-entered line, and nothing when there is none', () => {
    const snap = sampleSnapshot();
    const key = cardKey('area', 'f_garden');
    expect(buildCard(snap, key, NOW)?.facts.some((f) => f.label === 'Organic status')).toBe(false);
    snap.areas.find((a) => a.id === 'f_garden')!.organicStatus = LINE;
    const card = buildCard(snap, key, NOW);
    expect(card?.facts.find((f) => f.label === 'Organic status')).toEqual({
      label: 'Organic status',
      value: LINE,
      provenance: 'manual'
    });
  });

  it('the Animal and Flock Cards show it only when set', () => {
    const snap = sampleAnimalSnapshot();
    const hen = cardKey('animal', 'a_hen1');
    const flock = cardKey('flock', 'g_layers');
    expect(buildCard(snap, hen, NOW)?.facts.some((f) => f.label === 'Organic status')).toBe(false);
    expect(buildCard(snap, flock, NOW)?.facts.some((f) => f.label === 'Organic status')).toBe(
      false
    );
    snap.animals!.find((a) => a.id === 'a_hen1')!.organicStatus = `${LINE} from group Layers`;
    snap.animalGroups!.find((g) => g.id === 'g_layers')!.organicStatus = LINE;
    expect(buildCard(snap, hen, NOW)?.facts.find((f) => f.label === 'Organic status')?.value).toBe(
      `${LINE} from group Layers`
    );
    expect(
      buildCard(snap, flock, NOW)?.facts.find((f) => f.label === 'Organic status')?.value
    ).toBe(LINE);
  });
});
