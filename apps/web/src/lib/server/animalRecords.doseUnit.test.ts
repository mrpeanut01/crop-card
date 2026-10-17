// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { doseStockUnit } from './animalRecords';
import { normalizeUnitName } from '$lib/stock/unitName';
import { ALL_STOCK_UNITS } from '$lib/stock/units';

/** The parser before it used the shared spelling, kept to prove it only widened. */
function previousParser(unit: string | null | undefined): string | null {
  const u = unit?.trim().toLowerCase();
  return u && (ALL_STOCK_UNITS as readonly string[]).includes(u) ? u : null;
}

const casings = (u: string) => [u, u.toUpperCase(), ` ${u} `, `\t${u}\n`];

describe('doseStockUnit', () => {
  it('reads every spelling the previous parser accepted the same way', () => {
    const spellings = ALL_STOCK_UNITS.flatMap(casings).concat(['mL', 'Fl-Oz', 'GAL', 'Lb']);
    for (const s of spellings) {
      expect(previousParser(s)).not.toBeNull();
      expect(doseStockUnit(s)).toBe(previousParser(s));
    }
  });

  it('now reads "fl oz", "FLOZ" and the other shared spellings of fluid ounces', () => {
    for (const s of ['fl oz', 'FL OZ', 'FLOZ', 'floz', 'fl. oz', 'fl.oz', '  fl   oz  ']) {
      expect(doseStockUnit(s)).toBe('fl-oz');
    }
  });

  it('agrees with normalizeUnitName on the canonical name', () => {
    const spellings = [
      ...ALL_STOCK_UNITS.flatMap(casings),
      'fl oz',
      'FLOZ',
      'fl. oz',
      ' ml ',
      'mL'
    ];
    for (const s of spellings) {
      expect(doseStockUnit(s)).toBe(normalizeUnitName(s));
    }
  });

  it('still reads an unknown or empty unit as unknown', () => {
    for (const s of ['tablets', 'cc', 'dose', 'fluid ounce', '', '   ', null, undefined]) {
      expect(doseStockUnit(s)).toBeNull();
    }
  });
});
