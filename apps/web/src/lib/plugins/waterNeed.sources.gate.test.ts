import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPluginsFromDirectory } from './loader';
import { PluginRegistry } from './registry';
import { checkSources, cropFactPaths, waterNeedQuoteGaps, type SourceMap } from './sourceCoverage';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SOURCES = path.join(REPO_ROOT, 'apps/web/scripts/crop-data-sources.json');
const cropSources: SourceMap = existsSync(SOURCES)
  ? (JSON.parse(readFileSync(SOURCES, 'utf8')) as SourceMap)
  : {};

let library: PluginRegistry;

beforeAll(async () => {
  library = new PluginRegistry();
  await loadPluginsFromDirectory(library, path.join(REPO_ROOT, 'plugins'));
});

describe('Phase 37E waterNeed gate', () => {
  it('every waterNeed source maps to the shipped value, and none disagree', () => {
    expect(waterNeedQuoteGaps(library.crops(), cropSources)).toEqual([]);
    expect(library.crops().filter((c) => c.waterNeed).length).toBeGreaterThan(0);
  });

  it('every shipped waterNeed is in the source coverage check', () => {
    const items = library
      .crops()
      .filter((c) => c.waterNeed)
      .map((c) => ({ pluginId: c.pluginId, paths: cropFactPaths(c) }));
    for (const item of items) expect(item.paths).toContain('waterNeed');
    expect(checkSources(items, cropSources)).toEqual([]);
  });
});
