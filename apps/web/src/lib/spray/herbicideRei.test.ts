import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { activeHerbicideReEntry, herbicideReiLookbackMs } from './herbicideRei';

const H = 60 * 60 * 1000;
const NOW = Date.UTC(2027, 3, 25, 12);
const rei: Record<string, number> = { dual: 24, aatrex: 12, gramoxone: 48 };
const reiOf = (id: string) => rei[id];

describe('activeHerbicideReEntry', () => {
  it('holds a block until the label REI has passed', () => {
    const events = [
      { id: 'a', blockId: 'b1', occurredAt: NOW - 10 * H, products: [{ pluginId: 'dual' }] },
      { id: 'b', blockId: 'b2', occurredAt: NOW - 13 * H, products: [{ pluginId: 'aatrex' }] }
    ];
    expect(activeHerbicideReEntry(events, reiOf, NOW)).toEqual([
      { id: 'a', blockId: 'b1', reEntryClearAt: NOW + 14 * H }
    ]);
  });

  it('uses the longest REI in a tank mix', () => {
    const events = [
      {
        id: 'a',
        blockId: 'b1',
        occurredAt: NOW - 30 * H,
        products: [{ pluginId: 'aatrex' }, { pluginId: 'gramoxone' }]
      }
    ];
    expect(activeHerbicideReEntry(events, reiOf, NOW)[0]?.reEntryClearAt).toBe(NOW + 18 * H);
  });

  it('leaves out sprays whose products have no REI on file', () => {
    const events = [
      { id: 'a', blockId: 'b1', occurredAt: NOW, products: [{ pluginId: 'generic' }] }
    ];
    expect(activeHerbicideReEntry(events, reiOf, NOW)).toEqual([]);
  });

  it('still counts the clear moment itself as inside the interval', () => {
    const events = [
      { id: 'a', blockId: 'b1', occurredAt: NOW - 12 * H, products: [{ pluginId: 'aatrex' }] }
    ];
    expect(activeHerbicideReEntry(events, reiOf, NOW)).toHaveLength(1);
  });

  it('never clears before occurredAt plus the longest known REI', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('dual', 'aatrex', 'gramoxone', 'generic'), {
          minLength: 1,
          maxLength: 4
        }),
        fc.integer({ min: 0, max: 72 * 60 }),
        (ids, minutesAgo) => {
          const occurredAt = NOW - minutesAgo * 60 * 1000;
          const known = ids.map(reiOf).filter((h): h is number => h !== undefined);
          const out = activeHerbicideReEntry(
            [
              { id: 'x', blockId: 'b', occurredAt, products: ids.map((pluginId) => ({ pluginId })) }
            ],
            reiOf,
            NOW
          );
          if (known.length === 0) return out.length === 0;
          const clear = occurredAt + Math.max(...known) * H;
          return clear >= NOW ? out[0]?.reEntryClearAt === clear : out.length === 0;
        }
      )
    );
  });
});

describe('herbicideReiLookbackMs', () => {
  it('is the longest REI on file', () => {
    expect(herbicideReiLookbackMs([12, undefined, 48, 24])).toBe(48 * H);
    expect(herbicideReiLookbackMs([])).toBe(0);
  });
});
