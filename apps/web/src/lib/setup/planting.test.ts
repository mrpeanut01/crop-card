import { describe, expect, it, vi } from 'vitest';
import { savePlanting, searchCrops, type CropOption } from './planting';

const CATALOG: CropOption[] = [
  {
    pluginId: 'tomato-cherokee',
    displayName: 'Tomato — Cherokee Purple',
    cropFamily: 'solanaceae'
  },
  { pluginId: 'tomatillo', displayName: 'Tomatillo', cropFamily: 'solanaceae' },
  { pluginId: 'corn-sweet', displayName: 'Sweet Corn — Silver Queen', cropFamily: 'poaceae' },
  { pluginId: 'corn-field', displayName: 'Field Corn (Dent)', cropFamily: 'poaceae' },
  { pluginId: 'alfalfa', displayName: 'Alfalfa', cropFamily: 'legume' }
];

describe('searchCrops', () => {
  it('returns nothing for an empty query', () => {
    expect(searchCrops(CATALOG, '  ')).toEqual([]);
  });

  it('matches word prefixes and ranks names that start with the query first', () => {
    expect(searchCrops(CATALOG, 'corn').map((c) => c.pluginId)).toEqual([
      'corn-field',
      'corn-sweet'
    ]);
    expect(searchCrops(CATALOG, 'tom').map((c) => c.pluginId)).toEqual([
      'tomatillo',
      'tomato-cherokee'
    ]);
  });

  it('needs every word to match', () => {
    expect(searchCrops(CATALOG, 'sweet corn').map((c) => c.pluginId)).toEqual(['corn-sweet']);
    expect(searchCrops(CATALOG, 'sweet alfalfa')).toEqual([]);
  });

  it('ignores case and punctuation', () => {
    expect(searchCrops(CATALOG, 'CHEROKEE')).toHaveLength(1);
    expect(searchCrops(CATALOG, '(dent)')).toHaveLength(1);
  });

  it('caps the list', () => {
    expect(searchCrops(CATALOG, 'o', 2).length).toBeLessThanOrEqual(2);
  });
});

describe('savePlanting', () => {
  it('posts an in-the-ground planting with no AI provenance tag', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ planting: { id: 'p1' } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        })
    );
    const out = await savePlanting(
      { blockId: 'b 1', cropPluginId: 'alfalfa', variety: '  ', plantingDateMs: 1_000 },
      fetchFn as unknown as typeof fetch
    );
    expect(out).toEqual({
      ok: true,
      result: { plantingId: 'p1', blockId: 'b 1', cropPluginId: 'alfalfa' }
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/blocks/b%201/plantings');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ cropPluginId: 'alfalfa', plantingDate: 1_000 });
    expect(body).not.toHaveProperty('sourceProvenance');
  });

  it('sends a variety when one is typed', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ planting: { id: 'p2' } }), { status: 201 })
    );
    await savePlanting(
      { blockId: 'b', cropPluginId: 'alfalfa', variety: 'Vernal', plantingDateMs: 5 },
      fetchFn as unknown as typeof fetch
    );
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).varietyDisplayName).toBe('Vernal');
  });

  it('turns a helper 403 into plain words', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 403 }));
    const out = await savePlanting(
      { blockId: 'b', cropPluginId: 'alfalfa', plantingDateMs: 5 },
      fetchFn as unknown as typeof fetch
    );
    expect(out).toEqual({ ok: false, error: 'Only the farm owner can add plantings.' });
  });
});
