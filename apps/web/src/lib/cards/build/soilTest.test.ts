import { describe, expect, it } from 'vitest';
import { buildCard } from './index';
import { FOLLOW_LAB_NOTICE, buildSoilTestCard, buildSoilTestCards } from './soilTest';
import { SAMPLE_SOIL_TEST, sampleGearSnapshot } from './fixturesGear';

describe('buildSoilTestCard', () => {
  const snap = sampleGearSnapshot();

  it('shows the lab sheet as typed, the lab rating over the computed class, and a fallback lime hint', () => {
    const card = buildSoilTestCard(snap, 'soil_hay')!;
    expect(card.kind).toBe('soilTest');
    expect(card.key).toBe('so_soil_hay');
    expect(card.kicker).toBe('Soil test · Hayfield');
    expect(card.title).toBe('North cut');
    expect(card.facts).toEqual([
      { label: 'Sampled', value: 'Mar 15, 2026', provenance: 'manual' },
      { label: 'Lab', value: 'Virginia Tech Soil Testing Lab', provenance: 'manual' },
      { label: 'Method', value: 'Mehlich-1', provenance: 'manual' },
      { label: 'pH', value: '5.8 · Moderately acid', provenance: 'manual' },
      { label: 'Buffer pH', value: '6.6', provenance: 'manual' },
      { label: 'Phosphorus (P)', value: '30 lb/A · Optimum', provenance: 'fallback' },
      { label: 'Potassium (K)', value: '190 lb/A · High', provenance: 'manual' },
      { label: 'Magnesium (Mg)', value: '120 lb/A · Medium', provenance: 'manual' },
      { label: 'Organic matter', value: '3.2%', provenance: 'manual' }
    ]);
    expect(card.sections[0].title).toBe('Lime');
    expect(card.sections[0].provenance).toBe('fallback');
    expect(card.sections[0].items[0]).toContain('lime is likely needed');
    expect(card.status).toEqual({ id: 'current', label: 'Current', tone: 'forest' });
    expect(card.next).toEqual({ label: 'Open fertility', href: '/fertility?block=b_hay' });
  });

  it("always says to follow the lab's recommendation", () => {
    const bare = sampleGearSnapshot({
      soilTests: [
        {
          ...SAMPLE_SOIL_TEST,
          ph: null,
          bufferPh: null,
          phosphorusPpm: null,
          potassiumPpm: null,
          mgPpm: null,
          organicMatterPct: null,
          labRatings: null
        }
      ]
    });
    for (const s of [snap, bare]) {
      const card = buildSoilTestCard(s, 'soil_hay')!;
      expect(card.notices).toEqual([FOLLOW_LAB_NOTICE]);
      expect(card.notices?.[0]).toContain("Follow your lab's recommendation");
    }
    expect(buildSoilTestCard(bare, 'soil_hay')!.sections).toEqual([]);
  });

  it('flags a test more than three years old', () => {
    const card = buildSoilTestCard(snap, 'soil_hay', { now: Date.parse('2029-06-01T12:00:00Z') })!;
    expect(card.status?.id).toBe('stale');
    expect(card.facts[0].value).toBe('Mar 15, 2026, over 3 years ago');
    expect(card.sections.map((s) => s.title)).toContain('Test again');
  });

  it('shows ppm when the lab reported ppm', () => {
    const s = sampleGearSnapshot({
      soilTests: [{ ...SAMPLE_SOIL_TEST, unitsBasis: 'ppm', phosphorusPpm: 15, labRatings: null }]
    });
    const p = buildSoilTestCard(s, 'soil_hay')!.facts.find((f) => f.label === 'Phosphorus (P)');
    expect(p).toEqual({ label: 'Phosphorus (P)', value: '15 ppm · Optimum', provenance: 'fallback' });
  });

  it('builds from its key, skips tests on removed blocks and returns null for unknown ids', () => {
    expect(buildCard(snap, 'so_soil_hay')).toEqual(buildSoilTestCard(snap, 'soil_hay'));
    expect(buildSoilTestCard(snap, 'nope')).toBeNull();
    const orphan = sampleGearSnapshot({ soilTests: [{ ...SAMPLE_SOIL_TEST, blockId: 'gone' }] });
    expect(buildSoilTestCards(orphan)).toEqual([]);
    expect(buildSoilTestCards(sampleGearSnapshot({ soilTests: undefined }))).toEqual([]);
  });
});
