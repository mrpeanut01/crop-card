import { describe, expect, it } from 'vitest';
import { cardViewParams, snapshotOlderThan, withoutPrintParam } from './viewParams';

describe('cardViewParams', () => {
  it('reads the bed map date for Area Cards only', () => {
    const q = new URLSearchParams('on=2026-07-15&print=1');
    expect(cardViewParams(q, 'area')).toEqual({
      bedMapOnMs: Date.UTC(2026, 6, 15),
      autoPrint: true
    });
    expect(cardViewParams(q, 'planting')).toEqual({ autoPrint: true });
  });

  it('ignores a bad date and a print flag that is not 1', () => {
    expect(cardViewParams(new URLSearchParams('on=2026-02-30&print=yes'), 'area')).toEqual({
      autoPrint: false
    });
    expect(cardViewParams(new URLSearchParams(''), 'area')).toEqual({ autoPrint: false });
  });
});

describe('print freshness', () => {
  it('reads the last saved change and compares the saved copy against it', () => {
    const q = new URLSearchParams('on=2026-07-15&print=1&after=1780000000000');
    expect(cardViewParams(q, 'area')).toMatchObject({ afterMs: 1_780_000_000_000 });
    expect(cardViewParams(new URLSearchParams('after=soon'), 'area').afterMs).toBeUndefined();
    expect(snapshotOlderThan(1_779_999_999_999, 1_780_000_000_000)).toBe(true);
    expect(snapshotOlderThan(1_780_000_000_000, 1_780_000_000_000)).toBe(false);
    expect(snapshotOlderThan(1, undefined)).toBe(false);
  });
});

describe('withoutPrintParam', () => {
  it('drops print and keeps the date', () => {
    const url = withoutPrintParam(
      new URL('https://x.test/cards/area/a_1?on=2026-07-15&print=1&after=12345')
    );
    expect(url.pathname).toBe('/cards/area/a_1');
    expect(url.search).toBe('?on=2026-07-15');
  });
});
