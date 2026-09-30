// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPhase32DataKinds, type Phase32DataKinds } from '$lib/plugins/registryDataKinds';
import { checkSources, pestModelFactPaths, type SourceMap } from '$lib/plugins/sourceCoverage';
import { isTestPluginId } from '$lib/plugins/testPlugins';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SOURCES = path.join(REPO_ROOT, 'apps/web/scripts/pest-model-sources.json');

const sources: SourceMap = existsSync(SOURCES)
  ? (JSON.parse(readFileSync(SOURCES, 'utf8')) as { entries: SourceMap }).entries
  : {};

let kinds: Phase32DataKinds;
beforeAll(async () => {
  kinds = await loadPhase32DataKinds(path.join(REPO_ROOT, 'plugins'));
});

// Ruling E5-6: a model ships only with its base, cutoff, method, biofix and
// every stage threshold quoted. The shared gate covers the numbers; this adds
// the method and the biofix kind.
describe('pest-model sources (E5-6)', () => {
  it('every shipped model quotes its numbers, method and biofix', () => {
    const items = kinds.pestModels.all().map((p) => ({
      pluginId: p.pluginId,
      paths: [...pestModelFactPaths(p), 'method', 'biofix.kind']
    }));
    expect(checkSources(items, sources)).toEqual([]);
  });

  it('no test fixture model lives in plugins/', () => {
    expect(kinds.pestModels.all().filter((p) => isTestPluginId(p.pluginId))).toEqual([]);
    expect(kinds.pestModels.all().filter((p) => p.pluginId.startsWith('test-'))).toEqual([]);
  });

  it('every source entry names a plugin that exists', () => {
    const orphans = Object.keys(sources).filter((id) => !kinds.pestModels.has(id));
    expect(orphans).toEqual([]);
  });
});
