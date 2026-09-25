import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkCoverage,
  isInputPlugin,
  type AllowlistEntry,
  type InputPlugin
} from './inputMetadata';
import { pluginSchema } from './schemas';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const PLUGINS_DIR = path.join(REPO_ROOT, 'plugins');
const ALLOWLIST = path.join(REPO_ROOT, 'apps/web/scripts/plugin-metadata-allowlist.json');
const INPUT_DIRS = ['herbicides', 'insecticides', 'fungicides', 'fertilizers'];

function loadInputPlugins(): InputPlugin[] {
  const out: InputPlugin[] = [];
  for (const dir of INPUT_DIRS) {
    for (const file of readdirSync(path.join(PLUGINS_DIR, dir)).filter((f) =>
      f.endsWith('.json')
    )) {
      const plugin = pluginSchema.parse(
        JSON.parse(readFileSync(path.join(PLUGINS_DIR, dir, file), 'utf8'))
      );
      if (isInputPlugin(plugin)) out.push(plugin);
    }
  }
  return out;
}

describe('#255 input-plugin metadata coverage gate', () => {
  const plugins = loadInputPlugins();
  const allowlist = (JSON.parse(readFileSync(ALLOWLIST, 'utf8')) as { entries: AllowlistEntry[] })
    .entries;
  const report = checkCoverage(plugins, allowlist);

  it('loads the input plugin library', () => {
    expect(plugins.length).toBeGreaterThan(200);
  });

  it('every defaultUnit / activeIngredients / formulation gap is allowlisted with a reason', () => {
    expect(
      report.unallowlisted,
      'add the field to the plugin JSON, or allowlist it in apps/web/scripts/plugin-metadata-allowlist.json with a reason'
    ).toEqual([]);
    for (const e of allowlist) expect(e.reason.trim().length, e.pluginId).toBeGreaterThan(10);
  });

  it('the allowlist has no stale entries', () => {
    expect(report.stale, 'remove allowlist entries for gaps that have been filled').toEqual([]);
  });

  it('the allowlist has no duplicates', () => {
    const keys = allowlist.map((e) => `${e.pluginId}::${e.field}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
