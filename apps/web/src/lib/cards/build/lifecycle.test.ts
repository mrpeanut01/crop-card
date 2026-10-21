import { describe, expect, it } from 'vitest';
import type { Plugin } from '$lib/plugins/schemas';
import { herbLifecycleSnapshotPart } from '$lib/server/lifecycleSnapshot';
import { buildPlantingCard } from './planting';
import { buildCareGuideCard } from './careGuide';
import { sampleSnapshot } from './fixtures';
import { snapshotLifecycle } from './lifecycle';
import type { FarmSnapshot } from '../snapshot';

const LABEL = 'Annual or perennial here';

function herbSnapshot(overrides: Partial<FarmSnapshot> = {}): FarmSnapshot {
  const base = sampleSnapshot();
  return {
    ...base,
    plantings: [
      ...base.plantings,
      { ...base.plantings[0], id: 'p_lav', cropPluginId: 'test-herb-perennial' }
    ],
    cropPlugins: {
      ...base.cropPlugins,
      'test-herb-perennial': {
        pluginId: 'test-herb-perennial',
        displayName: 'Test perennial herb',
        version: '1.0.0',
        cropFamily: 'herb-culinary'
      }
    },
    herbLifecycle: { 'test-herb-perennial': { lifecycle: 'perennial' } },
    zone: {
      zone: '7b',
      provenance: 'manual',
      stationName: null,
      distanceMi: null,
      extremeMinF: null
    },
    ...overrides
  };
}

describe('herbLifecycleSnapshotPart', () => {
  it('keeps herbs only, with the plugin values and no family default', () => {
    const plugins = [
      { type: 'crop', pluginId: 'basil-genovese', cropFamily: 'herb-culinary' },
      { type: 'crop', pluginId: 'lemon-balm', agronomy: { lifecycle: 'perennial' } },
      { type: 'crop', pluginId: 'tomato-amish-paste', agronomy: { lifecycle: 'annual' } },
      null
    ] as unknown as Plugin[];
    expect(herbLifecycleSnapshotPart(plugins)).toEqual({
      herbLifecycle: { 'basil-genovese': {}, 'lemon-balm': { lifecycle: 'perennial' } }
    });
  });

  it('adds nothing for a farm with no herbs', () => {
    expect(herbLifecycleSnapshotPart([])).toEqual({});
  });
});

describe('lifecycle fact on cards', () => {
  it('the Planting card names the typed zone and that the value is not checked', () => {
    const card = buildPlantingCard(herbSnapshot(), 'p_lav')!;
    const fact = card.facts.find((f) => f.label === LABEL);
    expect(fact).toEqual({
      label: LABEL,
      value:
        'Perennial; the coldest zone it survives is not known yet. Not yet checked against a source. Using the zone you entered, 7b.',
      provenance: 'fallback'
    });
  });

  it('the Care Guide card carries the same line, in Spanish too', () => {
    const card = buildCareGuideCard(herbSnapshot(), 'test-herb-perennial', {
      locale: 'es'
    })!;
    const fact = card.facts.find((f) => f.label === 'Anual o perenne aquí');
    expect(fact?.value).toContain('Se usa la zona que ingresaste: 7b.');
  });

  it('non-herbs and bundles saved before 37B get no fact', () => {
    const card = buildPlantingCard(herbSnapshot(), 'p_tom')!;
    expect(card.facts.some((f) => f.label === LABEL)).toBe(false);
    const old = herbSnapshot({ herbLifecycle: undefined });
    expect(buildPlantingCard(old, 'p_lav')!.facts.some((f) => f.label === LABEL)).toBe(false);
  });

  it('a perennial with no zone in the bundle says the zone is not known', () => {
    const v = snapshotLifecycle(herbSnapshot({ zone: null }), 'test-herb-perennial');
    expect(v?.reason).toBe('no-farm-zone');
  });
});
