import { describe, expect, it } from 'vitest';
import {
  areaCareLinks,
  buildCareGuideCard,
  buildCareGuideCards,
  careGuideHref,
  careGuidePluginIds,
  careGuideSections
} from './careGuide';
import { allCareTips, FAMILY_CARE_TIPS } from './careTips';
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
      {
        label: 'Wait after spraying',
        value: '14 days before picking',
        provenance: 'plugin',
        englishOnly: true
      }
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

  it('lists spacing and first fruit per tree size class, leading the sections', () => {
    const tree = {
      pluginId: 'apple-test',
      displayName: 'Apple — Test',
      version: '1.0.0',
      cropFamily: 'orchard',
      treeSizeClasses: [
        { sizeClass: 'standard' as const, minSpacingFt: 30, yearsToBearing: { min: 6, max: 10 } },
        { sizeClass: 'dwarf' as const, minSpacingFt: 8, yearsToBearing: { min: 3, max: 3 } }
      ]
    };
    const withTree = { ...snap, cropPlugins: { ...snap.cropPlugins, 'apple-test': tree } };
    const card = buildCareGuideCard(withTree, 'apple-test')!;
    expect(card.facts.find((f) => f.label === 'Spacing')).toBeUndefined();
    expect(card.sections[0]).toEqual({
      title: 'Spacing by tree size',
      items: [
        'Spacing and first fruit depend on the rootstock. The nursery tag says whether a tree is dwarf, semi-dwarf or standard.',
        'Dwarf: at least 8 ft apart, first fruit in 3 years',
        'Standard: at least 30 ft apart, first fruit in 6–10 years'
      ],
      provenance: 'plugin'
    });
    const es = buildCareGuideCard(withTree, 'apple-test', { locale: 'es' })!;
    expect(es.sections[0].items[2]).toBe(
      'Estándar: al menos 30 pies entre árboles, primera fruta en 6 a 10 años'
    );
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

  it('shows sourced seeding rates for a drilled crop instead of the legacy row spacing', () => {
    const rye = {
      pluginId: 'rye',
      displayName: 'Rye',
      version: '1',
      cropFamily: 'cover-grass',
      defaultRowSpacingInches: 6,
      plantingGuide: {
        seedingRate: {
          drilledLbsPerAcre: { min: 60, max: 120 },
          broadcastLbsPerAcre: { min: 90, max: 160 },
          drillRowSpacingIn: { min: 6, max: 8 }
        }
      }
    };
    const s = sampleSnapshot({ plantings: [], cropPlugins: { rye } });
    expect(buildCareGuideCard(s, 'rye')!.facts).toEqual([
      { label: 'Seed rate, drilled', value: '60–120 lb/ac', provenance: 'plugin' },
      { label: 'Seed rate, broadcast', value: '90–160 lb/ac', provenance: 'plugin' },
      { label: 'Drill rows', value: '6–8 in', provenance: 'plugin' },
      {
        label: 'Seed needed',
        value: 'Broadcast: 3.3–5.9 oz for 100 sq ft',
        provenance: 'data'
      }
    ]);
    const metric = buildCareGuideCard(s, 'rye', {
      prefs: { timeZone: 'UTC', units: 'metric' }
    })!;
    expect(metric.facts[0].value).toBe('67–135 kg/ha');
    const es = buildCareGuideCard(s, 'rye', {
      prefs: { timeZone: 'UTC', units: 'us', locale: 'es' }
    })!;
    expect(es.facts.map((f) => f.label)).toEqual([
      'Dosis con sembradora',
      'Dosis al voleo',
      'Entre hileras de sembradora',
      'Semilla necesaria'
    ]);
    expect(es.facts[3].value).toBe('Al voleo: 3.3–5.9 oz para 100 sq ft');
    expect(metric.facts[3].value).toBe('Broadcast: 100–180 g for 10 m²');
  });

  it('sizes seed by the methods the farm saved on its plantings (#555)', () => {
    const rye = {
      pluginId: 'rye',
      displayName: 'Rye',
      version: '1',
      cropFamily: 'cover-grass',
      plantingGuide: {
        seedingRate: {
          drilledLbsPerAcre: { min: 60, max: 120 },
          broadcastLbsPerAcre: { min: 90, max: 160 }
        }
      }
    };
    const planting = sampleSnapshot().plantings[0];
    const seedLines = (methods: Array<'drilled' | 'broadcast' | undefined>) => {
      const s = sampleSnapshot({
        cropPlugins: { rye },
        plantings: methods.map((m, i) => ({
          ...planting,
          id: `p_${i}`,
          cropPluginId: 'rye',
          ...(m ? { sowingMethod: m } : {})
        }))
      });
      return buildCareGuideCard(s, 'rye')!
        .facts.filter((f) => f.label === 'Seed needed')
        .map((f) => f.value.split(':')[0]);
    };
    expect(seedLines(['drilled'])).toEqual(['Drilled']);
    expect(seedLines([undefined])).toEqual(['Broadcast']);
    expect(seedLines(['drilled', 'broadcast', 'drilled'])).toEqual(['Drilled', 'Broadcast']);
  });

  it('says what the seed rates weigh when the source states it', () => {
    const phacelia = {
      pluginId: 'phacelia',
      displayName: 'Phacelia',
      version: '1',
      cropFamily: 'cover-broadleaf',
      plantingGuide: {
        seedingRate: {
          drilledLbsPerAcre: { min: 3, max: 5 },
          broadcastLbsPerAcre: { min: 4, max: 6 },
          seedBasis: 'pls' as const
        }
      }
    };
    const s = sampleSnapshot({ plantings: [], cropPlugins: { phacelia } });
    expect(buildCareGuideCard(s, 'phacelia')!.facts.map((f) => f.value)).toEqual([
      '3–5 lb/ac, pure live seed',
      '4–6 lb/ac, pure live seed',
      'Broadcast: 0.1–0.3 oz for 100 sq ft'
    ]);
    const es = buildCareGuideCard(s, 'phacelia', {
      prefs: { timeZone: 'UTC', units: 'us', locale: 'es' }
    })!;
    expect(es.facts[0].value).toMatch(/semilla pura viva$/);
  });

  it('shows a small-grain seed count and a row-crop population', () => {
    const plugins = {
      wheat: {
        pluginId: 'wheat',
        displayName: 'Wheat',
        version: '1',
        cropFamily: 'cereal-grain',
        plantingGuide: { seedingRate: { drilledSeedsPerSqFt: { min: 22, max: 30 } } }
      },
      corn: {
        pluginId: 'corn',
        displayName: 'Corn',
        version: '1',
        cropFamily: 'corn',
        plantingGuide: { seedingRate: { seedsPerAcre: { min: 28000, max: 32000 } } }
      }
    };
    const s = sampleSnapshot({ plantings: [], cropPlugins: plugins });
    expect(buildCareGuideCard(s, 'wheat')!.facts).toEqual([
      { label: 'Seeds, drilled', value: '22–30 per sq ft', provenance: 'plugin' },
      {
        label: 'Seed needed',
        value: 'Drilled: 2,200–3,000 seeds for 100 sq ft',
        provenance: 'data'
      }
    ]);
    expect(buildCareGuideCard(s, 'corn')!.facts).toEqual([
      { label: 'Seeding population', value: '28,000–32,000/ac', provenance: 'plugin' },
      {
        label: 'Seed needed',
        value: 'Planted: 64–74 seeds for 100 sq ft',
        provenance: 'data'
      }
    ]);
  });

  it('#576: shows the purpose, the droughty-soil cut and how a crop is sown', () => {
    const plugins = {
      sunn: {
        pluginId: 'sunn',
        displayName: 'Sunn hemp',
        version: '1',
        cropFamily: 'cover-legume',
        plantingGuide: {
          seedingRate: {
            drilledLbsPerAcre: { min: 30, max: 50 },
            seedBasis: 'pls' as const,
            purpose: 'green-manure' as const
          }
        }
      },
      corn: {
        pluginId: 'corn',
        displayName: 'Corn',
        version: '1',
        cropFamily: 'corn',
        plantingGuide: {
          seedingRate: {
            seedsPerAcre: { min: 25000, max: 33000 },
            droughtySoilCutPct: { min: 10, max: 15 }
          }
        }
      },
      oats: {
        pluginId: 'oats',
        displayName: 'Oats',
        version: '1',
        cropFamily: 'cereal-grain',
        plantingGuide: { seedingRate: { sownBy: ['drilled' as const, 'broadcast' as const] } }
      }
    };
    const s = sampleSnapshot({ plantings: [], cropPlugins: plugins });
    expect(buildCareGuideCard(s, 'sunn')!.facts.map((f) => f.value)).toEqual([
      '30–50 lb/ac, pure live seed, rate for green manure',
      'Drilled: 1.1–1.9 oz for 100 sq ft, rate for green manure'
    ]);
    expect(buildCareGuideCard(s, 'corn')!.facts[1]).toEqual({
      label: 'Droughty soils',
      value:
        'The rate is for soils with high production potential. On droughty soils, plant 10–15% fewer.',
      provenance: 'plugin'
    });
    const oats = buildCareGuideCard(s, 'oats')!.facts;
    expect(oats[0]).toEqual({
      label: 'How it is sown',
      value: 'Drilled or broadcast',
      provenance: 'plugin'
    });
    expect(oats[1].value).toMatch(/^Seed amount not known/);
    const es = (id: string) =>
      buildCareGuideCard(s, id, { prefs: { timeZone: 'UTC', units: 'us', locale: 'es' } })!.facts;
    expect(es('sunn')[0].value).toBe('30–50 lb/ac, semilla pura viva, dosis para abono verde');
    expect(es('corn')[1].label).toBe('Suelos propensos a sequía');
    expect(es('oats')[0].value).toBe('Con sembradora o al voleo');
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
    for (const { id, text } of allCareTips()) {
      expect(isSprayAdvice(text), `${id}: ${text}`).toBe(false);
      expect(text, id).not.toMatch(/—/);
    }
  });

  it('give every tip an id under its own family and field', () => {
    for (const [family, tips] of Object.entries(FAMILY_CARE_TIPS)) {
      for (const field of ['water', 'feed', 'prune', 'problems'] as const) {
        for (const tip of tips[field]) {
          expect(tip.id).toMatch(new RegExp(`^${family}\\.${field}\\.\\d+$`));
        }
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

describe('family tips with empty sections', () => {
  it('leaves a section out when the family has no sourced tip for it', () => {
    const { sections, tips } = careGuideSections({
      pluginId: 'bean-x',
      displayName: 'Bean',
      version: '1',
      cropFamily: 'legume'
    });
    expect(sections.map((s) => s.title)).toEqual(['Feed', 'Stake and prune']);
    expect(tips?.label).toBe('beans and peas');
  });
});
