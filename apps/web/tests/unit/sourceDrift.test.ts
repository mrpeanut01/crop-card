// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkedIds,
  classifyUrl,
  collectRefs,
  dropAcknowledged,
  ecfrTargets,
  evaluateEcfr,
  evaluateOmri,
  evaluatePage,
  evaluatePpls,
  evaluateQuotes,
  extractHtmlText,
  findOmriListing,
  fingerprint,
  hasOpenItems,
  mergeIssueBody,
  omriTargets,
  pageBlocked,
  parseOmriQuote,
  pluginRegRefs,
  pplsTargets,
  quoteFound,
  quotesOffPage,
  quotePieces,
  TABLE_GAP_WORDS,
  renderSection,
  settleFingerprints
} from '../../scripts/lib/sourceDrift.mjs';

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures/source-drift', name), 'utf8'));

const LABEL_2021 = 'https://www3.epa.gov/pesticides/chem_search/ppls/000100-00497-20211110.pdf';
const LABEL_2024 = 'https://www3.epa.gov/pesticides/chem_search/ppls/000100-00497-20240708.pdf';

function sources() {
  return [
    {
      name: 'epa-reg-sources.json',
      json: {
        $comment: 'x',
        entries: { 'aatrex-4l': { epaRegistrationNumber: '100-497', sourceUrl: LABEL_2021 } },
        rei: {
          $comment: 'y',
          'aatrex-4l': { sourceUrl: LABEL_2024, docDate: '2024-07-08', quote: 'REI 12 hours' }
        },
        pollinator: {
          'acramite-bifenazate': {
            sourceUrl: 'https://www3.epa.gov/pesticides/chem_search/ppls/000400-00503-20201216.pdf',
            docDate: '2020-12-16'
          }
        },
        complianceFlags: {
          'actinovate-streptomyces': {
            omriListed: true,
            sourceUrl: 'https://www.omri.org/omri-search?query=Actinovate',
            docDate: '2026-10-08',
            quote:
              'Novozymes Actinovate® AG Biological Fungicide | Novozymes BioAg | nbl-5404 | NOP | Allowed with Restrictions | expires 2027-09-01'
          }
        }
      }
    },
    {
      name: 'nop-sources.json',
      json: {
        ecfrAsOf: '2026-09-29',
        entries: {
          'treatedAnimal.rule': {
            url: 'https://www.ecfr.gov/current/title-7/part-205/section-205.238',
            date: '2026-10-01',
            quote: 'x'
          },
          'old.rule': {
            url: 'https://www.ecfr.gov/current/title-7/part-205/section-205.603#p-205.603(a)',
            quote: 'y'
          }
        }
      }
    },
    {
      name: 'species-sources.json',
      json: {
        entries: {
          chicken: {
            foodProducingDefault: {
              url: 'https://www.law.cornell.edu/cfr/text/9/301.2',
              date: '2026-09-28'
            }
          }
        }
      }
    }
  ];
}

const got = <T>(map: Map<string, T[]>, key: string): T[] => map.get(key) ?? [];

const pluginIds = new Set([
  'aatrex-4l',
  'acramite-bifenazate',
  'actinovate-streptomyces',
  'chicken'
]);

describe('classifyUrl', () => {
  it('reads the registration number and stamp date from a PPLS label URL', () => {
    expect(classifyUrl(LABEL_2021)).toEqual({
      kind: 'ppls',
      regNo: '100-497',
      labelDate: '2021-11-10'
    });
  });
  it('maps eCFR and Cornell LII CFR URLs to title, part and section', () => {
    expect(classifyUrl('https://www.ecfr.gov/current/title-7/section-205.206')).toEqual({
      kind: 'ecfr',
      title: '7',
      part: '205',
      section: '205.206'
    });
    expect(
      classifyUrl(
        'https://www.ecfr.gov/current/title-21/chapter-I/subchapter-E/part-530/subpart-E/section-530.41'
      )
    ).toMatchObject({ title: '21', part: '530', section: '530.41' });
    expect(classifyUrl('https://www.law.cornell.edu/cfr/text/9/381.1')).toMatchObject({
      kind: 'ecfr',
      title: '9',
      part: '381',
      section: '381.1'
    });
  });
  it('treats other .edu and .gov hosts as pages and skips the rest', () => {
    expect(classifyUrl('https://www.pubs.ext.vt.edu/426/426-331/426-331.html').kind).toBe('page');
    expect(classifyUrl('https://dailymed.nlm.nih.gov/dailymed/x').kind).toBe('page');
    expect(classifyUrl('https://www.aspca.org/x').kind).toBe('other');
    expect(classifyUrl('https://www.omri.org/omri-search?query=Actinovate')).toEqual({
      kind: 'omri',
      query: 'Actinovate'
    });
  });
});

describe('collectRefs', () => {
  const refs = collectRefs(sources(), pluginIds);
  it('finds every URL with its plugin, field and date', () => {
    const rei = refs.find((r) => r.path === 'rei.aatrex-4l.sourceUrl');
    expect(rei).toMatchObject({
      pluginId: 'aatrex-4l',
      field: 'rei',
      date: '2024-07-08',
      quote: 'REI 12 hours'
    });
  });
  it('dates a PPLS ref by its label stamp, not docDate', () => {
    expect(refs.find((r) => r.path === 'entries.aatrex-4l.sourceUrl')?.date).toBe('2021-11-10');
  });
  it('falls back to the file-level ecfrAsOf and drops URL fragments', () => {
    const r = refs.find((x) => x.path === 'entries.old.rule.url');
    expect(r?.date).toBe('2026-09-29');
    expect(r?.url).not.toContain('#');
  });
  it('adds plugin EPA numbers, including distributor numbers', () => {
    const extra = pluginRegRefs([
      {
        file: 'plugins/fungicides/cease-omri.json',
        json: { pluginId: 'cease-omri', epaRegistrationNumber: '264-1155-68539' }
      },
      { file: 'plugins/crops/corn.json', json: { pluginId: 'corn' } }
    ]);
    expect(extra).toHaveLength(1);
    expect(pplsTargets(extra).get('264-1155-68539')).toHaveLength(1);
  });
});

describe('PPLS', () => {
  const refs = collectRefs(sources(), pluginIds);
  const targets = pplsTargets(refs);

  it('flags a newer stamped label only for refs quoting an older one', () => {
    const { findings, unreachable } = evaluatePpls('100-497', got(targets, '100-497'), {
      ok: true,
      items: fixture('ppls-100-497.json').items
    });
    expect(unreachable).toEqual([]);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.id).toBe('ppls:100-497:label:2024-07-08');
    expect(f.oldDate).toBe('2021-11-10');
    expect(f.refs.map((r: { path: string }) => r.path)).toEqual(['entries.aatrex-4l.sourceUrl']);
    expect(f.links[0]).toBe(LABEL_2024);
  });

  it('reports nothing when every ref quotes the newest label', () => {
    const current = got(targets, '100-497').filter((r) => r.date === '2024-07-08');
    expect(
      evaluatePpls('100-497', current, { ok: true, items: fixture('ppls-100-497.json').items })
        .findings
    ).toEqual([]);
  });

  it('flags a transfer to a new registration number', () => {
    const { findings } = evaluatePpls('400-503', got(targets, '400-503'), {
      ok: true,
      items: fixture('ppls-400-503.json').items
    });
    expect(findings.map((f: { id: string }) => f.id)).toContain('ppls:400-503:transfer:70506-536');
    expect(findings.find((f: { id: string }) => f.id.includes('transfer'))?.newDate).toBe(
      '2021-06-09'
    );
  });

  it('flags a cancelled or inactive registration', () => {
    const refsX = [
      {
        file: 'plugins/herbicides/xtendimax.json',
        path: 'epaRegistrationNumber',
        regNo: '264-1210'
      }
    ];
    const { findings } = evaluatePpls('264-1210', refsX, {
      ok: true,
      items: fixture('ppls-264-1210.json').items
    });
    expect(findings[0].id).toBe('ppls:264-1210:status:Inactive');
    expect(findings[0].title).toContain('Other');
  });

  it('flags a number PPLS does not know', () => {
    const { findings } = evaluatePpls('279-3313', [], {
      ok: true,
      items: fixture('ppls-not-found.json').items
    });
    expect(findings[0].id).toBe('ppls:279-3313:not-found');
  });

  it('reports an outage as unreachable, never as no change', () => {
    const r = evaluatePpls('100-497', got(targets, '100-497'), {
      ok: false,
      error: 'HTTP 502 after 4 attempts'
    });
    expect(r.findings).toEqual([]);
    expect(r.unreachable).toEqual([
      { kind: 'ppls', target: '100-497', error: 'HTTP 502 after 4 attempts' }
    ]);
  });
});

describe('OMRI', () => {
  const [target] = omriTargets(collectRefs(sources(), pluginIds));
  const search = fixture('omri-search-actinovate.json');

  it('parses the pipe quote and the older comma form', () => {
    expect(target.listing).toEqual({
      product: 'Novozymes Actinovate® AG Biological Fungicide',
      code: 'nbl-5404',
      status: 'Allowed with Restrictions',
      expires: '2027-09-01'
    });
    expect(
      parseOmriQuote(
        "OMRI NOP listing 'PFR-97 20% WDG', Certis Biologicals, cbs-1234, expires 2026-12-01"
      )?.code
    ).toBe('cbs-1234');
    expect(parseOmriQuote('OMRI search: no listing')).toBeNull();
  });

  it('finds the NOP listing by code in a recorded search', () => {
    expect(findOmriListing(search, 'nbl-5404')).toMatchObject({
      status: 'Allowed with Restrictions',
      expires: '2027-09-01'
    });
    expect(findOmriListing(search, 'nbl-21131')).toBeNull();
  });

  it('is quiet for a live listing far from expiry', () => {
    const listing = findOmriListing(search, 'nbl-5404');
    expect(evaluateOmri(target, { ok: true, listing }, '2026-10-08').findings).toEqual([]);
  });

  it('warns 60 days before expiry and after it', () => {
    const listing = findOmriListing(search, 'nbl-5404');
    expect(evaluateOmri(target, { ok: true, listing }, '2027-07-15').findings[0].id).toBe(
      'omri:nbl-5404:expiring:2027-09-01'
    );
    expect(evaluateOmri(target, { ok: true, listing }, '2027-07-01').findings).toEqual([]);
    expect(evaluateOmri(target, { ok: true, listing }, '2027-09-02').findings[0].id).toBe(
      'omri:nbl-5404:expired:2027-09-01'
    );
  });

  it('flags a listing gone from search, a changed status and a renewed expiry', () => {
    expect(evaluateOmri(target, { ok: true, listing: null }, '2026-10-08').findings[0].id).toBe(
      'omri:nbl-5404:missing'
    );
    const changed = evaluateOmri(
      target,
      { ok: true, listing: { title: 'x', status: 'Prohibited', expires: '2028-09-01' } },
      '2026-10-08'
    ).findings.map((f: { id: string }) => f.id);
    expect(changed).toEqual(['omri:nbl-5404:status:Prohibited', 'omri:nbl-5404:expiry:2028-09-01']);
  });

  it('still judges expiry from the quote when OMRI is unreachable', () => {
    const r = evaluateOmri(target, { ok: false, error: 'ETIMEDOUT' }, '2027-09-10');
    expect(r.unreachable).toHaveLength(1);
    expect(r.findings[0].id).toBe('omri:nbl-5404:expired:2027-09-01');
  });
});

describe('eCFR', () => {
  const targets = ecfrTargets(collectRefs(sources(), pluginIds));

  it('is quiet when the section was last amended before the quote', () => {
    const key = '7:205:205.238';
    expect(
      evaluateEcfr(key, got(targets, key), {
        ok: true,
        json: fixture('ecfr-title-7-part-205.json')
      }).findings
    ).toEqual([]);
    const cfr9 = '9:301:301.2';
    expect(
      evaluateEcfr(cfr9, got(targets, cfr9), {
        ok: true,
        json: fixture('ecfr-title-9-part-301.json')
      }).findings
    ).toEqual([]);
  });

  it('flags a section amended after the quote date', () => {
    const key = '7:205:205.238';
    const old = got(targets, key).map((r) => ({ ...r, date: '2023-01-01' }));
    const { findings } = evaluateEcfr(key, old, {
      ok: true,
      json: fixture('ecfr-title-7-part-205.json')
    });
    expect(findings[0]).toMatchObject({
      id: 'ecfr:7:205.238:2024-01-12',
      oldDate: '2023-01-01',
      newDate: '2024-01-12'
    });
  });

  it('flags a section missing from the versions list and an outage', () => {
    const json = fixture('ecfr-title-21-part-530.json');
    expect(evaluateEcfr('21:530:530.99', [], { ok: true, json }).findings[0].id).toBe(
      'ecfr:21:530.99:not-found'
    );
    expect(
      evaluateEcfr('21:530:530.41', [], { ok: false, error: 'HTTP 503' }).unreachable
    ).toHaveLength(1);
  });
});

describe('pages', () => {
  const html = (body: string) =>
    `<html><head><title>t</title><script>var x=${Math.random()}</script></head><body><nav>menu</nav><main>${body}</main><footer>© now</footer></body></html>`;
  const fp = (body: string, status = 200) =>
    fingerprint({
      status,
      headers: { 'content-type': 'text/html' },
      body: Buffer.from(html(body))
    });

  it('extracts main text and ignores scripts, navigation and footers', () => {
    expect(extractHtmlText(html('<p>Space plants 9&ndash;15 inches&nbsp;apart.</p>'))).toBe(
      'Space plants 9–15 inches apart.'
    );
    expect(fp('<p>Same</p>').hash).toBe(fp('<p>Same</p>').hash);
  });

  it('flags changed text or status, and lists a page with no baseline', () => {
    const before = { ...fp('<p>Space plants 9 inches apart.</p>'), checkedOn: '2026-10-08' };
    expect(
      evaluatePage('https://x.edu/a', [], before, {
        ok: true,
        fingerprint: fp('<p>Space plants 9 inches apart.</p>')
      }).findings
    ).toEqual([]);
    expect(
      evaluatePage('https://x.edu/a', [], before, {
        ok: true,
        fingerprint: fp('<p>Space plants 12 inches apart.</p>')
      }).findings[0].title
    ).toContain('text changed');
    expect(
      evaluatePage('https://x.edu/a', [], before, { ok: true, fingerprint: fp('', 404) })
        .findings[0].title
    ).toContain('HTTP 200 → 404');
    expect(
      evaluatePage('https://x.edu/a', [], undefined, { ok: true, fingerprint: fp('x') }).noBaseline
    ).toEqual(['https://x.edu/a']);
  });

  it('ignores sidebar blocks that swap places between requests', () => {
    expect(fp('<p>Plant 9 inches apart.</p><div>Latest: A</div><div>Featured: B</div>').hash).toBe(
      fp('<p>Plant 9 inches apart.</p><div>Featured: B</div><div>Latest: A</div>').hash
    );
  });

  it('leaves a changed page alone while every stored quote still reads the same', () => {
    const before = fp('<p>Space plants 9 inches apart.</p><div>News: old</div>');
    const after = fp('<p>Space plants 9 inches apart.</p><div>News: new</div>');
    const refs = [
      {
        file: 'crop-data-sources.json',
        path: 'kale.inRowSpacingIn.url',
        quote: 'Space plants 9 inches apart.'
      }
    ];
    const same = evaluatePage('https://x.edu/a', refs, before, {
      ok: true,
      fingerprint: after,
      text: 'Space plants 9 inches apart. News: new'
    });
    expect(same.findings).toEqual([]);
    const moved = evaluatePage('https://x.edu/a', refs, before, {
      ok: true,
      fingerprint: after,
      text: 'Space plants 12 inches apart. News: new'
    });
    expect(moved.findings[0].detail).toContain('1 of 1 stored quote(s) no longer found');
  });

  it('counts only status for a page whose quotes live elsewhere', () => {
    const refs = [
      {
        file: 'crop-data-sources.json',
        path: 'peach.harvestSeason.url',
        quote: 'Harvest season is Aug. 25 to Aug. 31.'
      }
    ];
    const landing = 'Peach and Nectarine Varieties for Virginia. Downloads: 12';
    expect(quotesOffPage(refs, landing)).toEqual(['peach.harvestSeason.url']);
    const before = { ...fp('<p>Downloads: 12</p>'), offPage: ['peach.harvestSeason.url'] };
    const r = evaluatePage('https://x.edu/h', refs, before, {
      ok: true,
      fingerprint: fp('<p>Downloads: 13</p>'),
      text: 'Downloads: 13'
    });
    expect(r.findings).toEqual([]);
  });

  it('treats a bot wall as could-not-check and a flapping page as volatile', () => {
    const wall = Buffer.from(
      '<html><body>Request unsuccessful. Incapsula incident ID: 1</body></html>'
    );
    expect(pageBlocked({ status: 200, headers: { 'content-type': 'text/html' }, body: wall })).toBe(
      'bot protection page'
    );
    expect(pageBlocked({ status: 403, headers: {}, body: Buffer.from('') })).toBe(
      'HTTP 403 (blocked)'
    );
    expect(settleFingerprints([fp('a'), fp('b'), fp('a')]).volatile).toBeUndefined();
    expect(settleFingerprints([fp('a'), fp('b'), fp('c')]).volatile).toBe(true);
  });
});

describe('quotes', () => {
  it('matches word for word across line breaks, ligatures and ellipses', () => {
    const doc =
      'Do not apply this product while bees are\nforaging the treat-\nment area.\nRestricted-entry interval (REI) of 12 hours.';
    expect(
      quoteFound(
        doc,
        'Do not apply this product while bees are foraging ... interval (REI) of 12 hours'
      ).ok
    ).toBe(true);
    const miss = quoteFound(doc, 'interval (REI) of 24 hours');
    expect(miss.ok).toBe(false);
    expect(miss.missing).toEqual(['interval (REI) of 24 hours']);
  });

  it('checks the quoted words of a labelled quote and drops editorial marks', () => {
    expect(quotePieces('Alfalfa, Fertilizer: "At seeding: zero N, 110-140 lbs P2O5."')).toEqual([
      'At seeding: zero N, 110-140 lbs P2O5.'
    ]);
    expect(quotePieces('Bravo® 720 [logo here] FUNGICIDE | 54.0% chlorothalonil (p.4)')).toEqual([
      'Bravo® 720',
      'FUNGICIDE',
      '54.0% chlorothalonil'
    ]);
    expect(quotePieces('(no bee or pollinator statement anywhere on the label)')).toEqual([]);
  });

  it('finds a table column read down the page, in order and close together', () => {
    const layout =
      'Broccoli        Diamondback moth   0.5 - 1.0   1\nBrussels Sprouts   Loopers   0.5   1\nCauliflower    Armyworm  1.0   1';
    expect(quoteFound(layout, 'Broccoli Brussels Sprouts Cauliflower').ok).toBe(true);
    expect(quoteFound(layout, 'Cauliflower Brussels Sprouts Broccoli').ok).toBe(false);
    expect(
      quoteFound(`Broccoli ${'x '.repeat(TABLE_GAP_WORDS + 1)} Cauliflower`, 'Broccoli Cauliflower')
        .ok
    ).toBe(false);
  });

  it('turns a missing quote into a finding per ref', () => {
    const refs = [
      {
        file: 'epa-reg-sources.json',
        path: 'rei.x.sourceUrl',
        pluginId: 'x',
        field: 'rei',
        quote: 'REI of 24 hours',
        date: '2024-07-08'
      }
    ];
    const r = evaluateQuotes('https://www3.epa.gov/a.pdf', refs, {
      ok: true,
      text: 'REI of 12 hours'
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].kind).toBe('quote');
  });
});

describe('issue body', () => {
  const report = {
    generatedOn: '2026-10-08',
    findings: [
      {
        id: 'ppls:100-497:label:2024-07-08',
        kind: 'ppls',
        title: 'A',
        refs: [],
        links: ['https://x']
      },
      { id: 'omri:nbl-5404:missing', kind: 'omri', title: 'B', refs: [], links: [] }
    ],
    unreachable: [{ kind: 'ppls', target: '1-2', error: 'HTTP 502' }],
    noBaseline: []
  };

  it('keeps ticks across re-runs and drops acknowledged findings', () => {
    const first = mergeIssueBody(undefined, 'weekly', renderSection('weekly', report, '', 'o/r'));
    expect(hasOpenItems(first)).toBe(true);
    const ticked = first.replace('- [ ] **A**', '- [x] **A**');
    expect([...checkedIds(ticked)]).toEqual(['ppls:100-497:label:2024-07-08']);
    const again = mergeIssueBody(ticked, 'weekly', renderSection('weekly', report, ticked, 'o/r'));
    expect(again).toContain('- [x] **A**');
    expect(again).toContain('Could not check 1 source');
    expect(
      dropAcknowledged(report.findings, { 'omri:nbl-5404:missing': { reason: 'r' } })
    ).toHaveLength(1);
  });

  it('replaces only its own section and closes out when nothing is open', () => {
    const weekly = mergeIssueBody(undefined, 'weekly', renderSection('weekly', report, '', 'o/r'));
    const both = mergeIssueBody(
      weekly,
      'quotes',
      renderSection('quotes', { ...report, findings: [], unreachable: [] }, weekly, 'o/r')
    );
    expect(both.indexOf('section:weekly')).toBeLessThan(both.indexOf('section:quotes'));
    const clean = mergeIssueBody(
      both,
      'weekly',
      renderSection('weekly', { ...report, findings: [], unreachable: [] }, both, 'o/r')
    );
    expect(clean).toContain('Nothing changed.');
    expect(hasOpenItems(clean)).toBe(false);
  });

  it('stays under the GitHub body limit with many findings', () => {
    const many = {
      ...report,
      findings: Array.from({ length: 900 }, (_, i) => ({
        id: `page:${i}`,
        kind: 'page',
        title: `https://example.edu/${'x'.repeat(80)}/${i}: text changed`,
        refs: Array.from({ length: 5 }, () => ({
          file: 'crop-data-sources.json',
          path: 'a.b.url',
          pluginId: 'p',
          field: 'a',
          date: '2026-01-01'
        })),
        links: [`https://example.edu/${i}`]
      }))
    };
    const text = renderSection('weekly', many, '', 'o/r');
    expect(text.length).toBeLessThanOrEqual(30_000);
    expect(text).toContain('did not fit');
    expect(text).toContain('`p` a (5 reference(s))');
  });
});
