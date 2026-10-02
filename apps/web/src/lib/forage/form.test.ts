import { describe, expect, it } from 'vitest';
import { forageTestCreateSchema } from './apiSchemas';
import { buildForageTestBody, emptyForageDraft } from './form';

const draft = (over = {}) => ({ ...emptyForageDraft('2026-09-30'), ...over });

describe('buildForageTestBody', () => {
  it('builds a body the server schema accepts', () => {
    const out = buildForageTestBody(
      { blockId: 'b1' },
      draft({
        lab: ' Dairy One ',
        nitrateValue: 0.4,
        nitrateUnits: 'pct-nitrate',
        ratingNitrate: ' Caution ',
        basis: 'as-fed'
      })
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.body).toEqual({
      blockId: 'b1',
      sampledOn: '2026-09-30',
      lab: 'Dairy One',
      nitrateValue: 0.4,
      nitrateUnits: 'pct-nitrate',
      labRating: { nitrate: 'Caution', basis: 'as-fed' }
    });
    expect(forageTestCreateSchema.safeParse(out.body).success).toBe(true);
  });

  it('asks for units with a nitrate value', () => {
    expect(buildForageTestBody({ blockId: 'b' }, draft({ nitrateValue: 10 }))).toEqual({
      ok: false,
      error: 'Pick the units the lab used for nitrate.'
    });
  });

  it('asks for at least one value or rating', () => {
    expect(buildForageTestBody({ hayCuttingId: 'c' }, draft({ basis: 'as-fed' })).ok).toBe(false);
    expect(buildForageTestBody({ hayCuttingId: 'c' }, draft({ ratingHcn: 'Low' })).ok).toBe(true);
  });

  it('drops units when no value was typed', () => {
    const out = buildForageTestBody(
      { stockLotId: 'l' },
      draft({ nitrateUnits: 'ppm-nitrate', hcnPpm: 12 })
    );
    expect(out.ok && out.body).toEqual({ stockLotId: 'l', sampledOn: '2026-09-30', hcnPpm: 12 });
  });
});
