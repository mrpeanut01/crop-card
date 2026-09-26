import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { bodyFromDraft, draftFromFeature } from './mapFeatureForm';
import { MAP_FEATURE_KINDS, WATER_SOURCE_TYPES } from './mapFeatures';

describe('map feature form', () => {
  it('starts blank and round-trips a saved water source', () => {
    expect(draftFromFeature()).toEqual({ name: '', fieldId: '', source: '', flowRate: '' });
    const draft = draftFromFeature({
      name: 'Barn well',
      fieldId: 'f1',
      details: { source: 'well', flowRateGpm: 7.5 }
    });
    expect(draft).toEqual({ name: 'Barn well', fieldId: 'f1', source: 'well', flowRate: '7.5' });
    expect(bodyFromDraft('water_source', draft)).toEqual({
      ok: true,
      body: { name: 'Barn well', fieldId: 'f1', details: { source: 'well', flowRateGpm: 7.5 } }
    });
  });

  it('needs a name, trims it, and maps an empty Area to null', () => {
    expect(bodyFromDraft('fence', { ...draftFromFeature(), name: '   ' }).ok).toBe(false);
    expect(bodyFromDraft('fence', { ...draftFromFeature(), name: '  Lane fence ' })).toEqual({
      ok: true,
      body: { name: 'Lane fence', fieldId: null, details: null }
    });
  });

  it('only water sources carry details, whatever was typed', () => {
    for (const kind of MAP_FEATURE_KINDS.filter((k) => k !== 'water_source')) {
      const res = bodyFromDraft(kind, {
        name: 'x',
        fieldId: '',
        source: 'pond',
        flowRate: '4'
      });
      expect(res.ok && res.body.details).toBeNull();
    }
  });

  it('accepts any positive flow up to the cap and refuses the rest', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('' as const, ...WATER_SOURCE_TYPES),
        fc.double({ min: 0.01, max: 5000, noNaN: true }),
        (source, flow) => {
          const res = bodyFromDraft('water_source', {
            name: 'Tank',
            fieldId: '',
            source,
            flowRate: String(flow)
          });
          expect(res.ok).toBe(true);
          if (res.ok) expect(res.body.details?.flowRateGpm).toBe(flow);
        }
      )
    );
    for (const bad of ['0', '-2', 'lots', '5001', 'Infinity']) {
      const res = bodyFromDraft('water_source', {
        name: 'Tank',
        fieldId: '',
        source: '',
        flowRate: bad
      });
      expect(res.ok).toBe(false);
    }
    expect(
      bodyFromDraft('water_source', { name: 'Tank', fieldId: '', source: '', flowRate: ' ' })
    ).toEqual({ ok: true, body: { name: 'Tank', fieldId: null, details: null } });
  });
});
