import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '$lib/prefs';
import { observationLine, scoutMetricLabel } from './metricLabel';
import { harvestDetail, scoutDetail, sprayDetail, deconDetail } from './recordDetail';
import { soilTestLine } from '$lib/fertility/soilLine';
import { createT } from '$lib/i18n';

const en = DEFAULT_PREFS;
const es = { ...DEFAULT_PREFS, locale: 'es' };

describe('scoutMetricLabel / observationLine (#631)', () => {
  it('names known metrics in English and Spanish', () => {
    expect(scoutMetricLabel('count-per-leaf')).toBe('Per leaf');
    expect(scoutMetricLabel('percent-leaf-area', 'es')).toBe('% de área foliar afectada');
    expect(scoutMetricLabel('per_plant')).toBe('Per plant');
  });
  it('reads a note-only observation as its note', () => {
    expect(observationLine('note', 'note', 0, 'Full bloom', null)).toBe('Full bloom');
    expect(observationLine('aphids', 'count-per-leaf', 1.2, null, null)).toBe(
      'aphids · Per leaf: 1.2'
    );
  });
});

describe('sprayDetail (#725)', () => {
  const input = {
    blockLabel: 'North Field A',
    blockAcres: 2,
    sprayerLabel: 'ATV sprayer',
    products: [
      {
        pluginId: 'roundup-powermax-3',
        name: 'Roundup PowerMAX 3',
        epaRegistrationNumber: '524-659',
        rate: { amount: 22, unit: 'fl oz' }
      }
    ],
    conditions: { windMph: 5, tempF: 70, rainForecastMmNext24h: 0 },
    customRateOverride: false,
    rulesVersion: '0.7.6',
    pluginHashes: { 'roundup-powermax-3': 'a'.repeat(64) }
  };

  it('shows the product name, EPA number, rate, area and total, and no raw keys', () => {
    const view = sprayDetail(input, en);
    const text = view.rows.map((r) => `${r.label}: ${r.value}`).join('\n');
    expect(text).toContain('Block: North Field A');
    expect(text).toContain('Area treated: 2 ac');
    expect(text).toContain('Sprayer: ATV sprayer');
    expect(text).toContain(
      'Roundup PowerMAX 3: EPA reg. no. 524-659 · 22 fl oz/A · total 44 fl oz'
    );
    expect(text).not.toMatch(/blockLabel|pluginHashes|customRateOverride|\{|aaaa/);
    expect(view.rows.find((r) => r.label === 'Roundup PowerMAX 3')?.englishOnly).toBe(true);
  });

  it('puts the rules version, ids and fingerprints under technical details', () => {
    const view = sprayDetail(input, en);
    expect(view.technical).toEqual([
      { label: 'Rules version', value: '0.7.6' },
      { label: 'Product id', value: 'roundup-powermax-3' },
      { label: 'Label fingerprint (roundup-powermax-3)', value: 'a'.repeat(64) }
    ]);
  });

  it('labels follow the language; safety values stay English', () => {
    const view = sprayDetail(input, es);
    expect(view.rows[0]).toEqual({ label: 'Bloque', value: 'North Field A' });
    expect(view.rows.find((r) => r.englishOnly)?.value).toContain('EPA reg. no.');
  });

  it('says when the area or the label number is not on file', () => {
    const view = sprayDetail(
      {
        ...input,
        blockAcres: null,
        products: [{ pluginId: 'x', name: 'X', epaRegistrationNumber: null }]
      },
      en
    );
    const text = view.rows.map((r) => `${r.label}: ${r.value}`).join('\n');
    expect(text).toContain('Area treated: Not on file');
    expect(text).toContain('X: EPA reg. no. not on file · rate not recorded');
  });
});

describe('other kinds (#725)', () => {
  it('harvest rows read as a harvest', () => {
    const view = harvestDetail(
      {
        blockLabel: 'Orchard',
        cropLabel: 'Redhaven peach',
        cropPluginId: 'peach-redhaven',
        quantity: '1800 lb',
        lotNumber: 'PCH-27-1',
        moisturePct: null
      },
      en
    );
    expect(view.rows.map((r) => r.value)).toEqual([
      'Orchard',
      'Redhaven peach',
      '1800 lb',
      'PCH-27-1'
    ]);
    expect(view.technical).toEqual([{ label: 'Crop id', value: 'peach-redhaven' }]);
  });

  it('a note-only scout shows its note and no metric code', () => {
    const view = scoutDetail(
      { blockLabel: 'B', pest: 'note', metric: 'note', value: 0, notes: 'Bloom' },
      en
    );
    expect(view.rows).toEqual([
      { label: 'Block', value: 'B' },
      { label: 'Notes', value: 'Bloom', block: true }
    ]);
  });

  it('decon saved data is pretty-printed under technical details', () => {
    const view = deconDetail({ equipmentLabel: 'Sprayer', payloadJson: '{"a":1}' }, en);
    expect(view.rows).toEqual([{ label: 'Equipment', value: 'Sprayer' }]);
    expect(view.technical[0].value).toBe('{\n  "a": 1\n}');
  });
});

describe('soilTestLine (#703)', () => {
  const tr = createT(null);
  it('leaves out blank values', () => {
    expect(
      soilTestLine(
        {
          ph: 5.6,
          organicMatterPct: 3.2,
          nitratePpm: null,
          phosphorusPpm: 45,
          potassiumPpm: 160
        },
        tr
      )
    ).toBe('pH 5.6, OM 3.2%, P 45, K 160 ppm');
  });
  it('uses lb/A for a lab sheet in pounds and never prints a question mark', () => {
    expect(soilTestLine({ ph: 6.1, potassiumPpm: 200, unitsBasis: 'lb-per-acre' }, tr)).toBe(
      'pH 6.1, K 200 lb/A'
    );
    expect(soilTestLine({ ph: 6.1 }, tr)).toBe('pH 6.1');
    expect(soilTestLine({}, tr)).toBe('No values entered');
    expect(soilTestLine({ organicMatterPct: 2 }, createT('es'))).toBe('MO 2.0%');
  });
});
