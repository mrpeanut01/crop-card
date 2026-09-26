import { describe, expect, it } from 'vitest';
import {
  areaCareLinks,
  buildCareGuideCard,
  buildCareGuideCards,
  careGuideHref,
  careGuidePluginIds,
  careGuideSections
} from './careGuide';
import { FAMILY_CARE_TIPS } from './careTips';
import { buildAreaCard } from './area';
import { buildPlantingCard } from './planting';
import { sampleSnapshot } from './fixtures';
import { isSprayAdvice } from '$lib/journal/photoHelp';

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
      { label: 'Wait after spraying', value: '14 days before picking', provenance: 'plugin' }
    ]);
    expect(card.sections.map((s) => [s.title, s.provenance])).toEqual([
      ['Water', 'fallback'],
      ['Feed', 'fallback'],
      ['Stake and prune', 'fallback'],
      ['Harvest cues', 'plugin'],
      ['Common problems', 'fallback'],
      ['On your farm', undefined]
    ]);
    expect(card.sections.find((s) => s.title === 'Harvest cues')!.items).toEqual([
      'Shoulders turn dusky purple',
      'Slight give when pressed'
    ]);
    expect(card.sections.at(-1)!.items).toEqual(['Cherokee Purple tomato · Bed 3']);
    expect(card.provenance).toEqual([
      { source: 'plugin', detail: 'tomato-cherokee-purple · v1.0.0' },
      { source: 'fallback', detail: 'General tips for tomatoes, peppers and eggplant' }
    ]);
  });

  it("uses the plugin's own pruning steps over family tips", () => {
    const { sections } = careGuideSections({
      ...snap.cropPlugins['tomato-cherokee-purple'],
      careTasks: [{ title: 'Tip primocanes at 4 ft', body: 'Encourages laterals.' }]
    });
    expect(sections.find((s) => s.title === 'Stake and prune')).toEqual({
      title: 'Stake and prune',
      items: ['Tip primocanes at 4 ft. Encourages laterals.'],
      provenance: 'plugin'
    });
  });

  it('never shows spray advice or plugin-author notes in the Notes section', () => {
    const notes =
      'Indeterminate heirloom — requires staking. Susceptible to early/late blight; preventive copper or chlorothalonil per UMD vegetable guide. Phase 11 trait override: declares native halosulfuron tolerance so Sandea is permitted despite the sulfonylurea → solanaceae family-kill default.';
    const { sections } = careGuideSections(
      { ...snap.cropPlugins['tomato-cherokee-purple'], notes },
      ['^Sandea', 'halosulfuron-methyl']
    );
    const shown = sections.flatMap((s) => s.items);
    expect(sections.find((s) => s.title === 'Notes')!.items).toEqual([
      'Indeterminate heirloom — requires staking.'
    ]);
    for (const item of shown) {
      expect(isSprayAdvice(item)).toBe(false);
      expect(item).not.toMatch(/Phase \d|Sandea|chlorothalonil|copper/);
    }
    const onlyAdvice = careGuideSections({
      ...snap.cropPlugins['tomato-cherokee-purple'],
      notes: 'Copper for fire blight.'
    });
    expect(onlyAdvice.sections.find((s) => s.title === 'Notes')).toBeUndefined();
  });

  it('drops spray advice from plugin harvest cues and care tasks sentence by sentence', () => {
    const { sections } = careGuideSections({
      ...snap.cropPlugins['tomato-cherokee-purple'],
      harvestIndicators: ['Deep color. Spray copper after picking.'],
      careTasks: [{ title: 'Prune water sprouts', body: 'Follow with a copper spray.' }]
    });
    expect(sections.find((s) => s.title === 'Harvest cues')!.items).toEqual(['Deep color.']);
    expect(sections.find((s) => s.title === 'Stake and prune')!.items).toEqual([
      'Prune water sprouts.'
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
    expect(card.provenance).toHaveLength(1);
  });

  it('builds one card per referenced plugin and null for unknown ids', () => {
    expect(buildCareGuideCards(snap).map((c) => c.key)).toEqual([
      'cg_bean-provider',
      'cg_tomato-cherokee-purple'
    ]);
    expect(buildCareGuideCard(snap, 'missing-plugin')).toBeNull();
  });
});

describe('family care tips', () => {
  it('never name a pesticide, a spray or a mix rate', () => {
    for (const [family, tips] of Object.entries(FAMILY_CARE_TIPS)) {
      for (const line of [...tips.water, ...tips.feed, ...tips.prune, ...tips.problems]) {
        expect(isSprayAdvice(line), `${family}: ${line}`).toBe(false);
        expect(line).not.toMatch(/—/);
      }
    }
  });
});

describe('How to care for it', () => {
  const snap = sampleSnapshot();

  it('links a Planting Card to its crop care guide', () => {
    const card = buildPlantingCard(snap, 'p_tom')!;
    expect(card.links).toEqual([
      { label: 'How to care for it', href: '/cards/careGuide/cg_tomato-cherokee-purple' }
    ]);
    expect(careGuidePluginIds(snap, 'pl_p_tom')).toEqual(['tomato-cherokee-purple']);
  });

  it('leaves the link off when the crop plugin is not in the snapshot', () => {
    expect(buildPlantingCard(snap, 'p_alf')!.links).toBeUndefined();
    expect(careGuidePluginIds(snap, 'pl_p_alf')).toEqual([]);
  });

  it('lists every crop in a garden Area and none for a pasture', () => {
    expect(careGuidePluginIds(snap, 'ar_f_garden').sort()).toEqual([
      'bean-provider',
      'tomato-cherokee-purple'
    ]);
    expect(careGuidePluginIds(snap, 'ar_f_hay')).toEqual([]);
    expect(careGuidePluginIds(snap, 'sp_x')).toEqual([]);
    expect(careGuidePluginIds(snap, 'nonsense')).toEqual([]);
    const links = buildAreaCard(snap, 'f_garden')!.links!;
    expect(links[0].label).toBe('Open designer');
    expect(links.slice(1)).toEqual(areaCareLinks(snap, 'f_garden'));
    expect(links.map((l) => l.href)).toContain(careGuideHref('bean-provider'));
  });
});
