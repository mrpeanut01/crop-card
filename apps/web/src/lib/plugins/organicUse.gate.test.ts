import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPhase32DataKinds, type Phase32DataKinds } from './registryDataKinds';

// OR-07: every shipped animal-health plugin's organicUse must match its
// researched 7 CFR 205.603/205.604 entry in nop-sources.json (OR-02).

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SCRIPTS = path.join(REPO_ROOT, 'apps/web/scripts');

interface ResearchEntry {
  status?: 'allowed' | 'allowed-with-annotation' | 'not-listed' | 'prohibited' | 'unknown';
  url: string;
  publisher: string;
  date: string;
  quote: string;
  note?: string;
}

const research = (
  JSON.parse(readFileSync(path.join(SCRIPTS, 'nop-sources.json'), 'utf8')) as {
    entries: Record<string, ResearchEntry>;
  }
).entries;

const sources = (
  JSON.parse(readFileSync(path.join(SCRIPTS, 'animal-health-sources.json'), 'utf8')) as {
    entries: Record<string, Record<string, Omit<ResearchEntry, 'status'>>>;
  }
).entries;

/** OR-03: each `not-listed` entry, decided by hand. A plugin reaches
 *  `not-allowed` from `not-listed` only when its note sources the active
 *  ingredient as synthetic; none does, so all stay unknown (needs review). */
const NOT_LISTED_DECISIONS: Readonly<Record<string, { decision: 'unknown'; reason: string }>> = {
  'amprol-poultry': { decision: 'unknown', reason: 'amprolium: no sourced synthetic finding' },
  'corid-solution': { decision: 'unknown', reason: 'amprolium: no sourced synthetic finding' },
  'ivomec-injection': { decision: 'unknown', reason: 'ivermectin: no sourced synthetic finding' },
  'ivomec-pour-on': { decision: 'unknown', reason: 'ivermectin: no sourced synthetic finding' },
  'ivomec-sheep-drench': {
    decision: 'unknown',
    reason: 'ivermectin: no sourced synthetic finding'
  },
  'prohibit-levamisole': {
    decision: 'unknown',
    reason: 'levamisole: no sourced synthetic finding'
  },
  'valbazen-suspension': {
    decision: 'unknown',
    reason: 'albendazole: no sourced synthetic finding'
  },
  'synanthic-bovine': { decision: 'unknown', reason: 'oxfendazole: no sourced synthetic finding' },
  'eprinex-pour-on': { decision: 'unknown', reason: 'eprinomectin: no sourced synthetic finding' },
  'gordons-livestock-backrubber-pour-on': {
    decision: 'unknown',
    reason: 'permethrin: 205.601 versus 205.603 left open in the research'
  }
};

type Expected = 'allowed' | 'allowed-with-conditions' | 'not-allowed' | 'unknown';

function expectedStatus(pluginId: string, entry: ResearchEntry): Expected | 'undecided' {
  switch (entry.status) {
    case 'allowed':
      return 'allowed';
    case 'allowed-with-annotation':
      return 'allowed-with-conditions';
    case 'prohibited':
      return 'not-allowed';
    case 'not-listed':
      return NOT_LISTED_DECISIONS[pluginId]?.decision ?? 'undecided';
    default:
      return 'unknown';
  }
}

/** The paragraph markers a citation names after the section, e.g.
 *  "7 CFR 205.603(a)(23)(ii)" → section 205.603, markers (23) and (ii).
 *  The (a) list marker is dropped because the research quotes start below it. */
function citationParts(citation: string): { section: string; markers: string[] } | null {
  const m = /^7 CFR (205\.60[34])((?:\([0-9a-z]+\))+)$/.exec(citation);
  if (!m) return null;
  const markers = (m[2].match(/\([0-9a-z]+\)/g) ?? []).filter((x) => x !== '(a)');
  return { section: m[1], markers };
}

let kinds: Phase32DataKinds;

beforeAll(async () => {
  kinds = await loadPhase32DataKinds(path.join(REPO_ROOT, 'plugins'));
});

describe('animal-health organicUse gate (OR-07)', () => {
  it('loads the library', () => {
    expect(kinds.animalHealth.all().length).toBeGreaterThan(0);
  });

  it('every shipped plugin has a researched livestock entry with a status', () => {
    const missing = kinds.animalHealth
      .all()
      .map((p) => p.pluginId)
      .filter((id) => !research[`livestock.${id}`]?.status);
    expect(missing, 'add entries["livestock.<pluginId>"] to nop-sources.json').toEqual([]);
  });

  it('every not-listed entry has an explicit decision', () => {
    const undecided = kinds.animalHealth
      .all()
      .filter((p) => research[`livestock.${p.pluginId}`]?.status === 'not-listed')
      .map((p) => p.pluginId)
      .filter((id) => !NOT_LISTED_DECISIONS[id]);
    expect(undecided, 'decide each not-listed plugin in NOT_LISTED_DECISIONS').toEqual([]);
  });

  it('organicUse status matches the research mapping', () => {
    const wrong: string[] = [];
    for (const p of kinds.animalHealth.all()) {
      const entry = research[`livestock.${p.pluginId}`];
      if (!entry) continue;
      const want = expectedStatus(p.pluginId, entry);
      const got = p.organicUse?.status ?? 'unknown';
      if (want !== got) wrong.push(`${p.pluginId}: research says ${want}, plugin has ${got}`);
    }
    expect(wrong).toEqual([]);
  });

  it('the citation names the section and paragraph the research quotes', () => {
    const wrong: string[] = [];
    for (const p of kinds.animalHealth.all()) {
      if (!p.organicUse) continue;
      const entry = research[`livestock.${p.pluginId}`];
      const parts = citationParts(p.organicUse.citation);
      if (!entry || !parts) {
        wrong.push(
          `${p.pluginId}: citation ${p.organicUse.citation} is not a 7 CFR 205.603/604 cite`
        );
        continue;
      }
      if (
        !entry.url.includes(`section-${parts.section}`) &&
        !entry.publisher.includes(parts.section)
      ) {
        wrong.push(`${p.pluginId}: research does not cite ${parts.section}`);
      }
      for (const marker of parts.markers) {
        if (!entry.quote.includes(marker)) wrong.push(`${p.pluginId}: quote has no ${marker}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('conditions are copied word for word from the research quote', () => {
    const wrong = kinds.animalHealth
      .all()
      .filter((p) => p.organicUse?.conditions !== undefined)
      .filter(
        (p) => !research[`livestock.${p.pluginId}`]?.quote.includes(p.organicUse!.conditions!)
      )
      .map((p) => p.pluginId);
    expect(wrong).toEqual([]);
  });

  it('allowed-with-conditions always carries its conditions', () => {
    const bare = kinds.animalHealth
      .all()
      .filter((p) => p.organicUse?.status === 'allowed-with-conditions' && !p.organicUse.conditions)
      .map((p) => p.pluginId);
    expect(bare).toEqual([]);
  });

  it('animal-health-sources.json holds the research entry word for word (OR-06)', () => {
    const wrong: string[] = [];
    for (const p of kinds.animalHealth.all()) {
      const copy = sources[p.pluginId]?.organicUse;
      if (!p.organicUse) {
        if (copy) wrong.push(`${p.pluginId}: source copy without organicUse`);
        continue;
      }
      const entry = research[`livestock.${p.pluginId}`];
      if (!copy || !entry) {
        wrong.push(`${p.pluginId}: no organicUse source copy`);
        continue;
      }
      for (const k of ['url', 'publisher', 'date', 'quote'] as const) {
        if (copy[k] !== entry[k]) wrong.push(`${p.pluginId}: ${k} differs from nop-sources.json`);
      }
      if (!copy.note?.includes(`livestock.${p.pluginId}`)) {
        wrong.push(`${p.pluginId}: note does not name the research key`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('no plugin carries organicUse without a research entry', () => {
    const orphans = kinds.animalHealth
      .all()
      .filter((p) => p.organicUse && !research[`livestock.${p.pluginId}`])
      .map((p) => p.pluginId);
    expect(orphans).toEqual([]);
  });

  it('the mapping table covers every research status', () => {
    expect(
      expectedStatus('x', { status: 'prohibited', url: '', publisher: '', date: '', quote: '' })
    ).toBe('not-allowed');
    expect(
      expectedStatus('new-plugin', {
        status: 'not-listed',
        url: '',
        publisher: '',
        date: '',
        quote: ''
      })
    ).toBe('undecided');
    expect(
      expectedStatus('x', { status: 'unknown', url: '', publisher: '', date: '', quote: '' })
    ).toBe('unknown');
    expect(citationParts('7 CFR 205.603(a)(23)(ii)')).toEqual({
      section: '205.603',
      markers: ['(23)', '(ii)']
    });
    expect(citationParts('205.603(a)(4)')).toBeNull();
  });
});
