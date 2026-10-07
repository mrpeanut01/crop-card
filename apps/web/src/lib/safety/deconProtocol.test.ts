import { describe, expect, it } from 'vitest';
import { CHEMISTRY_CLASSES, SPRAYER_LOAD_CLASSES, type SprayerLoadClass } from './types';
import { deconIntro, hasStrictDeconProtocol, selectDeconProtocol } from './deconProtocol';
import fc from 'fast-check';

describe('deconProtocol — class-specific SOP selection (UC-45)', () => {
  it('paraquat (photosystem-i-diquat) → bleach + TSP + 3 rinses', () => {
    const p = selectDeconProtocol('photosystem-i-diquat');
    expect(p.id).toBe('paraquat');
    expect(p.strict).toBe(true);
    expect(p.steps.join(' ')).toMatch(/bleach/i);
    expect(p.steps.join(' ')).toMatch(/TSP/i);
    // 3 water rinses called out in the paraquat sequence.
    expect(p.steps.filter((s) => /rinse/i.test(s)).length).toBeGreaterThanOrEqual(3);
  });

  it('glufosinate → detergent + water rinse', () => {
    const p = selectDeconProtocol('glufosinate');
    expect(p.id).toBe('glufosinate');
    expect(p.strict).toBe(true);
    expect(p.steps.join(' ')).toMatch(/detergent/i);
    expect(p.steps.join(' ')).toMatch(/water rinse/i);
  });

  it('copper (fungicide-load) → vinegar rinse', () => {
    const p = selectDeconProtocol('fungicide-load');
    expect(p.id).toBe('copper');
    expect(p.strict).toBe(true);
    expect(p.steps.join(' ')).toMatch(/vinegar/i);
  });

  it('clean sprayer (undefined) → generic ammonia protocol', () => {
    const p = selectDeconProtocol(undefined);
    expect(p.id).toBe('generic-ammonia');
    expect(p.strict).toBe(false);
    expect(p.steps.join(' ')).toMatch(/ammonia/i);
  });

  it('null → generic ammonia protocol', () => {
    expect(selectDeconProtocol(null).id).toBe('generic-ammonia');
  });

  it('every non-strict chemistry class falls back to generic ammonia', () => {
    const strict = new Set<SprayerLoadClass>([
      'photosystem-i-diquat',
      'glufosinate',
      'fungicide-load'
    ]);
    const allClasses: SprayerLoadClass[] = [...CHEMISTRY_CLASSES, ...SPRAYER_LOAD_CLASSES];
    for (const c of allClasses) {
      const p = selectDeconProtocol(c);
      if (strict.has(c)) {
        expect(p.strict, `${c} should be strict`).toBe(true);
        expect(p.id).not.toBe('generic-ammonia');
      } else {
        expect(p.id, `${c} should be generic`).toBe('generic-ammonia');
        expect(p.strict).toBe(false);
      }
    }
  });

  it('insecticide-load uses the generic protocol (no strict SOP defined)', () => {
    const p = selectDeconProtocol('insecticide-load');
    expect(p.id).toBe('generic-ammonia');
    expect(p.strict).toBe(false);
  });

  it('hasStrictDeconProtocol mirrors the strict flag', () => {
    expect(hasStrictDeconProtocol('photosystem-i-diquat')).toBe(true);
    expect(hasStrictDeconProtocol('glufosinate')).toBe(true);
    expect(hasStrictDeconProtocol('fungicide-load')).toBe(true);
    expect(hasStrictDeconProtocol('glyphosate')).toBe(false);
    expect(hasStrictDeconProtocol('insecticide-load')).toBe(false);
    expect(hasStrictDeconProtocol(undefined)).toBe(false);
  });

  it('every returned protocol has non-empty ordered steps and a rationale', () => {
    for (const c of [undefined, 'photosystem-i-diquat', 'glufosinate', 'fungicide-load'] as const) {
      const p = selectDeconProtocol(c);
      expect(p.steps.length).toBeGreaterThan(0);
      expect(p.rationale.length).toBeGreaterThan(0);
    }
  });
});

describe('deconIntro — the intro matches the protocol walked (#685)', () => {
  it('mentions the ammonia soak only for the generic protocol', () => {
    const classes: (SprayerLoadClass | null)[] = [
      null,
      ...CHEMISTRY_CLASSES,
      ...SPRAYER_LOAD_CLASSES
    ];
    fc.assert(
      fc.property(fc.constantFrom(...classes), (cls) => {
        const protocol = selectDeconProtocol(cls);
        const intro = deconIntro(protocol);
        if (protocol.strict) {
          expect(intro).not.toMatch(/30-minute/);
          expect(intro).toContain(protocol.label);
          expect(intro).toContain('no ammonia soak');
        } else {
          expect(intro).toContain('30-minute ammonia soak');
        }
      })
    );
  });

  it('the copper SOP intro names the copper protocol', () => {
    expect(deconIntro(selectDeconProtocol('fungicide-load'))).toContain(
      'Copper fungicide decon (strict SOP)'
    );
  });
});
