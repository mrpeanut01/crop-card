import { describe, expect, it } from 'vitest';
import { packCsvFiles, packReadme, PACK_FILES, type PackData } from './organicPack';
import { PACK_PREAMBLE } from './packCsv';

function data(over: Partial<PackData> = {}): PackData {
  return {
    farmName: 'Hill Farm',
    from: '2026-01-01',
    to: '2026-12-31',
    generatedAt: 'Oct 1, 2026',
    libraryBuild: 'CropCard v0.0.1 (build dev)',
    forOwner: true,
    statuses: [
      {
        subjectType: 'Block',
        name: 'Bed 1',
        area: 'Garden',
        status: null,
        effective: null,
        certifier: null,
        note: null,
        enteredBy: null,
        enteredOn: null,
        documents: null,
        inForceToday: null
      }
    ],
    activity: [],
    inputs: [],
    seed: [],
    treatments: [],
    harvests: [
      {
        harvestDate: 'Jul 1, 2026',
        block: 'Bed 1',
        crop: 'Tomato',
        harvestQuantity: '20 lb',
        lot: null,
        statusAtHarvest: null,
        where: 'Sold',
        quantity: '20 lb',
        dispositionDate: 'Jul 2, 2026',
        recipient: 'Market',
        soldAsOrganic: 'no',
        sale: '$40.00'
      }
    ],
    documents: [],
    ...over
  };
}

describe('packCsvFiles (B-43, B-44)', () => {
  it('writes the seven CSVs, each opening with the one-cell preamble row', () => {
    const files = packCsvFiles(data());
    expect(Object.keys(files).sort()).toEqual(
      [
        PACK_FILES.statuses,
        PACK_FILES.activity,
        PACK_FILES.inputs,
        PACK_FILES.seed,
        PACK_FILES.treatments,
        PACK_FILES.harvests,
        PACK_FILES.documents
      ].sort()
    );
    for (const [name, text] of Object.entries(files)) {
      const [first, second] = text.split('\r\n');
      expect(first, name).toBe(PACK_PREAMBLE);
      expect(second.length, name).toBeGreaterThan(0);
    }
  });

  it('never invents a status: a subject with no entry has a blank status cell', () => {
    const [, , row] = packCsvFiles(data())[PACK_FILES.statuses].split('\r\n');
    expect(row).toBe('Block,Bed 1,Garden,,,,,,,,');
  });

  it('B-47: the owner gets the sale amount, an inspector only "Sale recorded"', () => {
    const owner = packCsvFiles(data())[PACK_FILES.harvests];
    expect(owner).toContain('Sale amount');
    expect(owner).toContain('$40.00');
    const inspector = packCsvFiles(
      data({ forOwner: false, harvests: [{ ...data().harvests[0], sale: 'yes' }] })
    )[PACK_FILES.harvests];
    expect(inspector).toContain('Sale recorded');
    expect(inspector).not.toContain('$');
  });
});

describe('packReadme', () => {
  it('says it is not a certification and lists the files', () => {
    const text = packReadme(data(), { withDocuments: true });
    expect(text.startsWith(PACK_PREAMBLE)).toBe(true);
    expect(text).toContain('Ask your certifier.');
    expect(text).toContain('documents/');
    expect(text).not.toMatch(/205\.\d/);
    expect(text).not.toMatch(/—/);
    expect(packReadme(data(), { withDocuments: false })).not.toContain('documents/  ');
  });
});
