import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { PluginRegistry } from '$lib/plugins';
import {
  activeReEntryItems,
  longestLibraryReiHours,
  reEntryReadStart,
  type ReEntryCardInput
} from './reEntryCard';

const HOUR = 60 * 60 * 1000;

type Plug = { pluginId: string; type: string; displayName: string; reEntryIntervalHours?: number };

function registryOf(plugins: Plug[]): Pick<PluginRegistry, 'get' | 'all'> {
  const byId = new Map(plugins.map((p) => [p.pluginId, { plugin: p }]));
  return {
    get: (id: string) => byId.get(id) as never,
    all: () => [...byId.values()] as never
  };
}

const REGISTRY = registryOf([
  { pluginId: 'herb-12', type: 'herbicide', displayName: 'Herb Twelve', reEntryIntervalHours: 12 },
  {
    pluginId: 'herb-48',
    type: 'herbicide',
    displayName: 'Herb FortyEight',
    reEntryIntervalHours: 48
  },
  { pluginId: 'herb-none', type: 'herbicide', displayName: 'Herb Unknown' },
  { pluginId: 'ins-72', type: 'insecticide', displayName: 'Bug 72', reEntryIntervalHours: 72 },
  { pluginId: 'fun-4', type: 'fungicide', displayName: 'Fung 4', reEntryIntervalHours: 4 },
  { pluginId: 'crop', type: 'crop', displayName: 'Corn', reEntryIntervalHours: 999 }
]);

const BLOCKS = new Map([
  ['b1', 'North bed'],
  ['b2', 'South field']
]);

function spray(
  id: string,
  blockId: string,
  occurredAt: number,
  pluginIds: string[],
  stored?: number
) {
  return {
    id,
    blockId,
    occurredAt,
    reEntryClearAt: stored,
    products: pluginIds.map((pluginId) => ({ pluginId, chemistryClasses: [] }))
  };
}

function stored(
  id: string,
  blockId: string,
  occurredAt: number,
  clearAt: number | undefined,
  name: string
) {
  return {
    id,
    blockId,
    occurredAt,
    reEntryClearAt: clearAt,
    products: [{ pluginId: name.toLowerCase(), displayName: name, iracGroups: [], fracCodes: [] }]
  };
}

function input(over: Partial<ReEntryCardInput>): ReEntryCardInput {
  return {
    registry: REGISTRY,
    sprays: [],
    insecticides: [],
    fungicides: [],
    blockNameById: BLOCKS,
    now: Date.UTC(2026, 5, 1, 12),
    ...over
  };
}

describe('longestLibraryReiHours', () => {
  it('takes the longest REI over herbicides, insecticides and fungicides only', () => {
    expect(longestLibraryReiHours(REGISTRY)).toBe(72);
    expect(longestLibraryReiHours(registryOf([]))).toBe(0);
  });
});

describe('reEntryReadStart', () => {
  it('starts at the year start unless the longest REI reaches back past it', () => {
    const yearStart = Date.UTC(2026, 0, 1);
    expect(reEntryReadStart(yearStart, Date.UTC(2026, 5, 1), 72)).toBe(yearStart);
    const jan1Morning = Date.UTC(2026, 0, 1, 10);
    expect(reEntryReadStart(yearStart, jan1Morning, 72)).toBe(jan1Morning - 72 * HOUR);
  });
});

describe('activeReEntryItems', () => {
  it('keeps a spray whose REI crosses January 1, while the YTD count leaves it out', () => {
    const yearStart = Date.UTC(2026, 0, 1);
    const now = Date.UTC(2026, 0, 1, 10);
    const lastNight = Date.UTC(2025, 11, 31, 22);
    const readFrom = reEntryReadStart(yearStart, now, longestLibraryReiHours(REGISTRY));
    const sprays = [spray('s-dec', 'b1', lastNight, ['herb-48'])].filter(
      (e) => e.occurredAt >= readFrom
    );
    const insecticides = [stored('i-dec', 'b2', lastNight, lastNight + 72 * HOUR, 'Bug 72')].filter(
      (e) => e.occurredAt >= readFrom
    );
    const items = activeReEntryItems(input({ sprays, insecticides, now }));
    expect(items.map((i) => [i.recordId, i.clearAt])).toEqual([
      ['s-dec', lastNight + 48 * HOUR],
      ['i-dec', lastNight + 72 * HOUR]
    ]);
    const ytd = [...sprays, ...insecticides].filter((e) => e.occurredAt >= yearStart);
    expect(ytd).toHaveLength(0);
  });

  it('shows no clear time for a tank mix with a product that has no REI on file', () => {
    const now = Date.UTC(2026, 5, 1, 12);
    const items = activeReEntryItems(
      input({ sprays: [spray('mix', 'b1', now - HOUR, ['herb-12', 'herb-none'])], now })
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      recordKind: 'spray',
      blockName: 'North bed',
      products: ['Herb Twelve', 'Herb Unknown'],
      clearAt: null
    });
  });

  it('leaves out a spray with no REI on file for any product, and legacy rows with none stored', () => {
    const now = Date.UTC(2026, 5, 1, 12);
    const items = activeReEntryItems(
      input({
        sprays: [spray('none', 'b1', now - HOUR, ['herb-none'])],
        insecticides: [stored('legacy', 'b1', now - HOUR, undefined, 'Bug 72')],
        now
      })
    );
    expect(items).toEqual([]);
  });

  it('lists soonest clear first across herbicide, insecticide and fungicide sprays', () => {
    const now = Date.UTC(2026, 5, 1, 12);
    const items = activeReEntryItems(
      input({
        sprays: [spray('h', 'b1', now - HOUR, ['herb-48'])],
        insecticides: [stored('i', 'b2', now - HOUR, now + 2 * HOUR, 'Bug 72')],
        fungicides: [stored('f', 'gone', now - HOUR, now + 3 * HOUR, 'Fung 4')],
        now
      })
    );
    expect(items.map((i) => i.recordId)).toEqual(['i', 'f', 'h']);
    expect(items.map((i) => i.recordKind)).toEqual(['insecticide', 'fungicide', 'spray']);
    expect(items[1].blockName).toBeNull();
  });

  it('goes away once the last REI clears', () => {
    const sprayedAt = Date.UTC(2026, 5, 1, 6);
    const base = {
      sprays: [spray('h', 'b1', sprayedAt, ['herb-12'])],
      fungicides: [stored('f', 'b2', sprayedAt, sprayedAt + 4 * HOUR, 'Fung 4')]
    };
    expect(activeReEntryItems(input({ ...base, now: sprayedAt + 3 * HOUR }))).toHaveLength(2);
    expect(
      activeReEntryItems(input({ ...base, now: sprayedAt + 5 * HOUR })).map((i) => i.recordId)
    ).toEqual(['h']);
    expect(activeReEntryItems(input({ ...base, now: sprayedAt + 12 * HOUR + 1 }))).toEqual([]);
  });

  it('keeps a stored herbicide clear time that is later than the library value', () => {
    const now = Date.UTC(2026, 5, 1, 12);
    const items = activeReEntryItems(
      input({ sprays: [spray('h', 'b1', now - HOUR, ['herb-12'], now + 30 * HOUR)], now })
    );
    expect(items[0].clearAt).toBe(now + 30 * HOUR);
  });

  it('always lists active items in clear order and never one that has cleared', () => {
    const now = Date.UTC(2026, 5, 1, 12);
    const row = fc.record({
      offsetH: fc.integer({ min: -100, max: 100 }),
      kind: fc.constantFrom('i', 'f')
    });
    fc.assert(
      fc.property(fc.array(row, { maxLength: 12 }), (rows) => {
        const ins = rows
          .map((r, n) => ({ ...r, n }))
          .filter((r) => r.kind === 'i')
          .map((r) => stored(`i${r.n}`, 'b1', now - HOUR, now + r.offsetH * HOUR, 'Bug 72'));
        const fun = rows
          .map((r, n) => ({ ...r, n }))
          .filter((r) => r.kind === 'f')
          .map((r) => stored(`f${r.n}`, 'b2', now - HOUR, now + r.offsetH * HOUR, 'Fung 4'));
        const items = activeReEntryItems(input({ insecticides: ins, fungicides: fun, now }));
        expect(items).toHaveLength(rows.filter((r) => r.offsetH >= 0).length);
        for (let k = 1; k < items.length; k++)
          expect(items[k].clearAt!).toBeGreaterThanOrEqual(items[k - 1].clearAt!);
        for (const it of items) expect(it.clearAt!).toBeGreaterThanOrEqual(now);
      })
    );
  });
});
