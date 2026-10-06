import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { getRegistry } from '$lib/server/registry';
import { toSprayProduct } from '$lib/server/cardSnapshot';
import { RULES_VERSION } from '$lib/safety/version';
import { SPRAY_RECHECK_NOTICE, buildSprayCard, sprayCardId } from './build/spray';
import { SAMPLE_FUNGICIDE, SAMPLE_HERBICIDE, sampleGearSnapshot } from './build/fixturesGear';
import type { CardModel } from './model';
import type { SnapshotEquipment, SnapshotSprayProduct } from './snapshot';
import {
  partContentHeight,
  wholePrintBudget,
  wholePrintParts,
  wrapLines,
  type SmallLayout
} from './printPack';

const LAYOUTS: SmallLayout[] = ['index-4x6', 'index-3x5', 'letter-4up'];
/** Last loads that select each decon protocol, plus a clean tank. */
const LAST_LOADS = [
  null,
  'photosystem-i-diquat',
  'glufosinate',
  'fungicide-load',
  'synthetic-auxin'
];
const CTX = { locale: null, qr: true, url: 'https://app.cropcard.io/c/sp_eq_boom~24d' };

function card(product: SnapshotSprayProduct, last: string | null, tankGal = 50): CardModel {
  const sprayer: SnapshotEquipment = {
    id: 'eq_boom',
    type: 'sprayer',
    label: '50-gal boom',
    tankGal,
    state: {
      calibratedGpa: 15,
      calibrationDate: Date.parse('2026-04-02T12:00:00Z'),
      lastDeconAt: null,
      lastUsedAt: last ? Date.parse('2026-09-01T12:00:00Z') : null,
      lastChemistryClass: last,
      winterizedAt: null
    }
  };
  const snap = sampleGearSnapshot({
    rulesVersion: RULES_VERSION,
    equipment: [sprayer],
    sprayProducts: { [product.pluginId]: product }
  });
  return buildSprayCard(snap, sprayCardId('eq_boom', product.pluginId))!;
}

const factKey = (f: { label: string; value: string }) => `${f.label}=${f.value}`;

/** The rulings every printed set must keep (SC-1 to SC-6). */
function checkParts(
  whole: CardModel,
  parts: CardModel[],
  layout: SmallLayout,
  locale?: string,
  strict = false
) {
  const ctx = { ...CTX, locale: locale ?? null };
  const of = parts.length;
  parts.forEach((p, i) => {
    expect(p.printPart).toMatchObject({ n: i + 1, of });
    expect(p.title).toBe(whole.title);
    expect(p.key).toBe(whole.key);
    for (const n of whole.printRepeatNotices ?? []) expect(p.notices).toContain(n);
    for (const f of p.facts) expect(f.value.trim()).not.toBe('');
  });
  // Nothing dropped, nothing doubled.
  expect(parts.flatMap((p) => p.facts).map(factKey)).toEqual(
    expect.arrayContaining(whole.facts.map(factKey))
  );
  expect(parts.flatMap((p) => p.facts)).toHaveLength(whole.facts.length);
  for (const s of whole.sections) {
    const printed = parts.flatMap((p) => p.sections.filter((x) => x.title === s.title));
    expect(printed.flatMap((x) => x.items)).toEqual(s.items);
  }
  expect(parts.filter((p) => p.next)).toHaveLength(whole.next ? 1 : 0);
  // Decon that must run first prints first.
  const own = parts.findIndex((p) => p.sections.some((s) => s.ownCard));
  const firstProduct = parts.findIndex((p) => !p.sections.some((s) => s.ownCard));
  if (own >= 0) {
    expect(own).toBe(0);
    expect(parts.slice(firstProduct).every((p) => !p.sections.some((s) => s.ownCard))).toBe(true);
  }
  // The first product card carries every notice, the decon line included.
  expect(parts[firstProduct].notices).toEqual(whole.notices);
  // Core facts print before the mix order and anything lower down.
  const order = parts.flatMap((p) => [
    ...p.facts.map((f) => (f.core ? 'core' : 'other')),
    ...p.sections.filter((s) => !s.ownCard).map(() => 'section')
  ]);
  const lastCore = order.lastIndexOf('core');
  expect(order.slice(0, lastCore + 1).every((x) => x === 'core')).toBe(true);
  // Every part fits its estimate. A part holding one block alone (one fact
  // row, or one section item) may use the slack the estimate keeps; shipped
  // products must still fit the card itself.
  const budget = wholePrintBudget(whole, layout, ctx);
  const physical = wholePrintBudget(whole, layout, ctx, 1);
  for (const p of parts) {
    const h = partContentHeight(p, layout, ctx);
    const items = p.sections.reduce((n, s) => n + s.items.length, 0);
    const oneBlock =
      (p.facts.length <= 2 && items === 0 && !p.next) || (p.facts.length === 0 && items <= 1);
    if (!oneBlock) expect(h).toBeLessThanOrEqual(budget + 1e-9);
    if (strict) expect(h).toBeLessThanOrEqual(physical + 1e-9);
  }
}

describe('wrapLines', () => {
  it('counts one line for short text and more as the text grows', () => {
    expect(wrapLines('Rate', 2, 10, 0.56)).toBe(1);
    const a = wrapLines('word '.repeat(40), 2, 10, 0.56);
    const b = wrapLines('word '.repeat(80), 2, 10, 0.56);
    expect(b).toBeGreaterThan(a);
  });
  it('never returns fewer lines than the characters need', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 400 }),
        fc.double({ min: 1, max: 6, noNaN: true }),
        (s, w) => {
          const perLine = Math.floor(w / ((10 * 0.56) / 72));
          const chars = s.replace(/\s+/g, '').length;
          expect(wrapLines(s, w, 10, 0.56)).toBeGreaterThanOrEqual(Math.ceil(chars / perLine) || 1);
        }
      )
    );
  });
});

describe('wholePrintParts', () => {
  it('leaves other cards and full-page paper alone', () => {
    const c = card(SAMPLE_HERBICIDE, 'glufosinate');
    expect(wholePrintParts(c, 'letter-landscape', CTX)).toEqual([c]);
    const plain = { ...c, printWhole: undefined };
    expect(wholePrintParts(plain, 'index-3x5', CTX)).toEqual([plain]);
  });

  it('prints the decon SOP first and the rate, tank amount, REI, PHI and mix order after it (#581)', () => {
    const c = card(SAMPLE_HERBICIDE, 'photosystem-i-diquat');
    for (const layout of LAYOUTS) {
      const parts = wholePrintParts(c, layout, CTX);
      expect(parts.length).toBeGreaterThanOrEqual(2);
      expect(parts[0].sections[0].title).toMatch(/^Decon first: Paraquat/);
      expect(parts[0].facts).toEqual([]);
      const product = parts.find((p) => p.facts.some((f) => f.label === 'Rate'))!;
      expect(product.notices?.[0]).toMatch(/^Decon first/);
      const labels = parts.flatMap((p) => p.facts.map((f) => f.label));
      expect(labels.slice(0, 4)).toEqual(['Rate', 'Per 50-gal tank', 'REI', 'PHI']);
      expect(parts.some((p) => p.sections.some((s) => s.title === 'Mix order'))).toBe(true);
      for (const p of parts.filter((x) => x !== product))
        expect(p.printPart?.ref).toBe('EPA reg. no. 34704-120');
      checkParts(c, parts, layout);
    }
  });

  it('keeps a clean-tank card on one 4x6 card', () => {
    const c = card(SAMPLE_HERBICIDE, null);
    const parts = wholePrintParts(c, 'index-4x6', CTX);
    expect(parts[0].facts.slice(0, 2).map((f) => f.label)).toEqual(['Rate', 'Per 50-gal tank']);
    checkParts(c, parts, 'index-4x6');
  });

  it('holds the rulings for random products, tanks, loads and paper', () => {
    const product = fc.record({
      displayName: fc.string({ minLength: 1, maxLength: 70 }),
      targets: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 12 }),
      mixSteps: fc.array(fc.string({ minLength: 1, maxLength: 140 }), { maxLength: 8 }),
      rainfast: fc.option(fc.integer({ min: 1, max: 24 }), { nil: null }),
      type: fc.constantFrom('herbicide', 'fungicide')
    });
    fc.assert(
      fc.property(
        product,
        fc.constantFrom(...LAST_LOADS),
        fc.option(fc.integer({ min: 1, max: 500 }), { nil: null }),
        fc.constantFrom(...LAYOUTS),
        fc.constantFrom('en', 'es'),
        (p, last, tank, layout, locale) => {
          const base = p.type === 'herbicide' ? SAMPLE_HERBICIDE : SAMPLE_FUNGICIDE;
          const c = card(
            {
              ...base,
              displayName: p.displayName,
              targets: p.targets,
              mixSteps: p.mixSteps,
              rainfastHours: p.rainfast
            },
            last,
            tank ?? 0
          );
          checkParts(c, wholePrintParts(c, layout, { ...CTX, locale }), layout, locale);
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('every shipped spray product prints whole on every paper (#581)', async () => {
  const registry = await getRegistry();
  const products = registry
    .all()
    .map((r) => toSprayProduct(r.plugin))
    .filter((p): p is SnapshotSprayProduct => !!p);

  it('finds the spray library', () => {
    expect(products.length).toBeGreaterThan(100);
  });

  for (const layout of LAYOUTS) {
    it(`${layout}: every product x every last load`, () => {
      for (const p of products) {
        for (const last of LAST_LOADS) {
          const c = card(p, last);
          checkParts(c, wholePrintParts(c, layout, CTX), layout, undefined, true);
        }
      }
    });
  }

  it('repeats the recheck notice on every card', () => {
    const c = card(products[0], 'photosystem-i-diquat');
    for (const p of wholePrintParts(c, 'index-3x5', CTX))
      expect(p.notices).toContain(SPRAY_RECHECK_NOTICE);
  });
});
