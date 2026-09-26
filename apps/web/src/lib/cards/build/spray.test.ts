import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeRatedDilution } from '$lib/dilution/calculator';
import { selectDeconProtocol } from '$lib/safety/deconProtocol';
import { RULES_VERSION } from '$lib/safety/version';
import { parseCardKey, isCardStale } from '../model';
import type { FarmSnapshot, SnapshotEquipment, SnapshotSprayProduct } from '../snapshot';
import {
  CALIBRATE_FIRST_TITLE,
  SPRAY_RECHECK_NOTICE,
  SPRAY_REFERENCE_NOTICE,
  SPRAY_RULES_MISMATCH_NOTICE,
  SPRAY_STALE_AFTER_MS,
  buildSprayCard,
  buildSprayCards,
  isCalibratedGpa,
  parseSprayCardId,
  sprayCardId
} from './spray';
import { SAMPLE_FUNGICIDE, SAMPLE_HERBICIDE, sampleGearSnapshot } from './fixturesGear';

const UNITS = ['oz', 'fl-oz', 'lb', 'pt', 'qt'] as const;

function withSprayer(
  gpa: number | null,
  tankGal: number | null,
  product: SnapshotSprayProduct
): FarmSnapshot {
  const sprayer: SnapshotEquipment = {
    id: 'sp1',
    type: 'sprayer',
    label: 'Rig',
    tankGal,
    state: {
      calibratedGpa: gpa,
      calibrationDate: null,
      lastDeconAt: null,
      lastUsedAt: null,
      lastChemistryClass: null,
      winterizedAt: null
    }
  };
  return sampleGearSnapshot({
    rulesVersion: RULES_VERSION,
    equipment: [sprayer],
    sprayProducts: { [product.pluginId]: product }
  });
}

const fact = (card: { facts: { label: string; value: string }[] } | null, label: string) =>
  card?.facts.find((f) => f.label === label)?.value;

describe('spray card ids', () => {
  it('round-trips sprayer and product, splitting on the last separator', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.endsWith('~')),
        fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,20}$/),
        (sprayerId, pluginId) => {
          expect(parseSprayCardId(sprayCardId(sprayerId, pluginId))).toEqual({
            sprayerId,
            pluginId
          });
        }
      )
    );
    expect(parseSprayCardId('boom')).toEqual({ sprayerId: 'boom', pluginId: null });
  });
});

describe('buildSprayCard', () => {
  const snap = sampleGearSnapshot();

  it('builds the Field Card for a calibrated sprayer and a stocked herbicide', () => {
    const card = buildSprayCard(snap, sprayCardId('eq_boom', '24d'))!;
    expect(card.kind).toBe('spray');
    expect(parseCardKey(card.key)).toEqual({ kind: 'spray', id: 'eq_boom~24d' });
    expect(card.title).toBe('2,4-D Amine');
    expect(card.kicker).toBe('Spray · 50-gal boom');
    expect(fact(card, 'EPA reg. no.')).toBe('34704-120');
    expect(fact(card, 'Rate')).toBe('16 fl-oz/A');
    expect(fact(card, 'Sprayer')).toBe('20 GPA · calibrated Apr 2');
    expect(fact(card, 'Per 50-gal tank')).toBe(
      computeRatedDilution(
        { pluginId: '24d', displayName: '2,4-D Amine', ratePerAcre: SAMPLE_HERBICIDE.ratePerAcre! },
        50,
        20
      ).display
    );
    expect(fact(card, 'Tank covers')).toBe('2.5 ac');
    expect(fact(card, 'REI')).toBe('See label');
    expect(card.sections.find((s) => s.title === 'Mix order')?.items).toEqual(
      SAMPLE_HERBICIDE.mixSteps
    );
    expect(card.rulesVersion).toBe(snap.rulesVersion);
    expect(card.asOf).toBe(snap.generatedAt);
    expect(card.notices).toEqual([SPRAY_RECHECK_NOTICE, SPRAY_REFERENCE_NOTICE]);
    expect(card.next?.href).toBe('/spray');
  });

  it('shows the kernel decon SOP when the last load differs and no decon followed', () => {
    const card = buildSprayCard(snap, sprayCardId('eq_boom', '24d'))!;
    const decon = card.sections.find((s) => s.title.startsWith('Decon first'));
    expect(decon?.items).toEqual([
      'Last load was sulfonylurea.',
      ...selectDeconProtocol('sulfonylurea').steps
    ]);
  });

  it('skips the decon-first section once a decon is on record after the last load', () => {
    const s = sampleGearSnapshot();
    s.equipment[0] = {
      ...s.equipment[0],
      state: { ...s.equipment[0].state!, lastDeconAt: Date.parse('2026-05-21T00:00:00Z') }
    };
    const card = buildSprayCard(s, sprayCardId('eq_boom', '24d'))!;
    expect(card.sections.some((x) => x.title.startsWith('Decon first'))).toBe(false);
    expect(card.sections.find((x) => x.title === 'Decon')).toBeDefined();
  });

  it('carries label REI, PHI, targets and the right record flow for a fungicide', () => {
    const card = buildSprayCard(snap, sprayCardId('eq_boom', 'copper-hydroxide'))!;
    expect(fact(card, 'REI')).toBe('48 h');
    expect(fact(card, 'PHI')).toBe('0 d');
    expect(fact(card, 'EPA reg. no.')).toBe('Not on file, check the label');
    expect(fact(card, 'Target')).toBe('Early blight, Septoria leaf spot');
    expect(card.next?.href).toBe('/spray/fungicide');
    expect(card.sections.find((s) => s.title === 'Mix order')?.items).toEqual([
      'Follow the mixing directions on the label.'
    ]);
  });

  it('gives an uncalibrated sprayer a Calibrate first card with no amounts', () => {
    for (const id of ['eq_pack', sprayCardId('eq_pack', '24d')]) {
      const card = buildSprayCard(snap, id)!;
      expect(card.title).toBe(CALIBRATE_FIRST_TITLE);
      expect(card.key).toBe(`sp_${id}`);
      expect(card.facts.some((f) => /^Per /.test(f.label))).toBe(false);
      expect(card.next).toEqual({ label: 'Calibrate this sprayer', href: '/calibrate' });
      expect(card.notices).toContain(SPRAY_REFERENCE_NOTICE);
    }
  });

  it('returns null for unknown sprayers, non-sprayers and unstocked products', () => {
    expect(buildSprayCard(snap, sprayCardId('nope', '24d'))).toBeNull();
    expect(buildSprayCard(snap, sprayCardId('eq_planter', '24d'))).toBeNull();
    expect(buildSprayCard(snap, sprayCardId('eq_boom', 'not-stocked'))).toBeNull();
    expect(buildSprayCard(snap, 'eq_boom')).toBeNull();
  });

  it('falls back to a per-acre line when the sprayer has no tank size', () => {
    const s = withSprayer(18, null, SAMPLE_HERBICIDE);
    const card = buildSprayCard(s, sprayCardId('sp1', '24d'))!;
    expect(fact(card, 'Per acre')).toBe('16 fl-oz in 18 gal water');
    expect(card.facts.some((f) => f.label === 'Tank covers')).toBe(false);
  });

  it('reads See label when the plugin has no rate', () => {
    const s = withSprayer(20, 50, { ...SAMPLE_FUNGICIDE, ratePerAcre: null });
    const card = buildSprayCard(s, sprayCardId('sp1', SAMPLE_FUNGICIDE.pluginId))!;
    expect(fact(card, 'Rate')).toBe('See label');
    expect(card.facts.some((f) => /^Per /.test(f.label))).toBe(false);
  });

  it('turns stale after 24 hours', () => {
    const card = buildSprayCard(snap, sprayCardId('eq_boom', '24d'))!;
    expect(card.staleAfterMs).toBe(SPRAY_STALE_AFTER_MS);
    expect(isCardStale(card, card.asOf + SPRAY_STALE_AFTER_MS)).toBe(false);
    expect(isCardStale(card, card.asOf + SPRAY_STALE_AFTER_MS + 1)).toBe(true);
  });
});

describe('spray card properties (kernel agreement)', () => {
  const productArb = fc.record({
    amount: fc.double({ min: 0.01, max: 500, noNaN: true }),
    unit: fc.constantFrom(...UNITS),
    gpaCalibration: fc.option(fc.integer({ min: 1, max: 40 }), { nil: null })
  });

  it('per-tank amount always equals the dilution calculator at the calibrated GPA', () => {
    fc.assert(
      fc.property(
        productArb,
        fc.double({ min: 0.5, max: 200, noNaN: true }),
        fc.integer({ min: 1, max: 1000 }),
        (p, gpa, tank) => {
          const product = {
            ...SAMPLE_HERBICIDE,
            ratePerAcre: { amount: p.amount, unit: p.unit },
            gpaCalibration: p.gpaCalibration
          };
          const card = buildSprayCard(
            withSprayer(gpa, tank, product),
            sprayCardId('sp1', product.pluginId)
          )!;
          const expected = computeRatedDilution(
            {
              pluginId: product.pluginId,
              displayName: product.displayName,
              ratePerAcre: product.ratePerAcre
            },
            tank,
            gpa
          );
          const label = `Per ${tank.toLocaleString('en-US')}-gal tank`;
          expect(fact(card, label)).toBe(expected.display);
          expect(expected.gpaUsed).toBe(gpa);
        }
      )
    );
  });

  it('never shows an amount for a sprayer without a positive calibrated GPA', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(0),
          fc.constant(Number.NaN),
          fc.constant(Number.POSITIVE_INFINITY),
          fc.double({ min: -500, max: 0, noNaN: true })
        ),
        fc.option(fc.integer({ min: 1, max: 500 }), { nil: null }),
        (gpa, tank) => {
          expect(isCalibratedGpa(gpa)).toBe(false);
          const s = withSprayer(gpa, tank, SAMPLE_HERBICIDE);
          for (const card of [
            buildSprayCard(s, sprayCardId('sp1', '24d')),
            ...buildSprayCards(s)
          ]) {
            expect(card?.title).toBe(CALIBRATE_FIRST_TITLE);
            expect(card?.facts.some((f) => /^Per |Tank covers/.test(f.label))).toBe(false);
          }
        }
      )
    );
  });

  it('every spray card carries rules version, as-of, both cautions and a stale window', () => {
    fc.assert(
      fc.property(
        fc.option(fc.double({ min: -10, max: 200, noNaN: true }), { nil: null }),
        fc.option(fc.integer({ min: 1, max: 500 }), { nil: null }),
        fc.constantFrom(SAMPLE_HERBICIDE, SAMPLE_FUNGICIDE),
        (gpa, tank, product) => {
          const s = withSprayer(gpa, tank, product);
          const cards = buildSprayCards(s);
          expect(cards.length).toBeGreaterThan(0);
          for (const card of cards) {
            expect(card.rulesVersion).toBe(RULES_VERSION);
            expect(card.asOf).toBe(s.generatedAt);
            expect(card.notices).toEqual([SPRAY_RECHECK_NOTICE, SPRAY_REFERENCE_NOTICE]);
            expect(card.staleAfterMs).toBe(SPRAY_STALE_AFTER_MS);
          }
        }
      )
    );
  });
});

describe('spray card rules version', () => {
  it('names the rules that built the card and flags a snapshot from other rules as stale', () => {
    const s = sampleGearSnapshot({ rulesVersion: '0.0.1-old' });
    const cards = buildSprayCards(s);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.rulesVersion).toBe(RULES_VERSION);
      expect(card.notices).toContain(SPRAY_RULES_MISMATCH_NOTICE);
      expect(isCardStale(card, s.generatedAt + 1)).toBe(true);
    }
  });
});

describe('spray card bee toxicity', () => {
  const insecticide = (beeToxicity: string, bloomRestriction: string): SnapshotSprayProduct => ({
    ...SAMPLE_HERBICIDE,
    pluginId: 'bug-off',
    type: 'insecticide',
    displayName: 'Bug Off',
    loadClasses: ['insecticide-load'],
    pollinator: { beeToxicity, bloomRestriction }
  });
  const beforeYouSpray = (p: SnapshotSprayProduct) =>
    buildSprayCard(withSprayer(20, 25, p), sprayCardId('sp1', p.pluginId))!.sections.find(
      (x) => x.title === 'Before you spray'
    )!.items;

  it.each([
    ['unknown', 'Bee toxicity not declared'],
    ['toxic', 'Toxic to bees'],
    ['highly-toxic', 'Highly toxic to bees']
  ])('warns about bees for %s toxicity with no bloom restriction', (tox, label) => {
    const items = beforeYouSpray(insecticide(tox, 'none'));
    expect(items.some((i) => i.startsWith(`${label}:`) && i.includes('open flowers'))).toBe(true);
  });

  it('stays quiet about bees for a relatively nontoxic product', () => {
    const items = beforeYouSpray(insecticide('relatively-nontoxic', 'none'));
    expect(items.some((i) => /bees/i.test(i))).toBe(false);
  });
});

describe('buildSprayCards', () => {
  it('one Calibrate first card per uncalibrated sprayer and one card per product otherwise', () => {
    const cards = buildSprayCards(sampleGearSnapshot());
    expect(cards.map((c) => c.key)).toEqual([
      'sp_eq_boom~24d',
      'sp_eq_boom~copper-hydroxide',
      'sp_eq_pack'
    ]);
  });

  it('builds nothing but Calibrate first cards from a bundle without spray products', () => {
    const s = sampleGearSnapshot();
    delete s.sprayProducts;
    expect(buildSprayCards(s).map((c) => c.title)).toEqual([CALIBRATE_FIRST_TITLE]);
  });
});
