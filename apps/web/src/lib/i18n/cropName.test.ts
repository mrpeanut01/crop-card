import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cropDisplayName, cropDisplayNameByEnglish } from './cropName';
import { CROP_ID_BY_NAME, CROP_NAMES_ES } from './cropNames.es';

const CROPS_DIR = resolve(__dirname, '../../../../../plugins/crops');

const plugins = readdirSync(CROPS_DIR)
  .filter((f) => f.endsWith('.json'))
  .map(
    (f) =>
      JSON.parse(readFileSync(resolve(CROPS_DIR, f), 'utf8')) as {
        pluginId: string;
        displayName: string;
      }
  );

describe('Spanish crop names', () => {
  it('has an entry for every crop plugin', () => {
    const missing = plugins.map((p) => p.pluginId).filter((id) => !(id in CROP_NAMES_ES));
    expect(missing).toEqual([]);
  });

  it('only keys existing crop plugin ids', () => {
    const ids = new Set(plugins.map((p) => p.pluginId));
    expect(Object.keys(CROP_NAMES_ES).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('has no empty or untrimmed entry and no dashes', () => {
    for (const [id, name] of Object.entries(CROP_NAMES_ES)) {
      expect(name.trim(), id).not.toBe('');
      expect(name, id).toBe(name.trim());
      expect(name, id).not.toMatch(/[–—]/);
    }
  });

  it('indexes every plugin display name to its id', () => {
    for (const p of plugins) expect(CROP_ID_BY_NAME[p.displayName]).toBe(p.pluginId);
    expect(Object.keys(CROP_ID_BY_NAME)).toHaveLength(plugins.length);
  });
});

describe('cropDisplayName', () => {
  const id = 'pepper-bell-red-revolution';
  const english = 'Pepper Bell Revolution F1 (red)';

  it('returns the English name outside Spanish', () => {
    expect(cropDisplayName(id, english, 'en')).toBe(english);
    expect(cropDisplayName(id, english, null)).toBe(english);
    expect(cropDisplayName(id, english, undefined)).toBe(english);
  });

  it('returns the Spanish name in Spanish', () => {
    expect(cropDisplayName(id, english, 'es')).toBe('Pimiento morrón Revolution F1 (rojo)');
    expect(cropDisplayName(id, '', 'es')).toBe('Pimiento morrón Revolution F1 (rojo)');
  });

  it('keeps a name the owner typed', () => {
    expect(cropDisplayName(id, 'Grandpa red peppers', 'es')).toBe('Grandpa red peppers');
  });

  it('falls back to English for an unknown or missing id', () => {
    expect(cropDisplayName('custom-crop', 'Custom', 'es')).toBe('Custom');
    expect(cropDisplayName(null, 'Custom', 'es')).toBe('Custom');
  });
});

describe('cropDisplayNameByEnglish', () => {
  it('maps a plugin display name to Spanish', () => {
    expect(cropDisplayNameByEnglish('Sweet Corn American Dream F1 Seed', 'es')).toBe(
      'Maíz dulce American Dream F1'
    );
    expect(cropDisplayNameByEnglish('Sweet Corn American Dream F1 Seed', 'en')).toBe(
      'Sweet Corn American Dream F1 Seed'
    );
  });

  it('falls back to the given name', () => {
    expect(cropDisplayNameByEnglish('My own crop', 'es')).toBe('My own crop');
  });
});
