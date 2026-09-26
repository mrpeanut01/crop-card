import { describe, expect, it } from 'vitest';
import { buildCareGuideCard, buildCareGuideCards } from './careGuide';
import { sampleSnapshot } from './fixtures';

describe('buildCareGuideCard', () => {
  const snap = sampleSnapshot();

  it('reads spacing, maturity, soil temp, PHI and harvest cues from the plugin', () => {
    const card = buildCareGuideCard(snap, 'tomato-cherokee-purple')!;
    expect(card.kind).toBe('careGuide');
    expect(card.key).toBe('cg_tomato-cherokee-purple');
    expect(card.kicker).toBe('Care guide · Solanaceae');
    expect(card.title).toBe('Tomato — Cherokee Purple');
    expect(card.facts).toEqual([
      { label: 'Matures', value: '72–80 days', provenance: 'plugin' },
      { label: 'Spacing', value: '18–24 in', provenance: 'plugin' },
      { label: 'Row spacing', value: '48 in', provenance: 'plugin' },
      { label: 'Soil temp', value: '60°F or warmer', provenance: 'plugin' },
      { label: 'PHI buffer', value: '14 d', provenance: 'plugin' }
    ]);
    expect(card.sections).toEqual([
      { title: 'Harvest cues', items: ['Shoulders turn dusky purple', 'Slight give when pressed'] },
      { title: 'On your farm', items: ['Cherokee Purple tomato · Bed 3'] }
    ]);
    expect(card.provenance).toEqual([
      { source: 'plugin', detail: 'tomato-cherokee-purple · v1.0.0' }
    ]);
  });

  it('converts spacing and soil temperature for metric users', () => {
    const card = buildCareGuideCard(snap, 'tomato-cherokee-purple', {
      prefs: { timeZone: 'UTC', units: 'metric' }
    })!;
    expect(card.facts.find((f) => f.label === 'Spacing')?.value).toBe('45.7–61 cm');
    expect(card.facts.find((f) => f.label === 'Soil temp')?.value).toBe('16°C or warmer');
  });

  it('says so plainly when a plugin has no guide at all', () => {
    const s = sampleSnapshot({
      plantings: [],
      cropPlugins: {
        bare: { pluginId: 'bare', displayName: 'Bare', version: '1', cropFamily: 'other' }
      }
    });
    const card = buildCareGuideCard(s, 'bare')!;
    expect(card.facts).toEqual([]);
    expect(card.sections[0].items[0]).toMatch(/no growing guide yet/);
  });

  it('builds one card per referenced plugin and null for unknown ids', () => {
    expect(buildCareGuideCards(snap).map((c) => c.key)).toEqual([
      'cg_bean-provider',
      'cg_tomato-cherokee-purple'
    ]);
    expect(buildCareGuideCard(snap, 'missing-plugin')).toBeNull();
  });
});
