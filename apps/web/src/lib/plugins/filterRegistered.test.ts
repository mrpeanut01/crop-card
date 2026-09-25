import { describe, expect, it } from 'vitest';
import { filterRegisteredPlugins } from './filterRegistered';

const records = [
  { pluginId: 'roundup-powermax', displayName: 'Roundup PowerMAX' },
  { pluginId: 'corn-bloody-butcher', displayName: 'Bloody Butcher Dent Corn' },
  { pluginId: 'sevin-xlr', displayName: 'Sevin XLR Plus' }
];

describe('filterRegisteredPlugins (#238)', () => {
  it('returns every record for an empty or blank query', () => {
    expect(filterRegisteredPlugins(records, '')).toHaveLength(3);
    expect(filterRegisteredPlugins(records, '   ')).toHaveLength(3);
  });

  it('matches display name case-insensitively', () => {
    expect(filterRegisteredPlugins(records, 'roundup').map((r) => r.pluginId)).toEqual([
      'roundup-powermax'
    ]);
  });

  it('matches plugin id', () => {
    expect(filterRegisteredPlugins(records, 'sevin-xlr')).toHaveLength(1);
  });

  it('requires every whitespace-separated term to match', () => {
    expect(filterRegisteredPlugins(records, 'dent corn')).toHaveLength(1);
    expect(filterRegisteredPlugins(records, 'dent roundup')).toHaveLength(0);
  });

  it('does not mutate the input list', () => {
    const out = filterRegisteredPlugins(records, '');
    expect(out).not.toBe(records);
    expect(records).toHaveLength(3);
  });
});
