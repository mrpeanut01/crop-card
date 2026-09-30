import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPluginsFromDirectory } from '$lib/plugins/loader';
import { PluginRegistry } from '$lib/plugins/registry';
import { SEED_START_BY_FAMILY } from '$lib/plugins/familyDefaults';
import {
  CROP_SOURCED_GUIDE_FIELDS,
  checkSources,
  cropFactPaths,
  type SourceMap
} from '$lib/plugins/sourceCoverage';
import { resolveSeedStartTiming, seedStartPlan } from './seedStart';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const sources = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'apps/web/scripts/crop-data-sources.json'), 'utf8')
) as SourceMap;

let library: PluginRegistry;
beforeAll(async () => {
  library = new PluginRegistry();
  await loadPluginsFromDirectory(library, path.join(REPO_ROOT, 'plugins'));
});

describe('E1 seed-start source gate', () => {
  it('dtmFrom moves harvest dates, so it must be sourced', () => {
    expect(CROP_SOURCED_GUIDE_FIELDS).toContain('dtmFrom');
  });

  it('every plugin seed-start value is quoted', () => {
    const items = library.crops().map((c) => ({ pluginId: c.pluginId, paths: cropFactPaths(c) }));
    expect(checkSources(items, sources)).toEqual([]);
  });

  it('every family fallback is quoted under family:<cropFamily>', () => {
    const items = Object.entries(SEED_START_BY_FAMILY).map(([family, v]) => ({
      pluginId: `family:${family}`,
      paths: Object.keys(v)
    }));
    expect(checkSources(items, sources)).toEqual([]);
  });

  it('ships sourced indoor-start timing for at least the cole crops', () => {
    const timed = library
      .crops()
      .filter((c) => resolveSeedStartTiming(c).startIndoorsWeeks?.source === 'plugin')
      .map((c) => c.pluginId);
    expect(timed).toContain('cabbage-red-acre');
    for (const id of timed) {
      const plugin = library.crops().find((c) => c.pluginId === id)!;
      const plan = seedStartPlan(Date.UTC(2026, 4, 10), resolveSeedStartTiming(plugin));
      expect(plan.steps.map((s) => s.step)).toEqual(['sow', 'harden', 'transplant']);
    }
  });
});
