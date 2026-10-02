import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LAND_TRANSITION_CITATION,
  NOP_RULES,
  NOP_RULES_OFF,
  NOP_RULE_SOURCE_KEYS,
  TREATED_ANIMAL_CITATION,
  seedSourcingLine,
  withholdTreatmentLine
} from './nopRules';
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

  it('ships all four rules on (2026-10-02)', () => {
    expect(NOP_RULES).toEqual({
      landTransitionMonths: 36,
      treatedAnimalRule: true,
      withholdTreatmentCitation: '7 CFR 205.238(c)(7)',
      seedSourcingCitation: '7 CFR 205.204(a)'
    });
  });

  it('each switched-on entry quotes the paragraph its citation names', () => {
    const e = sources.entries as Record<string, { url: string; quote: string; value?: unknown }>;
    const research = sources.entries as Record<string, { url: string; quote: string }>;
    expect(LAND_TRANSITION_CITATION).toBe('7 CFR 205.202(b)');
    expect(e.landTransition.url).toMatch(/section-205\.202$/);
    expect(e.landTransition.quote).toContain(
      '(b) Have had no prohibited substances, as listed in § 205.105, applied to it for a period of 3 years immediately preceding harvest of the crop'
    );
    expect(e.landTransition.value).toBe(36);

    expect(TREATED_ANIMAL_CITATION).toBe('7 CFR 205.238(c)(1)');
    expect(e.treatedAnimal.url).toMatch(/section-205\.238$/);
    expect(e.treatedAnimal.quote).toMatch(
      /^\(c\) Prohibited practices\. .*\(1\) Sell, label, or represent as organic any animal or product derived from any animal treated with antibiotics/
    );
    expect(e.treatedAnimal.quote).not.toContain('(7)');

    expect(e.withholdTreatment.url).toMatch(/section-205\.238$/);
    expect(e.withholdTreatment.quote).toContain(
      '(7) Withhold medical treatment from a sick animal in an effort to preserve its organic status.'
    );

    expect(e.seedSourcing.url).toMatch(/section-205\.204$/);
    expect(e.seedSourcing.quote).toMatch(/^\(a\) The producer must use organically grown seeds/);

    const verbatim = (part: string) => part.split(' [...] ');
    for (const key of ['treatedAnimal', 'withholdTreatment']) {
      for (const part of verbatim(e[key].quote)) {
        expect(research['livestock.healthCare.prohibitedPracticesTreated'].quote).toContain(part);
      }
    }
    expect(e.landTransition.quote).toBe(research['transition.landRequirement'].quote);
    expect(e.seedSourcing.quote).toBe(research['seed.205204a'].quote);
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
  const off = NOP_RULES_OFF;

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
      entries: { withholdTreatment: { ...ENTRY, value: '7 CFR 999.1(a)' } }
    };
    expect(nopRuleGaps({ ...off, withholdTreatmentCitation: '999.1' }, file)).toHaveLength(1);
    expect(nopRuleGaps({ ...off, withholdTreatmentCitation: '7 CFR 999.1(a)' }, file)).toEqual([]);
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
    const line = withholdTreatmentLine(NOP_RULES_OFF);
    expect(line).toBe(
      'Treat a sick animal first. Ask your certifier how a treatment affects organic status.'
    );
    expect(line).not.toMatch(/205/);
  });

  it('cites the verified paragraph once on', () => {
    expect(withholdTreatmentLine()).toBe(
      'Treat a sick animal. The organic rules forbid withholding treatment to keep status (7 CFR 205.238(c)(7)).'
    );
  });
});

describe('seedSourcingLine (O-14)', () => {
  it('names no paragraph while the rule is off', () => {
    expect(seedSourcingLine(NOP_RULES_OFF)).toBe('Ask your certifier whether a search was enough.');
  });

  it('cites 205.204(a) once on and leaves the judgement to the certifier', () => {
    const line = seedSourcingLine();
    expect(line).toBe(
      'The organic rules require organically grown seeds, annual seedlings and planting stock, except as 7 CFR 205.204(a) allows. Your certifier decides whether a search was enough.'
    );
    expect(line).not.toMatch(/certified|compliant|eligible|—/i);
  });
});

describe('rule lines in Spanish keep the citation verbatim', () => {
  it('welfare and seed lines', () => {
    expect(withholdTreatmentLine(NOP_RULES, 'es')).toBe(
      'Trata a un animal enfermo. Las normas orgánicas prohíben negar un tratamiento para conservar el estado (7 CFR 205.238(c)(7)).'
    );
    expect(withholdTreatmentLine(NOP_RULES_OFF, 'es')).not.toMatch(/205/);
    expect(seedSourcingLine(NOP_RULES, 'es')).toContain('salvo lo que permite 7 CFR 205.204(a).');
    expect(seedSourcingLine(NOP_RULES_OFF, 'es')).toBe(
      'Pregúntale a tu certificador si una búsqueda fue suficiente.'
    );
  });
});
