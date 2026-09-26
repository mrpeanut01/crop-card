import { describe, expect, it } from 'vitest';
import { AREA_DETAILS_SCHEMAS, AREA_KINDS } from './areaKinds';
import {
  AREA_DETAIL_FIELDS,
  detailsFromDraft,
  detailsSummary,
  draftFromDetails,
  fieldShown,
  hasDetailFields
} from './areaDetailsForm';

describe('area detail form', () => {
  it('asks for exactly the attributes each kind stores', () => {
    for (const kind of AREA_KINDS) {
      const schemaKeys = Object.keys(AREA_DETAILS_SCHEMAS[kind].shape).sort();
      const formKeys = AREA_DETAIL_FIELDS[kind].map((f) => f.key).sort();
      expect(formKeys, kind).toEqual(schemaKeys);
    }
  });

  it('knows which kinds have a form', () => {
    expect(hasDetailFields('garden')).toBe(true);
    expect(hasDetailFields('residence')).toBe(false);
  });

  it('round-trips garden details through a draft', () => {
    const details = {
      organicStatus: 'transitional',
      transitionDate: '2026-03-01',
      irrigation: 'drip'
    } as const;
    const draft = draftFromDetails('garden', details);
    expect(draft).toEqual({ ...details });
    expect(detailsFromDraft('garden', draft)).toEqual({ ok: true, details });
  });

  it('drops the transition date unless the garden is transitioning', () => {
    const draft = { organicStatus: 'organic', transitionDate: '2026-03-01', irrigation: '' };
    const transition = AREA_DETAIL_FIELDS.garden.find((f) => f.key === 'transitionDate')!;
    expect(fieldShown(transition, draft)).toBe(false);
    expect(detailsFromDraft('garden', draft)).toEqual({
      ok: true,
      details: { organicStatus: 'organic' }
    });
  });

  it('treats an empty form as no details', () => {
    expect(detailsFromDraft('barn', draftFromDetails('barn', null))).toEqual({
      ok: true,
      details: null
    });
    expect(detailsFromDraft('field', {})).toEqual({ ok: true, details: null });
  });

  it('keeps only checked boxes and parses feet', () => {
    expect(
      detailsFromDraft('greenhouse', { heated: true, supplementalLight: false, structure: 'poly' })
    ).toEqual({ ok: true, details: { heated: true, structure: 'poly' } });
    expect(detailsFromDraft('orchard', { rowSpacingFt: '18', treeSpacingFt: null })).toEqual({
      ok: true,
      details: { rowSpacingFt: 18 }
    });
  });

  it('rejects values the schema does not allow', () => {
    expect(detailsFromDraft('orchard', { rowSpacingFt: -4 }).ok).toBe(false);
    expect(detailsFromDraft('pasture', { use: 'racetrack' }).ok).toBe(false);
  });

  it('summarizes stored details in plain words', () => {
    expect(detailsSummary('garden', { irrigation: 'drip', organicStatus: 'organic' })).toEqual([
      { label: 'Organic status', value: 'Certified organic' },
      { label: 'Watering', value: 'Drip' }
    ]);
    expect(detailsSummary('barn', { chemicalStorage: true })).toEqual([
      { label: 'Chemical storage', value: 'Yes' }
    ]);
    expect(detailsSummary('orchard', { treeSpacingFt: 12 })).toEqual([
      { label: 'Tree spacing', value: '12 ft' }
    ]);
    expect(detailsSummary('garden', null)).toEqual([]);
  });
});
