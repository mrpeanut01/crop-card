import { describe, expect, it } from 'vitest';
import { buildAreaCard } from '$lib/cards/build';
import { designerHref, designerState } from './designerRoute';
import { snapshotFromMapData } from './mapSnapshot';

describe('snapshotFromMapData', () => {
  const snap = snapshotFromMapData({
    ownerId: 'owner_a',
    now: Date.parse('2026-06-01T12:00:00Z'),
    fields: [
      {
        id: 'g',
        name: 'Kitchen Garden',
        kind: 'garden',
        widthFt: 30,
        lengthFt: 40,
        perimeterFt: 140
      },
      { id: 'f', name: 'Back 40' }
    ],
    blocks: [
      {
        id: 'b1',
        name: 'Bed 1',
        fieldId: 'g',
        kind: 'bed',
        widthFt: 4,
        lengthFt: 8,
        xFt: 2,
        yFt: 2,
        plantings: [
          {
            id: 'p1',
            cropPluginId: 'tomato',
            varietyDisplayName: 'Tomato',
            plantingDate: Date.parse('2026-05-04T12:00:00Z')
          }
        ]
      },
      { id: 'b2', name: 'North', fieldId: 'f' }
    ]
  });

  it('maps areas and blocks with defaults for missing kinds', () => {
    expect(snap.areas.map((a) => [a.id, a.kind])).toEqual([
      ['g', 'garden'],
      ['f', 'field']
    ]);
    expect(snap.blocks[0]).toMatchObject({
      areaId: 'g',
      kind: 'bed',
      layout: { xFt: 2, yFt: 2, rotationDeg: null, bedStyle: null }
    });
    expect(snap.blocks[1]).toMatchObject({ kind: 'block', layout: null });
  });

  it('feeds the Area Card builder', () => {
    const card = buildAreaCard(snap, 'g')!;
    expect(card.title).toBe('Kitchen Garden');
    expect(card.kicker).toBe('Garden · 30×40 ft');
    expect(card.sections.find((s) => s.title === 'Growing now')?.items).toEqual(['Tomato · Bed 1']);
  });
});

describe('designer link', () => {
  it('is offered only for gardens and greenhouses', () => {
    expect(designerState('garden', false)).toBe('coming-soon');
    expect(designerState('greenhouse', true)).toBe('available');
    expect(designerState('field', true)).toBe('none');
    expect(designerHref('a b')).toBe('/plan/areas/a%20b/design');
  });
});
