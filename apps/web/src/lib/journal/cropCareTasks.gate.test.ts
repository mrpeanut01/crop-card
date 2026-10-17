import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPluginsFromDirectory } from '$lib/plugins/loader';
import { PluginRegistry } from '$lib/plugins/registry';
import {
  checkSources,
  cropCareQuoteGaps,
  cropFactPaths,
  type SourceMap
} from '$lib/plugins/sourceCoverage';
import { cropCareTaskSchema, type CropPlugin } from '$lib/plugins/schemas';
import { enHerbsf } from '$lib/i18n/catalogs/en/herbsf';
import { esHerbsf } from '$lib/i18n/catalogs/es/herbsf';
import { isSprayAdvice } from './photoHelp';
import { cropCareMessageKey, cropCareTasksOf, cropCareText } from './cropCareTasks';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const sources = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'apps/web/scripts/crop-data-sources.json'), 'utf8')
) as SourceMap;

let crops: CropPlugin[];

beforeAll(async () => {
  const library = new PluginRegistry();
  await loadPluginsFromDirectory(library, path.join(REPO_ROOT, 'plugins'));
  crops = library.crops();
});

const EN = enHerbsf as Record<string, string | undefined>;
const ES = esHerbsf as Record<string, string | undefined>;

describe('37F crop care task gate (real files)', () => {
  it('every crop care task and growth habit is quoted from an allowed page', () => {
    const items = crops.map((c) => ({ pluginId: c.pluginId, paths: cropFactPaths(c) }));
    const care = checkSources(items, sources).filter(
      (g) => g.path.startsWith('careTasks.') || g.path === 'growthHabit'
    );
    expect(care).toEqual([]);
    expect(cropCareQuoteGaps(crops, sources)).toEqual([]);
  });

  it('moves the basil pinch step onto basil (R-20)', () => {
    const basil = crops.find((c) => c.pluginId === 'basil-genovese');
    expect(basil?.careTasks?.map((t) => t.key)).toContain('pinch-stems');
  });

  it('ships every care task in English and Spanish and never as spray advice', () => {
    for (const c of crops) {
      for (const task of c.careTasks ?? []) {
        for (const part of ['title', 'body'] as const) {
          const text = task[part];
          const key = cropCareMessageKey(c.pluginId, task.key, part);
          if (text === undefined) {
            expect(EN[key], key).toBeUndefined();
            continue;
          }
          expect(EN[key], key).toBe(text);
          expect(ES[key], key).toBeTruthy();
          expect(isSprayAdvice(text), key).toBe(false);
        }
      }
    }
  });

  it('has no catalog text for a care task that is not shipped', () => {
    const shipped = new Set(
      crops.flatMap((c) =>
        (c.careTasks ?? []).flatMap((t) =>
          (['title', 'body'] as const)
            .filter((p) => t[p] !== undefined)
            .map((p) => cropCareMessageKey(c.pluginId, t.key, p))
        )
      )
    );
    const keys = Object.keys(EN).filter((k) => k.startsWith('herbsf.care.'));
    expect(keys.filter((k) => !shipped.has(k))).toEqual([]);
  });
});

describe('cropCareQuoteGaps', () => {
  const entry = {
    url: 'https://extension.example.edu/basil',
    publisher: 'Example Extension',
    date: '2026-01-01',
    quote: 'Pinch stems as they lengthen. Basil is a woody herb that forms clumps.'
  };
  const task = { key: 'pinch', topic: 'prune' as const, title: 'Pinch stems as they lengthen.' };

  it('passes a task quoted word for word', () => {
    expect(
      cropCareQuoteGaps([{ pluginId: 'p', careTasks: [task] }], {
        p: { 'careTasks.pinch': entry }
      })
    ).toEqual([]);
  });

  it('fails a reworded task, a body not in the quote and a disallowed host', () => {
    expect(
      cropCareQuoteGaps(
        [{ pluginId: 'p', careTasks: [{ ...task, title: 'Pinch the stems often.' }] }],
        { p: { 'careTasks.pinch': entry } }
      )
    ).toEqual(['p: careTasks.pinch text is not in its quote word for word']);
    expect(
      cropCareQuoteGaps([{ pluginId: 'p', careTasks: [{ ...task, body: 'Water well.' }] }], {
        p: { 'careTasks.pinch': entry }
      })
    ).toEqual(['p: careTasks.pinch text is not in its quote word for word']);
    expect(
      cropCareQuoteGaps([{ pluginId: 'p', careTasks: [task] }], {
        p: { 'careTasks.pinch': { ...entry, url: 'https://seeds.example.com/basil' } }
      })
    ).toEqual(['p: careTasks.pinch source is not an extension or government page']);
  });

  it('checks a growth habit names itself in the quote', () => {
    expect(
      cropCareQuoteGaps([{ pluginId: 'p', growthHabit: 'woody' }], { p: { growthHabit: entry } })
    ).toEqual([]);
    expect(
      cropCareQuoteGaps([{ pluginId: 'p', growthHabit: 'clumping' }], {
        p: { growthHabit: { ...entry, quote: 'A tall leafy annual herb.' } }
      })
    ).toEqual(['p: growthHabit quote does not name clumping']);
  });

  it('asks cropFactPaths for each care task and the growth habit', () => {
    const c = { careTasks: [task], growthHabit: 'woody' } as unknown as CropPlugin;
    expect(cropFactPaths(c)).toEqual(expect.arrayContaining(['careTasks.pinch', 'growthHabit']));
  });
});

describe('crop care rows', () => {
  it('validate their shape', () => {
    expect(cropCareTaskSchema.safeParse({ key: 'Pinch', topic: 'prune', title: 'x' }).success).toBe(
      false
    );
    expect(cropCareTaskSchema.safeParse({ key: 'pinch', topic: 'spray', title: 'x' }).success).toBe(
      false
    );
  });

  it('carry their topic into the snapshot', () => {
    expect(
      cropCareTasksOf({ careTasks: [{ key: 'a', topic: 'harvest', title: 'T', body: 'B' }] })
    ).toEqual([{ key: 'a', title: 'T', body: 'B', crop: 'harvest' }]);
  });

  it('show Spanish only while the text is the shipped English', () => {
    const key = 'pinch-stems';
    const en = EN[cropCareMessageKey('basil-genovese', key, 'title')]!;
    expect(cropCareText('basil-genovese', key, 'title', en)).toBe(en);
    expect(cropCareText('basil-genovese', key, 'title', en, 'es')).toBe(
      ES[cropCareMessageKey('basil-genovese', key, 'title')]
    );
    expect(cropCareText('basil-genovese', key, 'title', 'My own words', 'es')).toBe('My own words');
  });
});
