import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isTestPluginId } from './testPlugins';

describe('isTestPluginId', () => {
  it('flags the shipped click-through fixtures and nothing real', () => {
    const root = path.resolve('../../plugins');
    const ids = ['crops', 'herbicides', 'insecticides', 'fungicides', 'fertilizers', 'companions']
      .flatMap((d) => readdirSync(path.join(root, d)).filter((f) => f.endsWith('.json')))
      .map((f) => f.replace(/\.json$/, ''));
    expect(ids.filter(isTestPluginId).sort()).toEqual([
      'ct-test-herbicide-clickthrough',
      'test-corn-variety-ct-001'
    ]);
  });
});
