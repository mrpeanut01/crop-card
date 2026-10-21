// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import { toCropPlugin } from './cardSnapshot';
import { getRegistry } from './registry';
import { buildCareGuideCard } from '$lib/cards/build/careGuide';
import { sampleSnapshot } from '$lib/cards/build/fixtures';

describe('toCropPlugin carries every herb field a card reads (CO-10)', () => {
  it('copies preserving with each infuse medium, waterNeed and sunNeed, and no note', () => {
    const plugin = {
      type: 'crop',
      pluginId: 'basil-genovese',
      displayName: 'Basil — Genovese',
      version: '1.0.0',
      cropFamily: 'herb-culinary',
      preserving: [
        { method: 'freeze', suitability: 'good', note: 'Freeze in oil cubes.' },
        { method: 'infuse', suitability: 'good', medium: 'oil', note: 'Keep cold.' },
        { method: 'infuse', suitability: 'good', medium: 'vinegar' }
      ],
      waterNeed: 'high',
      sunNeed: 'full'
    } as unknown as CropPlugin;
    expect(toCropPlugin(plugin)).toMatchObject({
      preserving: [
        { method: 'freeze', suitability: 'good' },
        { method: 'infuse', suitability: 'good', medium: 'oil' },
        { method: 'infuse', suitability: 'good', medium: 'vinegar' }
      ],
      waterNeed: 'high',
      sunNeed: 'full'
    });
    expect(JSON.stringify(toCropPlugin(plugin))).not.toContain('Keep cold');
  });

  it('leaves the fields out when the plugin has none', () => {
    const snap = toCropPlugin({
      type: 'crop',
      pluginId: 'x',
      displayName: 'X',
      version: '1.0.0',
      cropFamily: 'solanaceae'
    } as unknown as CropPlugin)!;
    expect('preserving' in snap || 'waterNeed' in snap || 'sunNeed' in snap).toBe(false);
  });

  it('every shipped herb with a sun need reaches the offline Care Guide as a plugin fact', async () => {
    const registry = await getRegistry();
    const herb = registry.crops().find((c) => c.pluginId === 'lemon-balm')!;
    expect(herb.sunNeed).toBe('part');
    const snapshot = sampleSnapshot();
    snapshot.cropPlugins[herb.pluginId] = toCropPlugin(herb)!;
    const card = buildCareGuideCard(snapshot, herb.pluginId)!;
    expect(card.facts.find((f) => f.label === 'Sun')).toEqual({
      label: 'Sun',
      value: 'Takes part shade',
      provenance: 'plugin'
    });
    const es = buildCareGuideCard(snapshot, herb.pluginId, { locale: 'es' })!;
    expect(es.facts.find((f) => f.label === 'Sol')?.value).toBe('Tolera media sombra');
  });

  it('a herb with no sourced sun need shows no sun fact', async () => {
    const registry = await getRegistry();
    const herb = registry.crops().find((c) => c.pluginId === 'chervil')!;
    const snapshot = sampleSnapshot();
    snapshot.cropPlugins[herb.pluginId] = toCropPlugin(herb)!;
    expect(buildCareGuideCard(snapshot, herb.pluginId)!.facts.some((f) => f.label === 'Sun')).toBe(
      false
    );
  });
});
