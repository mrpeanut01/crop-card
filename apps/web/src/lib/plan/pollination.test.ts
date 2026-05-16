import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import {
  cucurbitSpeciesOf,
  expandCrossesWith,
  pairRequirement,
  pluginsCross,
  pollinatorMetaFor
} from './pollination';

function fakeCorn(id: string, overrides: Partial<CropPlugin> = {}): CropPlugin {
  return {
    pluginId: id,
    type: 'crop',
    schemaVersion: '1.0.0',
    displayName: id,
    cropFamily: 'corn',
    ...overrides
  } as unknown as CropPlugin;
}

function fakeCucurbit(id: string, overrides: Partial<CropPlugin> = {}): CropPlugin {
  return {
    pluginId: id,
    type: 'crop',
    schemaVersion: '1.0.0',
    displayName: id,
    cropFamily: 'cucurbit',
    ...overrides
  } as unknown as CropPlugin;
}

describe('pollinatorMetaFor', () => {
  it('falls back to family default for corn (250ft, 14d stagger)', () => {
    const meta = pollinatorMetaFor(fakeCorn('corn-bantam-sweet'));
    expect(meta.source).toBe('family-default');
    expect(meta.isolationFeet).toBe(250);
    expect(meta.staggerDays).toBe(14);
    expect(meta.crossesWith).toEqual(['family:corn']);
  });

  it('plugin override beats family default', () => {
    const meta = pollinatorMetaFor(
      fakeCorn('corn-bantam-sweet', { isolationFeet: 660, isolationStaggerDays: 21 })
    );
    expect(meta.isolationFeet).toBe(660);
    expect(meta.staggerDays).toBe(21);
  });

  it('explicit crossesWith short-circuits to source=plugin', () => {
    const meta = pollinatorMetaFor(
      fakeCorn('corn-bantam-sweet', { crossesWith: ['corn-bloody-butcher'] })
    );
    expect(meta.source).toBe('plugin');
    expect(meta.crossesWith).toEqual(['corn-bloody-butcher']);
  });

  it('cucurbit species peers are resolved automatically', () => {
    const meta = pollinatorMetaFor(fakeCucurbit('zucchini-black-beauty'));
    expect(meta.source).toBe('species-default');
    expect(meta.crossesWith).toEqual(
      expect.arrayContaining(['acorn-squash-table-queen', 'summer-squash-yellow-crookneck'])
    );
    expect(meta.crossesWith).not.toContain('zucchini-black-beauty');
    expect(meta.crossesWith).not.toContain('butternut-squash-waltham');
  });

  it('unknown cucurbit plugin produces no advisory', () => {
    const meta = pollinatorMetaFor(fakeCucurbit('some-novel-squash'));
    expect(meta.source).toBe('none');
    expect(meta.isolationFeet).toBe(0);
    expect(meta.crossesWith).toEqual([]);
  });
});

describe('cucurbitSpeciesOf', () => {
  it('correctly classifies the three Cucurbita species', () => {
    expect(cucurbitSpeciesOf('zucchini-black-beauty')).toBe('pepo');
    expect(cucurbitSpeciesOf('butternut-squash-waltham')).toBe('moschata');
    expect(cucurbitSpeciesOf('pumpkin-cinderella-film-coated-treated')).toBe('maxima');
  });
  it('returns null for unknown ids', () => {
    expect(cucurbitSpeciesOf('not-a-real-plugin')).toBeNull();
  });
});

describe('expandCrossesWith', () => {
  const corn1 = fakeCorn('corn-bantam-sweet');
  const corn2 = fakeCorn('corn-bloody-butcher');
  const squash = fakeCucurbit('zucchini-black-beauty');
  const pluginById = {
    'corn-bantam-sweet': corn1,
    'corn-bloody-butcher': corn2,
    'zucchini-black-beauty': squash
  };

  it('expands family:corn to all corn pluginIds in scope', () => {
    const expanded = expandCrossesWith(['family:corn'], pluginById);
    expect(expanded).toEqual(expect.arrayContaining(['corn-bantam-sweet', 'corn-bloody-butcher']));
    expect(expanded).not.toContain('zucchini-black-beauty');
  });
  it('passes raw pluginIds through unchanged', () => {
    const expanded = expandCrossesWith(['corn-bantam-sweet'], pluginById);
    expect(expanded).toEqual(['corn-bantam-sweet']);
  });
  it('mixes tags and ids', () => {
    const expanded = expandCrossesWith(['family:corn', 'zucchini-black-beauty'], pluginById);
    expect(expanded).toEqual(
      expect.arrayContaining(['corn-bantam-sweet', 'corn-bloody-butcher', 'zucchini-black-beauty'])
    );
  });
});

describe('pluginsCross', () => {
  const corn1 = fakeCorn('corn-bantam-sweet');
  const corn2 = fakeCorn('corn-bloody-butcher');
  const popcorn = fakeCorn('popcorn-strawberry');
  const zucchini = fakeCucurbit('zucchini-black-beauty');
  const butternut = fakeCucurbit('butternut-squash-waltham');
  const acorn = fakeCucurbit('acorn-squash-table-queen');
  const pluginById = {
    'corn-bantam-sweet': corn1,
    'corn-bloody-butcher': corn2,
    'popcorn-strawberry': popcorn,
    'zucchini-black-beauty': zucchini,
    'butternut-squash-waltham': butternut,
    'acorn-squash-table-queen': acorn
  };

  it('two corn varieties cross via family default', () => {
    expect(pluginsCross(corn1, corn2, pluginById)).toBe(true);
    expect(pluginsCross(corn1, popcorn, pluginById)).toBe(true);
  });

  it('corn and squash do NOT cross', () => {
    expect(pluginsCross(corn1, zucchini, pluginById)).toBe(false);
  });

  it('same-species cucurbits cross (zucchini × acorn = both C. pepo)', () => {
    expect(pluginsCross(zucchini, acorn, pluginById)).toBe(true);
  });

  it('different-species cucurbits do NOT cross (zucchini × butternut)', () => {
    expect(pluginsCross(zucchini, butternut, pluginById)).toBe(false);
  });

  it('returns false for identity', () => {
    expect(pluginsCross(corn1, corn1, pluginById)).toBe(false);
  });
});

describe('pairRequirement', () => {
  it('takes the larger isolation distance and stagger when plugins disagree', () => {
    const a = fakeCorn('a', { isolationFeet: 250, isolationStaggerDays: 14 });
    const b = fakeCorn('b', { isolationFeet: 660, isolationStaggerDays: 21 });
    const req = pairRequirement(a, b);
    expect(req.isolationFeet).toBe(660);
    expect(req.staggerDays).toBe(21);
  });
});
