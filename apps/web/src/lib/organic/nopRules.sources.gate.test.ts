import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOP_RULES, NOP_RULE_SOURCE_KEYS, withholdTreatmentLine } from './nopRules';
import { isVerifiedNopEntry, nopRuleGaps, type NopSourcesFile } from './nopSources';

const FILE = path.resolve(__dirname, '../../../scripts/nop-sources.json');
const sources = JSON.parse(readFileSync(FILE, 'utf8')) as NopSourcesFile;

const ENTRY = {
  url: 'https://www.ecfr.gov/current/title-7/subtitle-B/chapter-I/subchapter-M/part-205',
  publisher: 'eCFR',
  date: '2026-10-01',
  quote: 'A quoted paragraph of at least ten characters.'
};

describe('NOP rules are sourced (B-01 to B-03)', () => {
  it('the shipped rules and nop-sources.json agree', () => {
    expect(
      nopRuleGaps(NOP_RULES, sources),
      'add a verified quote to apps/web/scripts/nop-sources.json, or leave the rule off'
    ).toEqual([]);
  });

  it('has the B-01 shape', () => {
    expect(Object.keys(sources).sort()).toEqual(['$comment', 'ecfrAsOf', 'entries', 'researched']);
    expect(typeof sources.entries).toBe('object');
    expect(Array.isArray(sources.researched)).toBe(true);
  });

  it('every rule maps to a research Task R1 key', () => {
    expect(Object.values(NOP_RULE_SOURCE_KEYS).sort()).toEqual([
      'landTransition',
      'seedSourcing',
      'treatedAnimal',
      'withholdTreatment'
    ]);
  });
});

describe('nopRuleGaps', () => {
  const off = {
    landTransitionMonths: null,
    treatedAnimalRule: false,
    withholdTreatmentCitation: null,
    seedSourcingCitation: null
  };

  it('fails a rule that is on with no entry', () => {
    expect(
      nopRuleGaps({ ...off, landTransitionMonths: 36 }, { ecfrAsOf: null, entries: {} })
    ).toHaveLength(1);
    expect(
      nopRuleGaps({ ...off, treatedAnimalRule: true }, { ecfrAsOf: null, entries: {} })
    ).toHaveLength(1);
  });

  it('fails a value that differs from its entry', () => {
    const file = { ecfrAsOf: '2026-10-01', entries: { landTransition: { ...ENTRY, value: 24 } } };
    expect(nopRuleGaps({ ...off, landTransitionMonths: 36 }, file)[0]).toMatch(/value 24 != 36/);
    expect(nopRuleGaps({ ...off, landTransitionMonths: 24 }, file)).toEqual([]);
  });

  it('fails a citation that differs from its entry', () => {
    const file = {
      ecfrAsOf: '2026-10-01',
      entries: { withholdTreatment: { ...ENTRY, value: '7 CFR 205.238(c)(7)' } }
    };
    expect(nopRuleGaps({ ...off, withholdTreatmentCitation: '205.238' }, file)).toHaveLength(1);
    expect(nopRuleGaps({ ...off, withholdTreatmentCitation: '7 CFR 205.238(c)(7)' }, file)).toEqual(
      []
    );
  });

  it('fails an entry left for a rule that ships off', () => {
    const file = { ecfrAsOf: '2026-10-01', entries: { treatedAnimal: ENTRY } };
    expect(nopRuleGaps(off, file)[0]).toMatch(/ships off/);
  });

  it('accepts a boolean rule with a verified entry', () => {
    const file = { ecfrAsOf: '2026-10-01', entries: { treatedAnimal: ENTRY } };
    expect(nopRuleGaps({ ...off, treatedAnimalRule: true }, file)).toEqual([]);
  });

  it('only counts regulation hosts as verified', () => {
    expect(isVerifiedNopEntry(ENTRY)).toBe(true);
    expect(isVerifiedNopEntry({ ...ENTRY, url: 'https://www.govinfo.gov/app/details/CFR' })).toBe(
      true
    );
    expect(isVerifiedNopEntry({ ...ENTRY, url: 'https://www.ams.usda.gov/rules' })).toBe(false);
    expect(isVerifiedNopEntry({ ...ENTRY, url: 'http://www.ecfr.gov/x' })).toBe(false);
    expect(isVerifiedNopEntry({ ...ENTRY, quote: 'short' })).toBe(false);
  });

  it('needs ecfrAsOf once there are entries', () => {
    const file = { ecfrAsOf: null, entries: { bufferZones: ENTRY } };
    expect(nopRuleGaps(off, file)).toEqual(['ecfrAsOf: missing while entries exist']);
  });
});

describe('withholdTreatmentLine (B-06)', () => {
  it('names no paragraph while the rule is off', () => {
    const line = withholdTreatmentLine(NOP_RULES);
    expect(line).toBe(
      'Treat a sick animal first. Ask your certifier how a treatment affects organic status.'
    );
    expect(line).not.toMatch(/205/);
  });

  it('cites the verified paragraph once on', () => {
    expect(
      withholdTreatmentLine({ ...NOP_RULES, withholdTreatmentCitation: '7 CFR 205.238(c)(7)' })
    ).toBe(
      'Treat a sick animal. The organic rules forbid withholding treatment to keep status (7 CFR 205.238(c)(7)).'
    );
  });
});
