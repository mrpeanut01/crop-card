import { describe, expect, it } from 'vitest';
import {
  PROTECTION_KINDS,
  isActiveAt,
  isHeated,
  resolveNewProtection,
  shedsRain,
  type BlockProtection
} from './protection';

const base: BlockProtection = {
  id: 'p',
  blockId: 'b',
  kind: 'row-cover',
  springShiftDays: 7,
  fallShiftDays: 7,
  provenance: 'manual',
  installedOn: null,
  removedOn: null,
  seasonYear: null
};

describe('protection kinds', () => {
  it('only the heated greenhouse is heated', () => {
    expect(PROTECTION_KINDS.filter(isHeated)).toEqual(['greenhouse-heated']);
  });
  it('row cover lets rain through; plastic and roofs shed it', () => {
    expect(shedsRain('row-cover')).toBe(false);
    expect(shedsRain('other')).toBe(false);
    for (const k of [
      'low-tunnel',
      'caterpillar-tunnel',
      'high-tunnel',
      'cold-frame',
      'cloche',
      'greenhouse-unheated',
      'greenhouse-heated'
    ] as const) {
      expect(shedsRain(k)).toBe(true);
    }
  });
});

describe('isActiveAt', () => {
  it('is active with no dates', () => expect(isActiveAt(base, 1000)).toBe(true));
  it('is not active before install or after removal', () => {
    expect(isActiveAt({ ...base, installedOn: 2000 }, 1000)).toBe(false);
    expect(isActiveAt({ ...base, removedOn: 1000 }, 1000)).toBe(false);
    expect(isActiveAt({ ...base, installedOn: 500, removedOn: 1500 }, 1000)).toBe(true);
  });
  it('counts a one-season cover only in its own year', () => {
    const mid2026 = new Date(2026, 5, 1).getTime();
    const mid2027 = new Date(2027, 5, 1).getTime();
    const once = { ...base, seasonYear: 2026, installedOn: null, removedOn: null };
    expect(isActiveAt(once, mid2026)).toBe(true);
    expect(isActiveAt(once, mid2027)).toBe(false);
    expect(isActiveAt(once, new Date(2025, 5, 1).getTime())).toBe(false);
    expect(isActiveAt({ ...base, seasonYear: null }, mid2027)).toBe(true);
  });
});

describe('resolveNewProtection', () => {
  it('keeps typed days as manual', () => {
    expect(resolveNewProtection('low-tunnel', { springShiftDays: 14 })).toEqual({
      springShiftDays: 14,
      fallShiftDays: null,
      provenance: 'manual'
    });
  });
  it('leaves an unsourced default unknown', () => {
    expect(resolveNewProtection('row-cover', {}).springShiftDays).toBeNull();
  });
});
