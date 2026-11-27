import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { en } from '$lib/i18n/catalogs/en';
import { enSoil } from '$lib/i18n/catalogs/en/soil';
import { esSoil } from '$lib/i18n/catalogs/es/soil';
import loudoun from '$lib/server/__fixtures__/sda-loudoun.json';
import mobile from '$lib/server/__fixtures__/sda-mobile-water-table.json';
import bozeman from '$lib/server/__fixtures__/sda-bozeman-urban.json';
import udorthents from '$lib/server/__fixtures__/sda-leesburg-udorthents.json';
import ocean from '$lib/server/__fixtures__/sda-ocean-empty.json';
import { showsSoilSurvey } from './areas';
import { soilLookupSchema, soilSurveyQuerySchema, soilSurveySchema } from './apiSchemas';
import { describeSoil, formatSoilDepth, textureClassOf } from './describe';
import { drainageClassFromWords, isEmptySdaAnswer, parseSdaTable } from './parse';
import {
  HIGH_WATER_TABLE_CAUTION_CM,
  SHALLOW_BEDROCK_NOTE_CM,
  SLOPE_MODERATE_PCT,
  SLOPE_STEEP_PCT,
  slopeBand,
  soilSitingFlags,
  soilSitingFlagText
} from './siting';
import { DRAINAGE_CLASSES, SOIL_SOURCE_NAME, type SoilSurvey } from './types';

// Live Soil Data Access answers recorded 2026-11-27 with the query in
// lib/server/soil/ssurgo.server.ts: a Loudoun County hillside (-77.70, 39.08),
// Mobile AL with a water table (-88.24, 30.69), Bozeman MT urban land
// (-111.04, 45.68), Leesburg VA Udorthents (-77.5636, 39.1157), open ocean
// (-70, 35), and the XML it sends with HTTP 400 for a bad query.
const sdaError = readFileSync(
  resolve(process.cwd(), 'src/lib/server/__fixtures__/sda-error.xml'),
  'utf8'
);

const AT = Date.UTC(2026, 10, 27);
const survey = (json: unknown): SoilSurvey => {
  const s = parseSdaTable(json, AT);
  if (!s) throw new Error('fixture did not parse');
  return s;
};

describe('parseSdaTable', () => {
  it('reads the Loudoun farm soil', () => {
    const s = survey(loudoun);
    expect(s).toMatchObject({
      mapUnitKey: '642027',
      mapUnitSymbol: '20E',
      mapUnitName: 'Tankerville and Purcellville soils, 25 to 45 percent slopes',
      farmlandClass: 'Not prime farmland',
      drainageClass: 'well',
      slopePct: 35,
      waterTableDepthCm: null,
      bedrockDepthCm: 89,
      hydrologicGroup: 'B',
      floodFrequency: 'None',
      availableWaterCm: 14.94,
      notSoil: false,
      source: { name: SOIL_SOURCE_NAME, fetchedAt: AT }
    });
    expect(s.components).toEqual([
      {
        name: 'Purcellville',
        percent: 46,
        drainageClass: 'well',
        slopePct: 35,
        hydric: false,
        surfaceTexture: 'Silty clay loam',
        sandPct: 7.3,
        siltPct: 65.7,
        clayPct: 27,
        organicMatterPct: 1.25,
        ph: { low: 5.6, typical: 5.8, high: 6 }
      },
      {
        name: 'Tankerville',
        percent: 42,
        drainageClass: 'well',
        slopePct: 35,
        hydric: false,
        surfaceTexture: 'Loam',
        sandPct: 43,
        siltPct: 38.5,
        clayPct: 18.5,
        organicMatterPct: 1,
        ph: { low: 5.1, typical: 5.3, high: 5.5 }
      }
    ]);
    expect(soilSurveySchema.safeParse(s).success).toBe(true);
  });

  it('reads a water table and an Urban land component with no properties', () => {
    const s = survey(mobile);
    expect(s.drainageClass).toBe('moderately-well');
    expect(s.waterTableDepthCm).toBe(62);
    expect(s.bedrockDepthCm).toBeNull();
    expect(s.slopePct).toBe(2.7);
    expect(s.notSoil).toBe(false);
    expect(s.components.map((c) => [c.name, c.percent, c.surfaceTexture])).toEqual([
      ['Saucier', 60, 'Fine sandy loam'],
      ['Urban land', 30, null]
    ]);
    expect(s.components[1]).toMatchObject({ drainageClass: null, ph: null, hydric: false });
  });

  it('marks urban land and Udorthents with no data as not soil', () => {
    const urban = survey(bozeman);
    expect(urban.notSoil).toBe(true);
    expect(urban.drainageClass).toBeNull();
    expect(urban.components).toHaveLength(1);
    expect(urban.components[0]).toMatchObject({ name: 'Urban land', percent: 100, hydric: null });
    const fill = survey(udorthents);
    expect(fill.notSoil).toBe(true);
    expect(fill.slopePct).toBe(7);
    expect(fill.mapUnitName).toBe('Udorthents');
  });

  it('answers null for the ocean, and knows empty from unreadable', () => {
    expect(parseSdaTable(ocean)).toBeNull();
    expect(isEmptySdaAnswer(ocean)).toBe(true);
    expect(isEmptySdaAnswer({ Table: [] })).toBe(true);
    expect(isEmptySdaAnswer({ Table: [loudoun.Table[0]] })).toBe(true);
    expect(isEmptySdaAnswer(loudoun)).toBe(false);
    for (const bad of [sdaError, null, undefined, 7, [], { Table: 'x' }, { error: 'boom' }]) {
      expect(parseSdaTable(bad)).toBeNull();
      expect(isEmptySdaAnswer(bad)).toBe(false);
    }
  });

  it('never throws on truncated or malformed answers', () => {
    const text = JSON.stringify(loudoun);
    for (let cut = 0; cut < text.length; cut += 37) {
      expect(() => parseSdaTable(text.slice(0, cut))).not.toThrow();
    }
    expect(parseSdaTable(text.slice(0, 400))).toBeNull();
    expect(parseSdaTable(text)).not.toBeNull();
    expect(parseSdaTable({ Table: [['mukey', 'muname'], 'row'] })).toBeNull();
    expect(
      parseSdaTable({
        Table: [
          ['mukey', 'muname'],
          [null, null]
        ]
      })
    ).toBeNull();
    expect(
      parseSdaTable({
        Table: [
          [1, 2],
          ['a', 'b']
        ]
      })
    ).toBeNull();
    fc.assert(
      fc.property(fc.anything(), (junk) => {
        const out = parseSdaTable(junk);
        expect(out === null || typeof out.mapUnitKey === 'string').toBe(true);
      })
    );
    fc.assert(
      fc.property(fc.array(fc.array(fc.option(fc.string()), { maxLength: 31 })), (rows) => {
        expect(() => parseSdaTable({ Table: [loudoun.Table[0], ...rows] })).not.toThrow();
      })
    );
  });

  it('drops out-of-range numbers and unknown class words', () => {
    const [header, row] = loudoun.Table as [string[], (string | null)[]];
    const edit = (changes: Record<string, string | null>) => {
      const next = [...row];
      for (const [k, v] of Object.entries(changes)) next[header.indexOf(k)] = v;
      return survey({ Table: [header, next] });
    };
    const s = edit({
      drclassdcd: 'Subaqueous',
      slopegradwta: 'steep',
      ph1to1h2o_r: '40',
      om_r: '-3',
      hydricrating: 'Unranked'
    });
    expect(s.drainageClass).toBeNull();
    expect(s.slopePct).toBeNull();
    expect(s.components[0].ph).toEqual({ low: 5.6, typical: null, high: 6 });
    expect(s.components[0].organicMatterPct).toBeNull();
    expect(s.components[0].hydric).toBeNull();
  });

  it('maps the seven NRCS drainage classes and nothing else', () => {
    const words = [
      'Excessively drained',
      'Somewhat excessively drained',
      'Well drained',
      'Moderately well drained',
      'Somewhat poorly drained',
      'Poorly drained',
      'Very poorly drained'
    ];
    expect(words.map(drainageClassFromWords)).toEqual([...DRAINAGE_CLASSES]);
    expect(drainageClassFromWords('  WELL DRAINED ')).toBe('well');
    expect(drainageClassFromWords('drained')).toBeNull();
    expect(drainageClassFromWords(null)).toBeNull();
  });
});

describe('describeSoil', () => {
  const byId = (s: SoilSurvey, opts: Parameters<typeof describeSoil>[1]) =>
    Object.fromEntries(describeSoil(s, opts).map((l) => [l.id, l]));

  it('describes the Loudoun soil in plain English with US units', () => {
    const lines = describeSoil(survey(loudoun), { units: 'us' });
    expect(lines.every((l) => l.provenance === 'data')).toBe(true);
    expect(lines).toEqual([
      {
        id: 'name',
        label: 'What the survey calls this soil',
        value: 'Tankerville and Purcellville soils, 25 to 45 percent slopes',
        note: 'Main soils mapped here: Purcellville (46%), Tankerville (42%).',
        provenance: 'data'
      },
      {
        id: 'texture',
        label: 'Top layer',
        value: 'Silty clay loam',
        note: 'A heavy soil with a lot of clay.',
        provenance: 'data'
      },
      {
        id: 'drainage',
        label: 'Drainage',
        value: 'Well drained',
        note: 'Water drains away readily. The soil does not stay soggy for long.',
        provenance: 'data'
      },
      { id: 'slope', label: 'Slope', value: 'Very steep (35%)', provenance: 'data' },
      {
        id: 'water-table',
        label: 'Depth to water in the wet season',
        value: 'None noted in the survey',
        provenance: 'data'
      },
      { id: 'bedrock', label: 'Depth to rock', value: 'About 35 in down', provenance: 'data' },
      { id: 'flooding', label: 'Flooding', value: 'None', provenance: 'data' },
      {
        id: 'ph',
        label: 'Typical pH of the top layer',
        value: '5.6 to 6.0, usually about 5.8',
        note: "This is the survey's usual range for this kind of soil, not a test of your ground.",
        provenance: 'data'
      },
      {
        id: 'organic-matter',
        label: 'Organic matter in the top layer',
        value: '1.25%',
        note: "The survey's typical value for this kind of soil.",
        provenance: 'data'
      },
      { id: 'farmland', label: 'Farmland class', value: 'Not prime farmland', provenance: 'data' }
    ]);
  });

  it('is byte-identical English with no locale, an English locale or an unknown one', () => {
    for (const fixture of [loudoun, mobile, bozeman, udorthents]) {
      for (const units of ['us', 'metric'] as const) {
        const plain = JSON.stringify(describeSoil(survey(fixture), { units }));
        for (const locale of [undefined, null, 'en', 'xx']) {
          expect(JSON.stringify(describeSoil(survey(fixture), { units, locale }))).toBe(plain);
        }
      }
    }
  });

  it('uses cm for metric and feet from three feet down', () => {
    expect(byId(survey(loudoun), { units: 'metric' }).bedrock.value).toBe('About 89 cm down');
    expect(byId(survey(mobile), { units: 'us' })['water-table'].value).toBe('About 24 in down');
    expect(byId(survey(mobile), { units: 'metric' })['water-table'].value).toBe('About 62 cm down');
    expect(formatSoilDepth(150, { units: 'us' })).toBe('4.9 ft');
    expect(formatSoilDepth(150, { units: 'metric' })).toBe('150 cm');
    expect(formatSoilDepth(91, { units: 'us' })).toBe('36 in');
  });

  it('speaks Spanish, keeping the survey name as data', () => {
    const es = byId(survey(mobile), { units: 'metric', locale: 'es' });
    expect(es.name.label).toBe('Cómo llama el estudio a este suelo');
    expect(es.name.value).toBe('Saucier-Urban land complex, 0 to 8 percent slopes');
    expect(es.texture.value).toBe('Franco arenoso (Fine sandy loam)');
    expect(es.texture.note).toBe('Un suelo liviano con mucha arena.');
    expect(es.drainage.value).toBe('Moderadamente bien drenado');
    expect(es['water-table'].value).toBe('A unos 62 cm de profundidad');
    expect(es.bedrock.value).toBe('El estudio no indica ninguna');
    expect(es.flooding.value).toBe('Ninguna');
    expect(es.farmland.value).toBe('No es tierra agrícola de primera');
    expect(es.ph.value).toBe('4.5 a 5.5, por lo general cerca de 5.0');
    const exact = byId(survey(loudoun), { units: 'us', locale: 'es' });
    expect(exact.texture.value).toBe('Franco arcillo limoso');
    expect(exact.slope.value).toBe('Muy empinado (35%)');
  });

  it('says only what the survey has for ground that is not soil', () => {
    expect(describeSoil(survey(bozeman), { units: 'us' }).map((l) => l.id)).toEqual([
      'name',
      'farmland'
    ]);
    expect(describeSoil(survey(udorthents), { units: 'us' }).map((l) => l.id)).toEqual([
      'name',
      'slope',
      'farmland'
    ]);
  });

  it('passes NRCS words it does not know through as written', () => {
    const s = {
      ...survey(loudoun),
      farmlandClass: 'Prime farmland if drained',
      floodFrequency: 'Common'
    };
    for (const locale of [undefined, 'es']) {
      const lines = byId(s, { units: 'us', locale });
      expect(lines.farmland.value).toBe('Prime farmland if drained');
      expect(lines.flooding.value).toBe('Common');
    }
  });

  it('finds the basic texture class inside NRCS texture words', () => {
    expect(textureClassOf('Silty clay loam')).toBe('silty-clay-loam');
    expect(textureClassOf('Fine sandy loam')).toBe('sandy-loam');
    expect(textureClassOf('Very gravelly loamy fine sand')).toBe('loamy-sand');
    expect(textureClassOf('Channery silt loam')).toBe('silt-loam');
    expect(textureClassOf('Clay')).toBe('clay');
    expect(textureClassOf('Mucky peat')).toBe('organic');
    expect(textureClassOf('Weathered bedrock')).toBeNull();
    expect(textureClassOf(null)).toBeNull();
  });

  it('names each texture class in English exactly as NRCS does', () => {
    for (const name of [
      'Sand',
      'Loamy sand',
      'Sandy loam',
      'Loam',
      'Silt loam',
      'Silt',
      'Sandy clay loam',
      'Clay loam',
      'Silty clay loam',
      'Sandy clay',
      'Silty clay',
      'Clay'
    ]) {
      const s = survey(loudoun);
      s.components[0].surfaceTexture = name;
      const line = byId(s, { units: 'us', locale: 'es' }).texture;
      expect(line.value, name).not.toContain('(');
    }
  });
});

describe('soilSitingFlags', () => {
  const base = survey(loudoun);
  const flags = (changes: Partial<SoilSurvey>) =>
    soilSitingFlags({ ...base, slopePct: 0, bedrockDepthCm: null, ...changes });

  it('flags the recorded soils', () => {
    expect(soilSitingFlags(base)).toEqual([
      { id: 'shallow-bedrock', severity: 'note' },
      { id: 'steep', severity: 'caution' }
    ]);
    expect(soilSitingFlags(survey(mobile))).toEqual([{ id: 'high-water-table', severity: 'note' }]);
    expect(soilSitingFlags(survey(bozeman))).toEqual([{ id: 'not-soil', severity: 'note' }]);
    expect(soilSitingFlags(survey(udorthents))).toEqual([{ id: 'not-soil', severity: 'note' }]);
  });

  it('reads wet and droughty from the NRCS drainage class only', () => {
    const got = Object.fromEntries(DRAINAGE_CLASSES.map((d) => [d, flags({ drainageClass: d })]));
    expect(got).toEqual({
      excessively: [{ id: 'droughty', severity: 'note' }],
      'somewhat-excessively': [{ id: 'droughty', severity: 'note' }],
      well: [],
      'moderately-well': [],
      'somewhat-poorly': [{ id: 'wet', severity: 'note' }],
      poorly: [{ id: 'wet', severity: 'caution' }],
      'very-poorly': [{ id: 'wet', severity: 'caution' }]
    });
  });

  it('reads flooding from the NRCS frequency words and hydric from the rating', () => {
    const flood = (w: string | null) => flags({ floodFrequency: w });
    expect(flood('Frequent')).toEqual([{ id: 'floods', severity: 'caution' }]);
    expect(flood('Very frequent')).toEqual([{ id: 'floods', severity: 'caution' }]);
    expect(flood('Occasional')).toEqual([{ id: 'floods', severity: 'note' }]);
    for (const w of ['Rare', 'Very rare', 'None', null, 'sometimes']) expect(flood(w)).toEqual([]);
    expect(
      flags({ components: [base.components[0], { ...base.components[1], hydric: true }] })
    ).toEqual([{ id: 'hydric', severity: 'note' }]);
  });

  it('uses the named app thresholds for slope and depth', () => {
    expect(flags({ slopePct: SLOPE_MODERATE_PCT - 0.1 })).toEqual([]);
    expect(flags({ slopePct: SLOPE_MODERATE_PCT })).toEqual([{ id: 'steep', severity: 'note' }]);
    expect(flags({ slopePct: SLOPE_STEEP_PCT })).toEqual([{ id: 'steep', severity: 'caution' }]);
    expect(flags({ waterTableDepthCm: HIGH_WATER_TABLE_CAUTION_CM })).toEqual([
      { id: 'high-water-table', severity: 'caution' }
    ]);
    expect(flags({ bedrockDepthCm: SHALLOW_BEDROCK_NOTE_CM + 1 })).toEqual([]);
    expect(flags({ bedrockDepthCm: 20 })).toEqual([{ id: 'shallow-bedrock', severity: 'caution' }]);
    expect([0, 3, 8, 15, 30].map(slopeBand)).toEqual([
      'flat',
      'gentle',
      'moderate',
      'steep',
      'very-steep'
    ]);
  });

  it('has a sentence for every flag in both languages', () => {
    for (const id of [
      'wet',
      'steep',
      'shallow-bedrock',
      'high-water-table',
      'floods',
      'droughty',
      'not-soil',
      'hydric'
    ] as const) {
      for (const severity of ['note', 'caution'] as const) {
        const english = soilSitingFlagText({ id, severity });
        const spanish = soilSitingFlagText({ id, severity }, 'es');
        expect(english.length).toBeGreaterThan(10);
        expect(spanish.length).toBeGreaterThan(10);
        expect(spanish).not.toBe(english);
        expect(soilSitingFlagText({ id, severity }, 'en')).toBe(english);
      }
    }
  });
});

describe('soil copy rules', () => {
  it('every soil key has Spanish and belongs to the soil. prefix alone', () => {
    expect(Object.keys(esSoil).sort()).toEqual(Object.keys(enSoil).sort());
    for (const key of Object.keys(enSoil)) expect(key.startsWith('soil.')).toBe(true);
    const others = Object.keys(en).filter((k) => k.startsWith('soil.') && !(k in enSoil));
    expect(others).toEqual([]);
  });

  it('uses no dashes, never says "safe" and gives no planting or amendment advice', () => {
    for (const table of [enSoil, esSoil] as Record<string, string>[]) {
      for (const [key, text] of Object.entries(table)) {
        expect(text, key).not.toMatch(/[–—]/);
        expect(text, key).not.toMatch(/\bsafe|\bsegur[oa]/i);
        expect(text, key).not.toMatch(/\b(add lime|fertiliz|you should plant|plant here)/i);
      }
    }
  });
});

describe('soil API schemas', () => {
  it('accepts plain decimal coordinates in range and nothing else', () => {
    const ok = (lat: string, lon: string) => soilSurveyQuerySchema.safeParse({ lat, lon });
    expect(ok('39.08', '-77.7').data).toEqual({ lat: 39.08, lon: -77.7 });
    expect(ok(' 39 ', '-77').data).toEqual({ lat: 39, lon: -77 });
    for (const [lat, lon] of [
      ['', ''],
      ['91', '0'],
      ['0', '181'],
      ['x', '1'],
      ['1e1', '1'],
      ['39.08); DROP TABLE mapunit --', '-77'],
      ['39.08', "-77') OR 1=1"],
      ['NaN', '0'],
      ['Infinity', '0']
    ]) {
      expect(ok(lat, lon).success, `${lat},${lon}`).toBe(false);
    }
  });

  it('round-trips each lookup status', () => {
    for (const lookup of [
      { status: 'ok', survey: survey(mobile) },
      { status: 'no-data' },
      { status: 'unavailable' }
    ]) {
      expect(soilLookupSchema.parse(JSON.parse(JSON.stringify(lookup)))).toEqual(lookup);
    }
  });
});

describe('showsSoilSurvey', () => {
  it('is for ground a crop grows in', () => {
    expect(['field', 'garden', 'orchard', 'pasture'].every(showsSoilSurvey)).toBe(true);
    for (const kind of ['greenhouse', 'barn', 'house', 'woods', 'pond', 'boundary', null]) {
      expect(showsSoilSurvey(kind)).toBe(false);
    }
  });
});
