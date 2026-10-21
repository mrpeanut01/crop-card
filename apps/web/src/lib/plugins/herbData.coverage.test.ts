import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPluginsFromDirectory } from './loader';
import { PluginRegistry } from './registry';
import { cropPluginSchema, type CropPlugin } from './schemas';
import {
  HERB_DATA_FIELDS,
  herbDataCoverageGaps,
  notRecordedEntrySchema,
  type HerbDataField,
  type SourceMap
} from './sourceCoverage';
import { HERB_PLUGIN_IDS } from '$lib/garden/herbs';

// CO-7: every Phase 37 herb field is filled or carries
// `<field>.notRecorded: { reason, checked: [url...], date }`; a gap reopens
// only through a new issue when a qualifying page appears.

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SOURCES = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'apps/web/scripts/crop-data-sources.json'), 'utf8')
) as SourceMap;

let crops: CropPlugin[] = [];
beforeAll(async () => {
  const registry = new PluginRegistry();
  await loadPluginsFromDirectory(registry, path.join(REPO_ROOT, 'plugins'));
  crops = registry
    .all()
    .map((r) => r.plugin)
    .filter((p): p is CropPlugin => p.type === 'crop');
});

describe('CO-7 herb data coverage, shipped library', () => {
  it('loads every herb garden plugin', () => {
    const ids = new Set(crops.map((c) => c.pluginId));
    expect(HERB_PLUGIN_IDS.filter((id) => !ids.has(id))).toEqual([]);
  });

  it('every herb field is filled or recorded as not recorded', () => {
    expect(herbDataCoverageGaps(crops, SOURCES)).toEqual([]);
  });

  it('checks lifecycle, zone, each preserving method, cadence, water need and timing', () => {
    expect(HERB_DATA_FIELDS.map((f) => f.key)).toEqual([
      'lifecycle',
      'winterHardyToZone',
      'preserving.fresh',
      'preserving.dry',
      'preserving.freeze',
      'preserving.freeze-dry',
      'preserving.infuse',
      'harvestCadence',
      'waterNeed',
      'harvestTiming'
    ]);
  });

  it('every checked page is a full https or http address', () => {
    for (const id of HERB_PLUGIN_IDS) {
      for (const [key, raw] of Object.entries(SOURCES[id] ?? {})) {
        if (!key.endsWith('.notRecorded')) continue;
        const entry = notRecordedEntrySchema.safeParse(raw);
        expect(entry.success, `${id} ${key}`).toBe(true);
      }
    }
  });
});

describe('herbDataCoverageGaps', () => {
  const thyme = cropPluginSchema.parse({
    pluginId: 'thyme-german-winter',
    type: 'crop',
    displayName: 'Thyme — German Winter',
    version: '1.0.0',
    cropFamily: 'herb-culinary',
    harvestStyle: 'cut-and-come-again',
    bloomWindow: { daysFromPlantingMin: 60, daysFromPlantingMax: 90, beeAttractive: true },
    agronomy: { lifecycle: 'perennial' },
    waterNeed: 'low'
  });
  const fields: readonly HerbDataField[] = HERB_DATA_FIELDS.filter((f) =>
    ['lifecycle', 'winterHardyToZone', 'waterNeed', 'harvestCadence'].includes(f.key)
  );
  const recorded = {
    reason: 'No checked page states an interval between cuts.',
    checked: ['https://extension.illinois.edu/herbs/thyme'],
    date: '2026-10-21'
  };

  it('names each empty field with no notRecorded entry', () => {
    expect(herbDataCoverageGaps([thyme], {}, fields)).toEqual([
      'thyme-german-winter: winterHardyToZone is neither filled nor recorded under winterHardyToZone.notRecorded',
      'thyme-german-winter: harvestCadence is neither filled nor recorded under harvestCadence.notRecorded'
    ]);
  });

  it('passes an empty field with a valid entry, refuses one beside a value', () => {
    const sources: SourceMap = {
      'thyme-german-winter': {
        'winterHardyToZone.notRecorded': recorded,
        'harvestCadence.notRecorded': recorded
      }
    };
    expect(herbDataCoverageGaps([thyme], sources, fields)).toEqual([]);
    expect(
      herbDataCoverageGaps(
        [thyme],
        { 'thyme-german-winter': { ...sources['thyme-german-winter'], 'waterNeed.notRecorded': recorded } },
        fields
      )
    ).toEqual(['thyme-german-winter: waterNeed is filled; drop waterNeed.notRecorded']);
  });

  it('refuses the old reason-only shape and an empty checked list', () => {
    const sources: SourceMap = {
      'thyme-german-winter': {
        'winterHardyToZone.notRecorded': { reason: recorded.reason },
        'harvestCadence.notRecorded': { ...recorded, checked: [] }
      }
    };
    expect(herbDataCoverageGaps([thyme], sources, fields)).toEqual([
      'thyme-german-winter: winterHardyToZone.notRecorded needs { reason, checked: [url...], date }',
      'thyme-german-winter: harvestCadence.notRecorded needs { reason, checked: [url...], date }'
    ]);
  });

  it('skips a field that does not apply, and refuses an entry for it', () => {
    const annual = { ...thyme, agronomy: { lifecycle: 'annual' as const } };
    const sources: SourceMap = {
      'thyme-german-winter': {
        'winterHardyToZone.notRecorded': recorded,
        'harvestCadence.notRecorded': recorded
      }
    };
    expect(herbDataCoverageGaps([annual], sources, fields)).toEqual([
      'thyme-german-winter: winterHardyToZone.notRecorded on a crop the field does not apply to'
    ]);
  });

  it('ignores crops outside the herb garden list', () => {
    expect(herbDataCoverageGaps([{ ...thyme, pluginId: 'tomato-roma' }], {}, fields)).toEqual([]);
  });

  it('takes an extended field list', () => {
    const extra: HerbDataField = { key: 'sunNeed', filled: () => false };
    expect(herbDataCoverageGaps([thyme], {}, [extra])).toEqual([
      'thyme-german-winter: sunNeed is neither filled nor recorded under sunNeed.notRecorded'
    ]);
  });
});
