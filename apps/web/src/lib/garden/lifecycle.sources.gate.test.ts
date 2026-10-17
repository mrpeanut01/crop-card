import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import { getBaseRegistry } from '$lib/server/registry';
import { resolveCropAgronomy } from '$lib/plugins/familyDefaults';
import {
  checkSources,
  cropFactPaths,
  lifecycleQuoteGaps,
  winterHardyToZoneQuoteGaps,
  type SourceMap
} from '$lib/plugins/sourceCoverage';
import { HERB_PLUGIN_IDS } from './herbs';
import { SOURCED_LIFECYCLES, type SourcedLifecycle } from './lifecycleSources';
import { lifecycleHere } from './lifecycleHere';

const SOURCES = path.resolve(__dirname, '../../../scripts/crop-data-sources.json');
const sources = JSON.parse(readFileSync(SOURCES, 'utf8')) as SourceMap;

let crops: CropPlugin[];
let herbs: CropPlugin[];

beforeAll(async () => {
  crops = (await getBaseRegistry()).crops();
  const byId = new Map(crops.map((c) => [c.pluginId, c]));
  herbs = HERB_PLUGIN_IDS.map((id) => byId.get(id)!).filter(Boolean);
}, 60_000);

describe('Phase 37B lifecycle and winter zone sources', () => {
  it('every listed herb has a quoted lifecycle or a lifecycle.notRecorded reason', () => {
    expect(herbs).toHaveLength(HERB_PLUGIN_IDS.length);
    expect(
      lifecycleQuoteGaps(herbs, sources),
      'quote the lifecycle under `lifecycle` in crop-data-sources.json, or give a reason under `lifecycle.notRecorded`'
    ).toEqual([]);
  });

  it('every winterHardyToZone value is sourced on every crop', () => {
    const items = crops
      .filter((c) => c.winterHardyToZone)
      .map((c) => ({
        pluginId: c.pluginId,
        paths: cropFactPaths(c).filter((p) => p === 'winterHardyToZone')
      }));
    expect(checkSources(items, sources)).toEqual([]);
    expect(winterHardyToZoneQuoteGaps(crops, sources)).toEqual([]);
  });

  it('SOURCED_LIFECYCLES is exactly the herbs whose lifecycle and zone are quoted', () => {
    const expected: Record<string, SourcedLifecycle> = {};
    for (const c of herbs) {
      const lifecycle = c.agronomy?.lifecycle;
      if (!lifecycle || sources[c.pluginId]?.lifecycle === undefined) continue;
      const zoneSourced = !!c.winterHardyToZone && sources[c.pluginId]?.winterHardyToZone;
      expected[c.pluginId] = {
        lifecycle,
        ...(zoneSourced ? { winterHardyToZone: c.winterHardyToZone } : {})
      };
    }
    expect(SOURCED_LIFECYCLES).toEqual(expected);
  });

  it('the verdict reads the same lifecycle the engine does', () => {
    for (const c of herbs) {
      const resolved = resolveCropAgronomy(c);
      const v = lifecycleHere(c, { zone: '7a', provenance: 'data' });
      if (resolved.source.lifecycle !== 'plugin') {
        expect(v.reason, c.pluginId).toBe('no-lifecycle');
      } else if (resolved.lifecycle === 'perennial') {
        expect(['perennial-here', 'tender-perennial', 'unknown'], c.pluginId).toContain(
          v.lifecycle
        );
      } else {
        expect(v.lifecycle, c.pluginId).toBe(resolved.lifecycle);
      }
    }
  });
});
