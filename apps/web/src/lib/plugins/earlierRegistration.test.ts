import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  baseRegistration,
  earlierLabelNotice,
  earlierRegistrationLabels,
  pplsLabelRegistration
} from './earlierRegistration';
import { cropRateEarlierLabels } from '$lib/server/cropRateSources';

const PPLS = 'https://www3.epa.gov/pesticides/chem_search/ppls/';
const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const banvel = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'plugins/herbicides/banvel.json'), 'utf8')
) as { pluginId: string; epaRegistrationNumber: string };

describe('PPLS label file names (ruling LF-2)', () => {
  it('reads the registration and stamp date, dropping leading zeros', () => {
    expect(pplsLabelRegistration(`${PPLS}066330-00276-20090911.pdf`)).toEqual({
      registration: '66330-276',
      stamped: '2009-09-11'
    });
    expect(pplsLabelRegistration(`${PPLS}070506-00461-20210526.PDF?x=1`)).toEqual({
      registration: '70506-461',
      stamped: '2021-05-26'
    });
  });

  it('gives null for anything that is not a PPLS label file', () => {
    expect(pplsLabelRegistration('https://example.com/label.pdf')).toBeNull();
    expect(pplsLabelRegistration(`${PPLS}066330-00276.pdf`)).toBeNull();
    expect(pplsLabelRegistration(undefined)).toBeNull();
  });

  it('a distributor number shares its base registration', () => {
    expect(baseRegistration('1381-146-34704')).toBe('1381-146');
    expect(baseRegistration('070506-0461')).toBe('70506-461');
    expect(baseRegistration('n/a')).toBeNull();
  });
});

describe('earlier registration labels (ruling LF-2)', () => {
  it('names a label filed under another registration, with its year', () => {
    expect(
      earlierRegistrationLabels('70506-461', [
        { sourceUrl: `${PPLS}066330-00276-20090911.pdf`, docDate: '2009-09-11' },
        { sourceUrl: `${PPLS}066330-00276-20090911.pdf`, docDate: '2009-09-11' }
      ])
    ).toEqual([{ registration: '66330-276', year: '2009' }]);
  });

  it("says nothing when the label is under the plugin's own registration", () => {
    expect(
      earlierRegistrationLabels('70506-461', [{ sourceUrl: `${PPLS}070506-00461-20240101.pdf` }])
    ).toEqual([]);
    expect(
      earlierRegistrationLabels('1381-146-34704', [
        { sourceUrl: `${PPLS}001381-00146-20200101.pdf` }
      ])
    ).toEqual([]);
  });

  it('says nothing for non-PPLS sources or a plugin with no number', () => {
    expect(
      earlierRegistrationLabels('70506-461', [{ sourceUrl: 'https://example.com/banvel.pdf' }])
    ).toEqual([]);
    expect(
      earlierRegistrationLabels(undefined, [{ sourceUrl: `${PPLS}066330-00276-20090911.pdf` }])
    ).toEqual([]);
  });

  it('falls back to the file stamp when docDate is missing', () => {
    expect(
      earlierRegistrationLabels('70506-461', [{ sourceUrl: `${PPLS}051036-00289-20030415.pdf` }])
    ).toEqual([{ registration: '51036-289', year: '2003' }]);
  });

  it("a label filed under the plugin's own registration never gives a notice", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999999 }),
        fc.integer({ min: 1, max: 99999 }),
        fc.integer({ min: 1990, max: 2030 }),
        (company, product, year) => {
          const file = `${String(company).padStart(6, '0')}-${String(product).padStart(5, '0')}-${year}0101.pdf`;
          return (
            earlierRegistrationLabels(`${company}-${product}`, [{ sourceUrl: `${PPLS}${file}` }])
              .length === 0
          );
        }
      )
    );
  });
});

describe('earlier registration notice text (ruling LF-2)', () => {
  const label = { registration: '66330-276', year: '2009' };
  it("reads the ruling's English sentence", () => {
    expect(earlierLabelNotice(label)).toBe(
      'From a 2009 label of the earlier registration 66330-276. Check your current label.'
    );
    expect(earlierLabelNotice(label, 'en')).toBe(earlierLabelNotice(label));
  });
  it('has a Spanish version with the same numbers', () => {
    const es = earlierLabelNotice(label, 'es');
    expect(es).not.toBe(earlierLabelNotice(label));
    expect(es).toContain('2009');
    expect(es).toContain('66330-276');
  });
});

describe('Banvel rates by crop (ruling LF-2)', () => {
  it('derives the 2009 66330-276 notice from epa-reg-sources.json', () => {
    expect(banvel.epaRegistrationNumber).toBe('70506-461');
    expect(cropRateEarlierLabels(banvel)).toEqual([{ registration: '66330-276', year: '2009' }]);
  });

  it('a plugin with no by-crop sources gets no notice', () => {
    expect(cropRateEarlierLabels({ pluginId: '24d', epaRegistrationNumber: '1-1' })).toEqual([]);
  });
});
