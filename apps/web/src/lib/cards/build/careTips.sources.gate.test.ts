import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allCareTips } from './careTips';
import {
  careTipIneligibility,
  careTipSourceProblems,
  staleGrandfatheredTips,
  type CareTipSourceMap
} from './careTipsSources';

const REPO_ROOT = path.resolve(__dirname, '../../../../../..');
const sources = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'apps/web/scripts/care-tips-sources.json'), 'utf8')
) as CareTipSourceMap;

const good = {
  url: 'https://extension.example.edu/x',
  publisher: 'Example Extension',
  date: '2025-01-01',
  quote: 'Mulch helps hold soil moisture.',
  verdict: 'supported'
};

describe('D5 Care Guide source gate (real files)', () => {
  it('every tip shown is the exact text checked against a quoted source', () => {
    expect(careTipSourceProblems(allCareTips(), sources)).toEqual([]);
  });

  it('ships tips in every section the Care Guide shows', () => {
    expect(allCareTips().length).toBeGreaterThan(40);
  });

  it('keeps the partly grandfather list to tips that still ship partly', () => {
    expect(staleGrandfatheredTips(allCareTips(), sources)).toEqual([]);
  });

  it('no longer shows the basil pinch tip on every herb (R-20)', () => {
    expect(allCareTips().some((t) => t.id === 'herb-culinary.prune.0')).toBe(false);
  });
});

describe('Phase 37F tip rules', () => {
  const tip = { id: 'herb-culinary.prune.9', text: 'Mulch helps hold soil moisture.' };

  it('refuses a new tip on a partly verdict but keeps a grandfathered one', () => {
    const entry = { ...good, verdict: 'partly', shipped: tip.text };
    expect(careTipSourceProblems([tip], { [tip.id]: entry })).toEqual([
      'herb-culinary.prune.9: a new tip needs a supported verdict'
    ]);
    expect(careTipSourceProblems([tip], { [tip.id]: entry }, new Set([tip.id]))).toEqual([]);
  });

  it('refuses a source off an extension or government host', () => {
    for (const url of ['https://www.seedcompany.com/basil', 'https://example.org/x', 'not a url']) {
      expect(
        careTipSourceProblems([tip], { [tip.id]: { ...good, url, shipped: tip.text } })
      ).toEqual(['herb-culinary.prune.9: source is not an extension or government page']);
    }
    expect(
      careTipSourceProblems([tip], {
        [tip.id]: { ...good, url: 'https://www.ars.usda.gov/x', shipped: tip.text }
      })
    ).toEqual([]);
  });

  it('reports a grandfathered id that stopped shipping partly', () => {
    expect(
      staleGrandfatheredTips([tip], { [tip.id]: { ...good, shipped: tip.text } }, new Set([tip.id]))
    ).toEqual([tip.id]);
    expect(staleGrandfatheredTips([], {}, new Set(['gone.0']))).toEqual(['gone.0']);
  });
});

describe('careTipSourceProblems', () => {
  const tip = { id: 'root.water.0', text: 'Mulch helps hold soil moisture.' };

  it('passes a sourced tip', () => {
    expect(careTipSourceProblems([tip], { 'root.water.0': { ...good, shipped: tip.text } })).toEqual(
      []
    );
  });

  it('fails an unsourced fixture tip', () => {
    expect(careTipSourceProblems([tip], {})).toEqual(['root.water.0: no source entry']);
  });

  it('fails a tip whose shipped text drifted', () => {
    expect(
      careTipSourceProblems([tip], { 'root.water.0': { ...good, shipped: 'Something else.' } })
    ).toEqual(['root.water.0: shipped text differs from the tip']);
  });

  it('fails unsupported, contradicted, empty and abridged sources', () => {
    for (const bad of [
      { ...good, verdict: 'unsupported' },
      { ...good, verdict: 'contradicted' },
      { ...good, url: null },
      { ...good, publisher: '' },
      { ...good, date: null },
      { ...good, quote: null },
      { ...good, quote: 'Mulch helps...hold moisture.' },
      { ...good, quote: 'Mulch helps … hold moisture.' }
    ]) {
      const problems = careTipSourceProblems([tip], {
        'root.water.0': { ...bad, shipped: tip.text }
      });
      expect(problems, JSON.stringify(bad)).toHaveLength(1);
      expect(problems[0]).toMatch(/source cannot back a tip/);
    }
    expect(careTipIneligibility({ ...good, verdict: 'partly' })).toBeNull();
  });

  it('fails two tips that share an id', () => {
    expect(
      careTipSourceProblems([tip, { ...tip }], { 'root.water.0': { ...good, shipped: tip.text } })
    ).toEqual(['root.water.0: two tips share this id']);
  });

  it('fails a shipped entry with no tip and an entry with no shipped field', () => {
    expect(
      careTipSourceProblems([], {
        $comment: 'ignored',
        'root.water.0': { ...good, shipped: tip.text },
        'root.feed.0': { ...good }
      })
    ).toEqual(['root.water.0: shipped text has no tip', 'root.feed.0: entry has no shipped field']);
  });

  it('accepts a removed entry with shipped null', () => {
    expect(
      careTipSourceProblems([], { 'root.feed.0': { ...good, verdict: 'unsupported', shipped: null } })
    ).toEqual([]);
  });
});
