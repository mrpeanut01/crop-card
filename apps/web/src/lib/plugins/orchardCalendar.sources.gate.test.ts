import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPluginsFromDirectory } from './loader';
import { PluginRegistry } from './registry';
import { loadPhase32DataKinds, type Phase32DataKinds } from './registryDataKinds';
import {
  FIXTURE_ORCHARD_CALENDAR,
  FIXTURE_ORCHARD_CROPS,
  FIXTURE_ORCHARD_SOURCES
} from './orchardCalendar.fixtures';
import {
  orchardCalendarProblems,
  orchardCrossCalendarProblems,
  orchardSourceFileProblems,
  type OrchardSourcesFile
} from './orchardCalendarSources';
import { orchardCalendarPluginSchema, type OrchardCalendarPlugin } from './schemas';

// Ruling OC-8 gate: every orchard calendar value rests on a quote in
// orchard-calendar-sources.json, a degree-day estimate on two agreeing
// sources (OC-5), the copy guard holds and host crops resolve.

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const PLUGINS_DIR = path.join(REPO_ROOT, 'plugins');
const CALENDAR_DIR = path.join(PLUGINS_DIR, 'orchard-calendars');
const SOURCES = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'apps/web/scripts/orchard-calendar-sources.json'), 'utf8')
) as OrchardSourcesFile;

let library: PluginRegistry;
let kinds: Phase32DataKinds;
let productNames: string[];
const cropFamilyOf = (id: string) => {
  const p = library.get(id)?.plugin;
  return p?.type === 'crop' ? p.cropFamily : undefined;
};

beforeAll(async () => {
  library = new PluginRegistry();
  await loadPluginsFromDirectory(library, PLUGINS_DIR);
  kinds = await loadPhase32DataKinds(PLUGINS_DIR, { crops: { cropFamilyOf } });
  productNames = library.all().flatMap((r) => {
    const p = r.plugin;
    if (p.type === 'crop' || p.type === 'companion') return [];
    const ingredients =
      'activeIngredients' in p && Array.isArray(p.activeIngredients)
        ? p.activeIngredients.map((a: { name: string }) => a.name)
        : [];
    return [p.displayName, ...ingredients];
  });
});

function fixture(): OrchardCalendarPlugin {
  return orchardCalendarPluginSchema.parse(structuredClone(FIXTURE_ORCHARD_CALENDAR));
}

const fixtureCtx = {
  ...FIXTURE_ORCHARD_CROPS,
  productNames: ['Test Fixture Brand 80W', 'testfixturazole']
};

describe('shipped orchard calendars', () => {
  it('the folder holds only a README until sourced data lands, or calendars that all load', () => {
    const files = readdirSync(CALENDAR_DIR);
    expect(files).toContain('README.md');
    const json = files.filter((f) => f.endsWith('.json'));
    expect(kinds.failed.filter((f) => f.file.startsWith(CALENDAR_DIR))).toEqual([]);
    expect(kinds.orchardCalendars.all()).toHaveLength(json.length);
    expect(kinds.supersededCalendars).toEqual([]);
  });

  it('every source key is used, and each target id keeps one kind (OP-16)', () => {
    expect(orchardCrossCalendarProblems(kinds.orchardCalendars.all(), SOURCES)).toEqual([]);
  });

  it('the sources file is well formed', () => {
    expect(orchardSourceFileProblems(SOURCES)).toEqual([]);
  });

  it('every shipped calendar is sourced, guarded and hosted by registered crops', () => {
    const problems = kinds.orchardCalendars
      .all()
      .flatMap((c) => orchardCalendarProblems(c, SOURCES, { cropFamilyOf, productNames }));
    expect(problems).toEqual([]);
  });

  it('the library product list is loaded for the copy guard', () => {
    expect(productNames.length).toBeGreaterThan(50);
  });
});

describe('orchard calendar gate on the fixture', () => {
  it('passes the cross-calendar checks', () => {
    const sources = structuredClone(FIXTURE_ORCHARD_SOURCES);
    const rekeyed = { entries: {} as OrchardSourcesFile['entries'] };
    const c = fixture();
    for (const [k, v] of Object.entries(sources.entries)) {
      rekeyed.entries[`${c.pluginId}.${k}`] = v;
    }
    for (const st of c.stages) {
      st.recognise.sourceKey = `${c.pluginId}.${st.recognise.sourceKey}`;
      if (st.recognise.gddEstimate) {
        st.recognise.gddEstimate.sourceKey = `${c.pluginId}.${st.recognise.gddEstimate.sourceKey}`;
      }
      for (const w of st.windows) w.sourceKeys = w.sourceKeys.map((k) => `${c.pluginId}.${k}`);
    }
    expect(orchardCrossCalendarProblems([c], rekeyed)).toEqual([]);

    const orphan = structuredClone(rekeyed);
    orphan.entries[`${c.pluginId}.unused`] = orphan.entries[`${c.pluginId}.fixture.dormant.prune`];
    orphan.entries['other.key'] = orphan.entries[`${c.pluginId}.fixture.dormant.prune`];
    const problems = orchardCrossCalendarProblems([c], orphan).join('\n');
    expect(problems).toMatch(/unused: is not used/);
    expect(problems).toMatch(/other.key: does not start/);
    orphan.entries[`${c.pluginId}.unused`] = {
      ...orphan.entries[`${c.pluginId}.unused`],
      gateEligible: false,
      note: 'Test fixture: records an absence.'
    };
    expect(orchardCrossCalendarProblems([c], orphan).join()).not.toMatch(/unused: is not used/);

    const kindClash = structuredClone(c);
    kindClash.stages[0].windows[0].targets = [{ id: 'fixture-scab', kind: 'pest' }];
    expect(orchardCrossCalendarProblems([kindClash], rekeyed).join()).toMatch(
      /fixture-scab has more than one kind/
    );
  });

  it('needs a source of the calendar edition on every window and a matching guide host (OP-16)', () => {
    const old = structuredClone(FIXTURE_ORCHARD_SOURCES);
    for (const s of old.entries['fixture.dormant.prune'].sources) s.edition = '2019';
    expect(orchardCalendarProblems(fixture(), old, fixtureCtx).join()).toMatch(
      /fixture-prune: no source of the calendar's edition/
    );
    const c = fixture();
    c.guide.url = 'https://elsewhere.example.gov/guide';
    expect(orchardCalendarProblems(c, FIXTURE_ORCHARD_SOURCES, fixtureCtx).join()).toMatch(
      /guide host elsewhere.example.gov/
    );
  });

  it('needs a note on a quote joining table cells', () => {
    const sources = structuredClone(FIXTURE_ORCHARD_SOURCES);
    sources.entries['fixture.dormant.prune'].sources[0].quote = 'HEADING / Cell';
    expect(orchardSourceFileProblems(sources).join()).toMatch(/needs a note/);
    sources.entries['fixture.dormant.prune'].sources[0].note = 'Test fixture: joined table cells.';
    expect(orchardSourceFileProblems(sources)).toEqual([]);
  });

  it('passes the fixture', () => {
    expect(orchardSourceFileProblems(FIXTURE_ORCHARD_SOURCES)).toEqual([]);
    expect(orchardCalendarProblems(fixture(), FIXTURE_ORCHARD_SOURCES, fixtureCtx)).toEqual([]);
  });

  it('fails a stage description, window or estimate whose key does not resolve', () => {
    const c = fixture();
    c.stages[0].recognise.sourceKey = 'fixture.missing.a';
    c.stages[0].windows[0].sourceKeys = ['fixture.missing.b'];
    c.stages[1].recognise.gddEstimate!.sourceKey = 'fixture.missing.c';
    const problems = orchardCalendarProblems(c, FIXTURE_ORCHARD_SOURCES, fixtureCtx);
    for (const key of ['fixture.missing.a', 'fixture.missing.b', 'fixture.missing.c']) {
      expect(problems.join('\n')).toContain(key);
    }
  });

  it('fails a degree-day estimate that is not gateEligible (OC-5)', () => {
    const sources = structuredClone(FIXTURE_ORCHARD_SOURCES);
    sources.entries['fixture.greenTip.gdd'] = {
      gateEligible: false,
      note: 'Test fixture: only one guide gives a range.',
      sources: [sources.entries['fixture.greenTip.gdd'].sources[0]]
    };
    expect(orchardSourceFileProblems(sources)).toEqual([]);
    expect(orchardCalendarProblems(fixture(), sources, fixtureCtx).join()).toMatch(
      /not gateEligible/
    );
    delete sources.entries['fixture.greenTip.gdd'].gateEligible;
    expect(orchardCalendarProblems(fixture(), sources, fixtureCtx).join()).toMatch(
      /not gateEligible/
    );
  });

  it('refuses gateEligible on one source, two sources from one host or a page reader', () => {
    const one = structuredClone(FIXTURE_ORCHARD_SOURCES);
    one.entries['fixture.greenTip.gdd'].sources.pop();
    expect(orchardSourceFileProblems(one).join()).toMatch(/two agreeing sources/);

    const sameHost = structuredClone(FIXTURE_ORCHARD_SOURCES);
    const [a] = sameHost.entries['fixture.greenTip.gdd'].sources;
    sameHost.entries['fixture.greenTip.gdd'].sources = [a, { ...a, quote: 'Other quote.' }];
    expect(orchardSourceFileProblems(sameHost).join()).toMatch(/two agreeing sources/);

    const reader = structuredClone(FIXTURE_ORCHARD_SOURCES);
    reader.entries['fixture.greenTip.gdd'].sources[1].note = 'Page reader extraction.';
    expect(orchardSourceFileProblems(reader).join()).toMatch(/two agreeing sources/);
  });

  it('does not count a page reader source toward a description', () => {
    const sources = structuredClone(FIXTURE_ORCHARD_SOURCES);
    sources.entries['fixture.dormant.recognise'].sources[0].note = 'page reader';
    expect(orchardCalendarProblems(fixture(), sources, fixtureCtx).join()).toMatch(
      /fixture\.dormant\.recognise does not resolve/
    );
  });

  it('needs a reason when an entry is not gateEligible', () => {
    const sources = structuredClone(FIXTURE_ORCHARD_SOURCES);
    sources.entries['fixture.dormant.recognise'].gateEligible = false;
    expect(orchardSourceFileProblems(sources).join()).toMatch(/say in note why/);
  });

  it('only takes https .edu or .gov sources with every field', () => {
    const sources = structuredClone(FIXTURE_ORCHARD_SOURCES);
    const s = sources.entries['fixture.dormant.prune'].sources[0];
    sources.entries['fixture.dormant.prune'].sources = [
      { ...s, url: 'https://seed-company.example.com/page' },
      { ...s, url: 'http://a.example.edu/page' },
      { ...s, edition: '' },
      { ...s, page: '' },
      { ...s, quote: ' ' },
      { ...s, brand: 'x' } as typeof s
    ];
    sources.entries['fixture.empty'] = { sources: [] };
    const problems = orchardSourceFileProblems(sources).join('\n');
    for (const p of [
      /not an \.edu or \.gov host/,
      /url must be https/,
      /missing edition/,
      /missing page/,
      /missing quote/,
      /unknown field brand/,
      /fixture\.empty: needs at least one source/
    ]) {
      expect(problems).toMatch(p);
    }
  });

  it('fails a host crop that does not resolve or is outside the host families', () => {
    const c = fixture();
    c.hostCropPluginIds = ['test-fixture-apple', 'test-fixture-gone', 'test-fixture-blueberry'];
    const problems = orchardCalendarProblems(c, FIXTURE_ORCHARD_SOURCES, fixtureCtx).join('\n');
    expect(problems).toMatch(/test-fixture-gone is not a registered crop plugin/);
    expect(problems).toMatch(/test-fixture-blueberry is in family small-fruit/);
  });

  it('holds the copy guard and refuses library product names', () => {
    const c = fixture();
    c.stages[0].name = 'Test fixture spray stage';
    c.stages[0].recognise.description = 'Use Test Fixture Brand 80W now.';
    c.stages[1].windows[0].note = 'Testfixturazole at green tip.';
    c.stages[2].windows[0].note = 'Respete el intervalo de reingreso.';
    const problems = orchardCalendarProblems(c, FIXTURE_ORCHARD_SOURCES, fixtureCtx).join('\n');
    expect(problems).toMatch(/fixture-dormant name: spraying or a pesticide/);
    expect(problems).toMatch(/library product or ingredient Test Fixture Brand 80W/);
    expect(problems).toMatch(/library product or ingredient testfixturazole/);
    expect(problems).toMatch(/fixture-bloom window fixture-bloom-watch note: PHI or REI/);
  });
});
