import { describe, expect, expectTypeOf, it } from 'vitest';
import fc from 'fast-check';
import {
  CARD_KEY_PREFIX,
  CARD_KINDS,
  cardHref,
  cardKey,
  cardShortUrl,
  isCardKind,
  mergeProvenance,
  parseCardKey
} from './model';
import { PRINT_LAYOUTS, paginate, perPage, printLinkFor } from './print';
import type { SnapshotCropPlugin } from './snapshot';
import type { CropPlugin } from '$lib/plugins/schemas';

describe('card keys', () => {
  it('has a unique prefix per kind', () => {
    const prefixes = CARD_KINDS.map((k) => CARD_KEY_PREFIX[k]);
    expect(new Set(prefixes).size).toBe(CARD_KINDS.length);
  });

  it('property: every kind + id round-trips', () => {
    fc.assert(
      fc.property(fc.constantFrom(...CARD_KINDS), fc.string({ minLength: 1 }), (kind, id) => {
        expect(parseCardKey(cardKey(kind, id))).toEqual({ kind, id });
      })
    );
  });

  it('rejects malformed keys', () => {
    for (const k of ['', 'pl', 'pl_', '_x', 'zz_x', 'plx']) expect(parseCardKey(k)).toBeNull();
  });

  it('isCardKind guards the union', () => {
    expect(isCardKind('planting')).toBe(true);
    expect(isCardKind('field')).toBe(false);
    expect(isCardKind(3)).toBe(false);
  });

  it('hrefs and short URLs are URL-encoded', () => {
    expect(cardHref('area', 'ar_a/b')).toBe('/cards/area/ar_a%2Fb');
    expect(cardShortUrl('https://app.cropcard.io/some/path', 'pl_x y')).toBe(
      'https://app.cropcard.io/c/pl_x%20y'
    );
  });

  it('has no short URL without a stable http(s) origin', () => {
    for (const o of [null, undefined, '', 'not a url', 'javascript:alert(1)', 'file:///etc']) {
      expect(cardShortUrl(o, 'pl_1')).toBeNull();
      expect(printLinkFor(o, 'pl_1')).toBeNull();
    }
    expect(printLinkFor('http://localhost:5173', 'pl_1')?.url).toBe('http://localhost:5173/c/pl_1');
  });
});

describe('mergeProvenance', () => {
  it('drops duplicates and keeps first-seen order', () => {
    expect(
      mergeProvenance([
        { source: 'plugin', detail: 'a' },
        { source: 'data' },
        { source: 'plugin', detail: 'a' },
        { source: 'plugin', detail: 'b' },
        { source: 'data' }
      ])
    ).toEqual([
      { source: 'plugin', detail: 'a' },
      { source: 'data' },
      { source: 'plugin', detail: 'b' }
    ]);
  });
});

describe('print pagination', () => {
  it('letter holds 4, index cards hold 1', () => {
    expect(perPage('letter-4up')).toBe(4);
    expect(perPage('index-3x5')).toBe(1);
    expect(perPage('index-4x6')).toBe(1);
    expect(PRINT_LAYOUTS.find((l) => l.id === 'index-3x5')?.hint).toMatch(
      /3×5 paper in the print dialog/
    );
  });

  it('property: pages keep order, lose nothing and never exceed the layout', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 40 }),
        fc.constantFrom(...PRINT_LAYOUTS.map((l) => l.id)),
        (items, layout) => {
          const pages = paginate(items, layout);
          expect(pages.flat()).toEqual(items);
          expect(pages.every((p) => p.length > 0 && p.length <= perPage(layout))).toBe(true);
        }
      )
    );
  });
});

describe('snapshot plugin subset', () => {
  it('a full crop plugin satisfies the snapshot subset (no drift)', () => {
    expectTypeOf<CropPlugin>().toMatchTypeOf<SnapshotCropPlugin>();
  });
});
