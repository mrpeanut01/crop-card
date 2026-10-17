import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPluginsFromDirectory } from './loader';
import { PluginRegistry } from './registry';
import {
  cropFactPaths,
  herbActionStem,
  herbSeasonalRowSourceGaps,
  seasonalTaskNumberGaps,
  type SourceMap
} from './sourceCoverage';
import { HERB_PLUGIN_IDS, isHerbGardenCrop } from '$lib/garden/herbs';
import type { CropPlugin } from './schemas';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const PLUGINS_DIR = path.join(REPO_ROOT, 'plugins');
const SOURCES = path.join(REPO_ROOT, 'apps/web/scripts/crop-data-sources.json');
const cropSources: SourceMap = existsSync(SOURCES)
  ? (JSON.parse(readFileSync(SOURCES, 'utf8')) as SourceMap)
  : {};

let library: PluginRegistry;
beforeAll(async () => {
  library = new PluginRegistry();
  await loadPluginsFromDirectory(library, PLUGINS_DIR);
});

type Row = NonNullable<CropPlugin['seasonalTasks']>[number];
function row(key: string, title: string, body?: string): Row {
  return { key, kind: 'cultural', dayOfYear: 170, windowDays: 7, title, body } as Row;
}
function herb(rows: Row[], pluginId = 'basil-genovese', displayName = 'Basil — Genovese') {
  return { pluginId, displayName, seasonalTasks: rows };
}
const SOURCE = {
  url: 'https://extension.example.edu/herbs/basil',
  publisher: 'Example Extension',
  date: '2026-06-01',
  quote: 'Pinch basil flower buds as they form to keep the plant leafy.'
};

describe('Phase 37D herb seasonal rows (R-25)', () => {
  it('the shipped herb plugins pass the gate (no herb row ships yet)', () => {
    expect(herbSeasonalRowSourceGaps(library.crops(), cropSources, isHerbGardenCrop)).toEqual([]);
    expect(seasonalTaskNumberGaps(library.crops(), cropSources)).toEqual([]);
  });

  it('ships no herb seasonal row until the research pass quotes one', () => {
    const rows = library
      .crops()
      .filter((c) => isHerbGardenCrop(c.pluginId))
      .flatMap((c) => (c.seasonalTasks ?? []).map((r) => `${c.pluginId}:${r.key}`));
    expect(rows).toEqual([]);
    expect(HERB_PLUGIN_IDS.length).toBeGreaterThan(0);
  });

  it('refuses a herb row with no source', () => {
    expect(
      herbSeasonalRowSourceGaps([herb([row('pinch', 'Pinch the tips')])], {}, isHerbGardenCrop)
    ).toEqual(['basil-genovese seasonalTasks.pinch: no source']);
  });

  it('accepts a row whose .edu quote names the action and the herb', () => {
    const sources = { 'basil-genovese': { 'seasonalTasks.pinch': SOURCE } };
    expect(
      herbSeasonalRowSourceGaps(
        [herb([row('pinch', 'Pinch flower buds')])],
        sources,
        isHerbGardenCrop
      )
    ).toEqual([]);
  });

  it('refuses a source off .edu and .gov, a quote without the action, and one without the herb', () => {
    const gaps = herbSeasonalRowSourceGaps(
      [herb([row('divide', 'Divide the clump')])],
      {
        'basil-genovese': {
          'seasonalTasks.divide': { ...SOURCE, url: 'https://seeds.example.com/basil' }
        }
      },
      isHerbGardenCrop
    );
    expect(gaps).toEqual([
      'basil-genovese seasonalTasks.divide: source is not an .edu or .gov page',
      'basil-genovese seasonalTasks.divide: quote does not name the action "Divide"'
    ]);
    const noHerb = herbSeasonalRowSourceGaps(
      [herb([row('pinch', 'Pinch flower buds')])],
      {
        'basil-genovese': {
          'seasonalTasks.pinch': { ...SOURCE, quote: 'Pinch flower buds as they form on plants.' }
        }
      },
      isHerbGardenCrop
    );
    expect(noHerb).toEqual(['basil-genovese seasonalTasks.pinch: quote does not name the herb']);
  });

  it('matches the herb by any word of its display name, plural or in parentheses', () => {
    const quote = 'Cut back holy basil after flowering to keep it bushy.';
    const sources = {
      'tulsi-holy-basil-rama': { 'seasonalTasks.cut': { ...SOURCE, quote } },
      'chives-common': {
        'seasonalTasks.split': { ...SOURCE, quote: 'Divide chive clumps every few years.' }
      }
    };
    expect(
      herbSeasonalRowSourceGaps(
        [
          herb(
            [row('cut', 'Cut back after bloom')],
            'tulsi-holy-basil-rama',
            'Tulsi Rama (Holy Basil)'
          ),
          herb([row('split', 'Divide the clumps')], 'chives-common', 'Chives — Common')
        ],
        sources,
        isHerbGardenCrop
      )
    ).toEqual([]);
  });

  it('leaves rows on other crops to the existing gates', () => {
    expect(
      herbSeasonalRowSourceGaps(
        [herb([row('prune', 'Prune canes')], 'blackberry-triple-crown', 'Blackberry')],
        {},
        isHerbGardenCrop
      )
    ).toEqual([]);
  });

  it('asks cropFactPaths for a source on every herb row and on no other crop row', () => {
    const basil = library.get('basil-genovese')?.plugin as CropPlugin;
    expect(cropFactPaths({ ...basil, seasonalTasks: [row('pinch', 'Pinch tips')] })).toContain(
      'seasonalTasks.pinch'
    );
    const berry = library.get('blackberry-triple-crown')?.plugin as CropPlugin;
    expect(cropFactPaths(berry).some((p) => p.startsWith('seasonalTasks.'))).toBe(false);
  });

  it('stems the action verb', () => {
    expect(herbActionStem('Pinch the tips')).toBe('pinc');
    expect(herbActionStem('Divide')).toBe('divi');
    expect(herbActionStem('Cut back')).toBe('cut');
    expect(herbActionStem('Sow again')).toBe('sow');
  });
});
