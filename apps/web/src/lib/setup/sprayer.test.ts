import { describe, expect, it, vi } from 'vitest';
import { SEED_EQUIPMENT_TEMPLATES } from '$lib/server/equipmentTemplates';
import { saveSprayerFromTile, sprayerTiles } from './sprayer';

describe('sprayerTiles', () => {
  const tiles = sprayerTiles(SEED_EQUIPMENT_TEMPLATES);

  it('offers the six starter sprayers', () => {
    expect(tiles).toHaveLength(6);
    expect(tiles.map((t) => t.templateId)).toContain('sprayer-backpack-4gal');
    expect(tiles.every((t) => t.tankGal !== null && t.tankGal > 0)).toBe(true);
  });

  it('never carries a default GPA, so a new sprayer cannot produce a rate', () => {
    for (const t of tiles) {
      expect(t).not.toHaveProperty('defaultGpa');
      expect(t.spec).not.toHaveProperty('defaultGpa');
      expect(t.spec).not.toHaveProperty('calibratedGpa');
    }
  });
});

describe('saveSprayerFromTile', () => {
  const tile = sprayerTiles(SEED_EQUIPMENT_TEMPLATES).find(
    (t) => t.templateId === 'sprayer-25gal-atv'
  )!;

  function okFetch() {
    return vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Response(
          JSON.stringify({
            equipment: { id: 'eq1', label: JSON.parse(init!.body as string).label }
          }),
          { status: 201 }
        )
    );
  }

  it('posts the template with its id in spec and comes back uncalibrated', async () => {
    const fetchFn = okFetch();
    const out = await saveSprayerFromTile(tile, '', fetchFn as unknown as typeof fetch);
    expect(out).toEqual({
      ok: true,
      result: { sprayerId: 'eq1', label: tile.label, calibratedGpa: null }
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/equipment');
    const body = JSON.parse(init.body as string);
    expect(body.type).toBe('sprayer');
    expect(body.spec.templateId).toBe('sprayer-25gal-atv');
    expect(body.spec.tankGal).toBe(25);
    expect(body).not.toHaveProperty('calibratedGpa');
  });

  it('uses a typed name but keeps the template id', async () => {
    const fetchFn = okFetch();
    const out = await saveSprayerFromTile(tile, ' Old Blue ', fetchFn as unknown as typeof fetch);
    expect(out.ok && out.result.label).toBe('Old Blue');
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.spec.templateId).toBe('sprayer-25gal-atv');
  });

  it('refuses an over-long name without calling the server', async () => {
    const fetchFn = okFetch();
    const out = await saveSprayerFromTile(
      tile,
      'x'.repeat(121),
      fetchFn as unknown as typeof fetch
    );
    expect(out.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('tells a helper to ask the owner', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 403 }));
    const out = await saveSprayerFromTile(tile, '', fetchFn as unknown as typeof fetch);
    expect(out).toEqual({ ok: false, error: 'Only the farm owner can add a sprayer.' });
  });
});
