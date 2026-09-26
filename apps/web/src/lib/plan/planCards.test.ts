import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { BlockWithPlantings } from '$lib/db/blocks';
import { snapshotFromMapData } from '$lib/farm/mapSnapshot';
import { kindStyle } from '$lib/farm/kindStyle';
import {
  NO_AREA,
  growingFacts,
  growingSummary,
  planAreaCard,
  planBlockCard,
  planPlantingCard,
  planRailCards,
  planSelectHref,
  plantingColor
} from './planCards';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 1);

const FIELDS = [
  { id: 'f1', name: 'Hayfield', kind: 'pasture' as const, acres: 20 },
  { id: 'g1', name: '', kind: 'garden' as const, widthFt: 30, lengthFt: 40 }
];

const BLOCKS = [
  {
    id: 'b1',
    name: 'North',
    fieldId: 'f1',
    acres: 10,
    tillageMethod: 'conventional',
    axesLocked: false,
    plantings: [
      {
        id: 'p1',
        blockId: 'b1',
        cropPluginId: 'orchardgrass',
        varietyDisplayName: 'Orchardgrass',
        plantingDate: NOW - 400 * DAY
      }
    ]
  },
  {
    id: 'b2',
    name: 'Bed 1',
    fieldId: 'g1',
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8,
    tillageMethod: 'conventional',
    axesLocked: false,
    plantings: [
      {
        id: 'p2',
        blockId: 'b2',
        cropPluginId: 'tomato',
        varietyDisplayName: 'Cherokee Purple',
        plantingDate: NOW - 10 * DAY
      },
      {
        id: 'p3',
        blockId: 'b2',
        cropPluginId: 'basil',
        varietyDisplayName: 'Genovese basil',
        plantingDate: null
      },
      {
        id: 'p4',
        blockId: 'b2',
        cropPluginId: 'marigold',
        varietyDisplayName: 'Marigold',
        plantingDate: null
      }
    ]
  },
  { id: 'b3', name: 'Stray', tillageMethod: 'conventional', axesLocked: false, plantings: [] }
] as unknown as BlockWithPlantings[];

const snapshot = snapshotFromMapData({ ownerId: 'o', fields: FIELDS, blocks: BLOCKS, now: NOW });
const areas = FIELDS.map((f) => ({ id: f.id, name: f.name, kind: f.kind }));
const params = new URLSearchParams('tab=overview&planting=2&block=b1');

describe('planCards', () => {
  it('plantingColor is stable and from the palette', () => {
    fc.assert(
      fc.property(fc.string(), (id) => {
        expect(plantingColor(id)).toBe(plantingColor(id));
        expect(plantingColor(id)).toMatch(/^#[0-9a-f]{6}$/);
      })
    );
  });

  it('growingSummary names two plantings then counts the rest', () => {
    expect(growingSummary([])).toBeNull();
    expect(growingSummary(BLOCKS[1].plantings)).toBe('Cherokee Purple · Genovese basil · +1');
    expect(growingSummary(BLOCKS[0].plantings)).toBe('Orchardgrass');
  });

  it('growingFacts splits what is in the ground from what is only planned', () => {
    expect(growingFacts(BLOCKS[1].plantings, NOW).map((f) => [f.label, f.value])).toEqual([
      ['Growing', 'Cherokee Purple'],
      ['Planned', 'Genovese basil · Marigold']
    ]);
    const future = [{ varietyDisplayName: 'Tomato', plantingDate: NOW + 300 * DAY }];
    expect(growingFacts(future, NOW).map((f) => [f.label, f.value])).toEqual([
      ['Growing', 'Nothing yet'],
      ['Planned', 'Tomato']
    ]);
    expect(growingFacts([], NOW)).toEqual([
      { label: 'Growing', value: 'Nothing yet', provenance: 'data' }
    ]);
  });

  it('planSelectHref keeps other params, drops the planting tab', () => {
    expect(planSelectHref(params, 'g1')).toBe('/plan?tab=overview&field=g1');
    expect(planSelectHref(params, 'g1', 'b2')).toBe('/plan?tab=overview&block=b2&field=g1');
  });

  it('rail: one compact card per Area with its kind color, size and crops, then loose blocks', () => {
    const rail = planRailCards(snapshot, areas, BLOCKS, params, undefined, NOW);
    expect(rail.map((r) => r.areaId)).toEqual(['f1', 'g1', NO_AREA]);
    const [hay, garden, loose] = rail;
    expect(hay.card.title).toBe('Hayfield');
    expect(hay.card.accent).toBe(kindStyle('pasture').color);
    expect(hay.card.facts.map((f) => [f.label, f.value])).toEqual([
      ['Size', '20 ac'],
      ['Growing', 'Orchardgrass']
    ]);
    expect(hay.designer).toBeNull();
    expect(garden.card.title).toBe('Garden');
    expect(garden.card.facts[0]).toMatchObject({ label: 'Size', value: '30×40 ft' });
    expect(garden.designer).toBe('/plan/areas/g1/design');
    expect(garden.card.href).toBe('/plan?tab=overview&field=g1');
    expect(garden.card.bedMap).toBeUndefined();
    expect(loose.card.title).toBe('Not in an Area');
    expect(loose.card.href).toBe('/plan?tab=overview&field=none');
    expect(garden.searchText).toContain('genovese basil');
    expect(new Set(rail.map((r) => r.card.key)).size).toBe(rail.length);
  });

  it('area card: a garden keeps its bed map and Open designer, drops the block list', () => {
    const card = planAreaCard(snapshot, areas[1])!;
    expect(card.bedMap?.beds.map((b) => b.name)).toEqual(['Bed 1']);
    expect(card.links).toEqual([{ label: 'Open designer', href: '/plan/areas/g1/design' }]);
    expect(card.sections.every((s) => s.title === 'Notes')).toBe(true);
    expect(planAreaCard(snapshot, { id: 'missing', name: 'x', kind: 'field' })).toBeNull();
  });

  it('block card: size, crops, derived status, and a link that selects it', () => {
    const card = planBlockCard(BLOCKS[1], params, 'g1', { tomato: 70 }, undefined, NOW);
    expect(card.title).toBe('Bed 1');
    expect(card.kicker).toBe('3 plantings');
    expect(card.facts[0]).toMatchObject({ label: 'Size', value: '4×8 ft' });
    expect(card.status).toEqual({ label: 'active', tone: 'forest' });
    expect(card.href).toBe('/plan?tab=overview&block=b2&field=g1');
    const empty = planBlockCard(BLOCKS[2], params, NO_AREA, {}, undefined, NOW);
    expect(empty.status).toBeUndefined();
    expect(empty.facts.find((f) => f.label === 'Growing')?.value).toBe('Nothing yet');
  });

  it('planting card: status, five facts, swatch, provenance and archetype link', () => {
    const card = planPlantingCard({
      planting: BLOCKS[1].plantings[0],
      daysToMaturity: 80,
      cropName: 'Tomato',
      role: 'Primary',
      sourceTag: 'AI plan',
      refineCount: 2,
      detailHref: '/plan/wheat?planting=p2',
      now: NOW
    });
    expect(card.kind).toBe('planting');
    expect(card.key).toBe('pl_p2');
    expect(card.kicker).toBe('Tomato · Primary');
    expect(card.status).toEqual({ label: 'active', tone: 'forest' });
    expect(card.facts.map((f) => f.label)).toEqual([
      'Role',
      'Stage',
      'Planted',
      'Harvest',
      'Amount'
    ]);
    expect(card.accent).toBe(plantingColor('p2'));
    expect(card.provenance).toEqual([{ source: 'ai', detail: 'AI plan · refined 2×' }]);
    expect(card.links).toEqual([
      { label: 'Stages, scab risk & vernalization', href: '/plan/wheat?planting=p2' },
      { label: 'Journal and photo help', href: '/cards/planting/pl_p2' }
    ]);
    expect(card.href).toBe('/crops/p2');
    const carry = planPlantingCard({
      planting: BLOCKS[1].plantings[1],
      sourceTag: 'Carry-forward'
    });
    expect(carry.status?.label).toBe('planned');
    expect(carry.provenance[0].source).toBe('fallback');
    expect(carry.facts.find((f) => f.label === 'Planted')?.value).toBe('planned');
    expect(carry.links).toEqual([
      { label: 'Journal and photo help', href: `/cards/planting/pl_${BLOCKS[1].plantings[1].id}` }
    ]);
  });
});
