import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_ANIMAL_HEALTH,
  FIXTURE_PEST_MODEL,
  FIXTURE_PET_SPECIES,
  FIXTURE_SPECIES
} from './dataKinds.fixtures';
import {
  FIXTURE_ORCHARD_CALENDAR,
  FIXTURE_ORCHARD_CROPS,
  FIXTURE_ORCHARD_EDITION_YEAR
} from './orchardCalendar.fixtures';
import { loadPluginsFromDirectory } from './loader';
import { PluginRegistrationError, PluginRegistry } from './registry';
import {
  DataKindRegistry,
  droppedCalendarHosts,
  loadPhase32DataKinds,
  validateAnimalHealth,
  validateOrchardCalendar,
  validatePestModel,
  validateSpecies
} from './registryDataKinds';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');

const knownSpecies = { isSpecies: (id: string) => id === FIXTURE_SPECIES.pluginId };

function issuesOf(fn: () => unknown): { path: string; message: string }[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof PluginRegistrationError) return e.issues;
    throw e;
  }
  throw new Error('expected a PluginRegistrationError');
}

describe('species plugins', () => {
  it('accepts the fixtures', () => {
    expect(validateSpecies(FIXTURE_SPECIES).groupNoun).toBe('flock');
    expect(validateSpecies(FIXTURE_PET_SPECIES).foodProducingDefault).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(() => validateSpecies({ ...FIXTURE_SPECIES, withdrawalOverride: 0 })).toThrow(
      PluginRegistrationError
    );
  });

  it('requires foodProducingDefault', () => {
    const { foodProducingDefault: _drop, ...rest } = FIXTURE_SPECIES;
    expect(issuesOf(() => validateSpecies(rest)).map((i) => i.path)).toContain(
      'foodProducingDefault'
    );
  });

  it('rejects duplicate care keys', () => {
    const care = FIXTURE_SPECIES.careDefaults[0];
    expect(() => validateSpecies({ ...FIXTURE_SPECIES, careDefaults: [care, care] })).toThrow(
      PluginRegistrationError
    );
  });
});

describe('animal-health plugins', () => {
  it('accepts the fixture against a registered species', () => {
    const plugin = validateAnimalHealth(FIXTURE_ANIMAL_HEALTH, knownSpecies);
    expect(plugin.labelUses).toHaveLength(2);
  });

  it('defaults a label use class to all', () => {
    const plugin = validateAnimalHealth(
      {
        ...FIXTURE_ANIMAL_HEALTH,
        labelUses: [{ speciesId: FIXTURE_SPECIES.pluginId, withdrawal: { meatDays: 1 } }]
      },
      knownSpecies
    );
    expect(plugin.labelUses[0].class).toBe('all');
  });

  it('refuses a label use naming an unregistered species', () => {
    const issues = issuesOf(() =>
      validateAnimalHealth(FIXTURE_ANIMAL_HEALTH, { isSpecies: () => false })
    );
    expect(issues.map((i) => i.path)).toEqual(['labelUses.0.speciesId', 'labelUses.1.speciesId']);
  });

  it('refuses keys the kernel owns, such as a prohibited-drug override', () => {
    expect(() =>
      validateAnimalHealth({ ...FIXTURE_ANIMAL_HEALTH, prohibited: false }, knownSpecies)
    ).toThrow(PluginRegistrationError);
    const use = { ...FIXTURE_ANIMAL_HEALTH.labelUses[0], extraLabelAllowed: true };
    expect(() =>
      validateAnimalHealth({ ...FIXTURE_ANIMAL_HEALTH, labelUses: [use] }, knownSpecies)
    ).toThrow(PluginRegistrationError);
  });

  it('refuses an empty withdrawal and negative or fractional values', () => {
    for (const withdrawal of [{}, { meatDays: -1 }, { milkHours: 1.5 }, { eggsDays: Number.NaN }]) {
      const use = { speciesId: FIXTURE_SPECIES.pluginId, withdrawal };
      expect(() =>
        validateAnimalHealth({ ...FIXTURE_ANIMAL_HEALTH, labelUses: [use] }, knownSpecies)
      ).toThrow(PluginRegistrationError);
    }
  });

  it('refuses a food with both a withdrawal and a do-not-use', () => {
    const use = {
      speciesId: FIXTURE_SPECIES.pluginId,
      withdrawal: { eggsDays: 2, doNotUseFor: ['eggs'] }
    };
    expect(() =>
      validateAnimalHealth({ ...FIXTURE_ANIMAL_HEALTH, labelUses: [use] }, knownSpecies)
    ).toThrow(PluginRegistrationError);
  });

  it('refuses two label uses for the same species and class', () => {
    const use = FIXTURE_ANIMAL_HEALTH.labelUses[0];
    expect(() =>
      validateAnimalHealth({ ...FIXTURE_ANIMAL_HEALTH, labelUses: [use, use] }, knownSpecies)
    ).toThrow(PluginRegistrationError);
  });
});

describe('pest-model plugins', () => {
  it('accepts the fixture', () => {
    expect(validatePestModel(FIXTURE_PEST_MODEL).method).toBe('single-sine');
  });

  it('only accepts a named method, never an expression', () => {
    for (const method of ['(tmax+tmin)/2-50', 'triangle', '']) {
      expect(() => validatePestModel({ ...FIXTURE_PEST_MODEL, method })).toThrow(
        PluginRegistrationError
      );
    }
    expect(() => validatePestModel({ ...FIXTURE_PEST_MODEL, formula: 'x' })).toThrow(
      PluginRegistrationError
    );
  });

  it('rejects stage advice that talks about spraying', () => {
    for (const message of [
      'Spray the vines now.',
      'Apply an insecticide at the base.',
      'Time a fungicide here.'
    ]) {
      const stage = { ...FIXTURE_PEST_MODEL.stages[1], message };
      expect(() => validatePestModel({ ...FIXTURE_PEST_MODEL, stages: [stage] })).toThrow(
        PluginRegistrationError
      );
    }
  });

  it('checks the cutoff, biofix date and stage ranges', () => {
    const bad = [
      { ...FIXTURE_PEST_MODEL, upperCutoffF: 40 },
      { ...FIXTURE_PEST_MODEL, biofix: { kind: 'calendar-date' } },
      { ...FIXTURE_PEST_MODEL, biofix: { kind: 'january-1', date: '03-01' } },
      { ...FIXTURE_PEST_MODEL, biofix: { kind: 'calendar-date', date: '13-01' } },
      {
        ...FIXTURE_PEST_MODEL,
        stages: [{ ...FIXTURE_PEST_MODEL.stages[0], gddFrom: 500, gddTo: 400 }]
      },
      {
        ...FIXTURE_PEST_MODEL,
        stages: [FIXTURE_PEST_MODEL.stages[1], FIXTURE_PEST_MODEL.stages[1]]
      }
    ];
    for (const raw of bad) expect(() => validatePestModel(raw)).toThrow(PluginRegistrationError);
  });
});

describe('orchard calendar plugins', () => {
  const ctx = { ...FIXTURE_ORCHARD_CROPS, currentYear: FIXTURE_ORCHARD_EDITION_YEAR };

  it('accepts the fixture', () => {
    expect(validateOrchardCalendar(FIXTURE_ORCHARD_CALENDAR, ctx).stages).toHaveLength(3);
  });

  it("accepts last year's edition and refuses older or future ones", () => {
    expect(() =>
      validateOrchardCalendar(FIXTURE_ORCHARD_CALENDAR, { ...ctx, currentYear: 2027 })
    ).not.toThrow();
    for (const currentYear of [2028, 2025]) {
      const issues = issuesOf(() =>
        validateOrchardCalendar(FIXTURE_ORCHARD_CALENDAR, { ...ctx, currentYear })
      );
      expect(issues.map((i) => i.path)).toEqual(['edition']);
    }
  });

  it('refuses a host crop that is not a registered crop or not in a host family', () => {
    const raw = {
      ...FIXTURE_ORCHARD_CALENDAR,
      hostCropPluginIds: ['test-fixture-apple', 'test-fixture-missing', 'test-fixture-blueberry']
    };
    const issues = issuesOf(() => validateOrchardCalendar(raw, ctx));
    expect(issues.map((i) => i.path)).toEqual(['hostCropPluginIds.1', 'hostCropPluginIds.2']);
    expect(issues[1].message).toMatch(/small-fruit/);
  });

  it('refuses a product class or other unknown key', () => {
    expect(() =>
      validateOrchardCalendar({ ...FIXTURE_ORCHARD_CALENDAR, productClasses: [] }, ctx)
    ).toThrow(PluginRegistrationError);
  });
});

describe('DataKindRegistry', () => {
  it('refuses a duplicate id', () => {
    const reg = new DataKindRegistry('species plugin', validateSpecies);
    reg.register(FIXTURE_SPECIES);
    expect(() => reg.register(FIXTURE_SPECIES)).toThrow(PluginRegistrationError);
  });
});

describe('loadPhase32DataKinds', () => {
  async function withTmp(fn: (dir: string) => Promise<void>): Promise<void> {
    const tmp = await mkdtemp(path.join(tmpdir(), 'cropcard-p32-'));
    try {
      await fn(tmp);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  it('loads species before animal-health and reports bad files', async () => {
    await withTmp(async (tmp) => {
      for (const d of ['species', 'animal-health', 'pest-models']) await mkdir(path.join(tmp, d));
      await writeFile(path.join(tmp, 'species', 'hen.json'), JSON.stringify(FIXTURE_SPECIES));
      await writeFile(
        path.join(tmp, 'animal-health', 'a.json'),
        JSON.stringify(FIXTURE_ANIMAL_HEALTH)
      );
      await writeFile(
        path.join(tmp, 'animal-health', 'orphan.json'),
        JSON.stringify({
          ...FIXTURE_ANIMAL_HEALTH,
          pluginId: 'test-fixture-orphan',
          labelUses: [{ speciesId: 'test-fixture-missing', withdrawal: { meatDays: 1 } }]
        })
      );
      await writeFile(path.join(tmp, 'pest-models', 'm.json'), JSON.stringify(FIXTURE_PEST_MODEL));
      await writeFile(path.join(tmp, 'pest-models', 'bad.json'), '{ not json');
      await mkdir(path.join(tmp, 'orchard-calendars'));
      await writeFile(
        path.join(tmp, 'orchard-calendars', 'c.json'),
        JSON.stringify(FIXTURE_ORCHARD_CALENDAR)
      );
      await writeFile(
        path.join(tmp, 'orchard-calendars', 'stale.json'),
        JSON.stringify({
          ...FIXTURE_ORCHARD_CALENDAR,
          pluginId: 'test-fixture-stale-calendar',
          edition: '2020'
        })
      );
      const kinds = await loadPhase32DataKinds(tmp, {
        crops: FIXTURE_ORCHARD_CROPS,
        now: new Date(Date.UTC(FIXTURE_ORCHARD_EDITION_YEAR, 5, 1))
      });
      expect(kinds.species.all().map((s) => s.pluginId)).toEqual([FIXTURE_SPECIES.pluginId]);
      expect(kinds.animalHealth.all().map((p) => p.pluginId)).toEqual([
        FIXTURE_ANIMAL_HEALTH.pluginId
      ]);
      expect(kinds.pestModels.all().map((p) => p.pluginId)).toEqual([FIXTURE_PEST_MODEL.pluginId]);
      expect(kinds.orchardCalendars.all().map((c) => c.pluginId)).toEqual([
        FIXTURE_ORCHARD_CALENDAR.pluginId
      ]);
      expect(kinds.failed.map((f) => path.basename(f.file)).sort()).toEqual([
        'bad.json',
        'orphan.json',
        'stale.json'
      ]);
    });
  });

  it('yields empty registries when the folders are missing', async () => {
    const kinds = await loadPhase32DataKinds(path.join(tmpdir(), 'nope-nope-p32'), {
      crops: FIXTURE_ORCHARD_CROPS
    });
    expect(kinds.species.all()).toEqual([]);
    expect(kinds.animalHealth.all()).toEqual([]);
    expect(kinds.pestModels.all()).toEqual([]);
    expect(kinds.orchardCalendars.all()).toEqual([]);
    expect(kinds.failed).toEqual([]);
  });

  it('keeps one calendar per host crop and audience, newest edition first (OP-3)', async () => {
    await withTmp(async (tmp) => {
      await mkdir(path.join(tmp, 'orchard-calendars'));
      const write = (name: string, over: Record<string, unknown>) =>
        writeFile(
          path.join(tmp, 'orchard-calendars', `${name}.json`),
          JSON.stringify({ ...FIXTURE_ORCHARD_CALENDAR, ...over })
        );
      const year = String(FIXTURE_ORCHARD_EDITION_YEAR);
      const last = String(FIXTURE_ORCHARD_EDITION_YEAR - 1);
      await write('old', { pluginId: 'tf-old', edition: last });
      await write('new', { pluginId: 'tf-new', edition: year });
      const home = structuredClone(FIXTURE_ORCHARD_CALENDAR);
      home.stages[1].windows[0].purpose = 'scout';
      await write('home', { ...home, pluginId: 'tf-home', edition: last, audience: 'home' });
      await write('fig-a', { pluginId: 'tf-fig-a', hostCropPluginIds: ['test-fixture-fig'] });
      await write('fig-b', { pluginId: 'tf-fig-b', hostCropPluginIds: ['test-fixture-fig'] });
      const kinds = await loadPhase32DataKinds(tmp, {
        crops: FIXTURE_ORCHARD_CROPS,
        now: new Date(Date.UTC(FIXTURE_ORCHARD_EDITION_YEAR, 5, 1))
      });
      expect(kinds.failed).toEqual([]);
      expect(kinds.orchardCalendars.all().map((c) => c.pluginId)).toEqual(['tf-home', 'tf-new']);
      expect(kinds.supersededCalendars.map((c) => c.pluginId).sort()).toEqual([
        'tf-fig-a',
        'tf-fig-b',
        'tf-old'
      ]);
      expect(kinds.supersededCalendars.find((c) => c.pluginId === 'tf-old')?.reason).toMatch(
        /superseded/
      );
    });
  });

  it('says how to fix an expired edition', async () => {
    await withTmp(async (tmp) => {
      await mkdir(path.join(tmp, 'orchard-calendars'));
      await writeFile(
        path.join(tmp, 'orchard-calendars', 'c.json'),
        JSON.stringify(FIXTURE_ORCHARD_CALENDAR)
      );
      const kinds = await loadPhase32DataKinds(tmp, {
        crops: FIXTURE_ORCHARD_CROPS,
        now: new Date(Date.UTC(FIXTURE_ORCHARD_EDITION_YEAR + 2, 0, 1))
      });
      expect(kinds.orchardCalendars.all()).toEqual([]);
      expect(JSON.stringify(kinds.failed[0].error)).toMatch(
        /replace the file with the current edition/
      );
    });
  });

  it('remembers which crops a dropped calendar named, and nothing else (OP-28)', async () => {
    await withTmp(async (tmp) => {
      await mkdir(path.join(tmp, 'orchard-calendars'));
      await writeFile(
        path.join(tmp, 'orchard-calendars', 'c.json'),
        JSON.stringify(FIXTURE_ORCHARD_CALENDAR)
      );
      await writeFile(path.join(tmp, 'orchard-calendars', 'broken.json'), '{ not json');
      const kinds = await loadPhase32DataKinds(tmp, {
        crops: FIXTURE_ORCHARD_CROPS,
        now: new Date(Date.UTC(FIXTURE_ORCHARD_EDITION_YEAR + 2, 0, 1))
      });
      expect(kinds.droppedCalendars).toEqual([
        {
          file: path.join(tmp, 'orchard-calendars', 'c.json'),
          pluginId: FIXTURE_ORCHARD_CALENDAR.pluginId,
          audience: FIXTURE_ORCHARD_CALENDAR.audience,
          hostCropPluginIds: FIXTURE_ORCHARD_CALENDAR.hostCropPluginIds
        }
      ]);
      expect(Object.keys(kinds.droppedCalendars[0]).sort()).toEqual([
        'audience',
        'file',
        'hostCropPluginIds',
        'pluginId'
      ]);
    });
  });

  it('a malformed dropped calendar names no crop', () => {
    expect(droppedCalendarHosts({ hostCropPluginIds: ['ok', 7], audience: 'x' }, null)).toEqual({
      file: null,
      pluginId: null,
      audience: null,
      hostCropPluginIds: []
    });
    expect(droppedCalendarHosts('nope', null).hostCropPluginIds).toEqual([]);
    expect(droppedCalendarHosts({ hostCropPluginIds: ['Bad Id'] }, null).hostCropPluginIds).toEqual(
      []
    );
  });

  it('keeps the library loader away from the Phase 32 folders', async () => {
    await withTmp(async (tmp) => {
      for (const d of ['species', 'animal-health', 'pest-models', 'orchard-calendars'])
        await mkdir(path.join(tmp, d));
      await writeFile(path.join(tmp, 'species', 'hen.json'), JSON.stringify(FIXTURE_SPECIES));
      await writeFile(
        path.join(tmp, 'animal-health', 'a.json'),
        JSON.stringify(FIXTURE_ANIMAL_HEALTH)
      );
      await writeFile(path.join(tmp, 'pest-models', 'm.json'), JSON.stringify(FIXTURE_PEST_MODEL));
      await writeFile(
        path.join(tmp, 'orchard-calendars', 'c.json'),
        JSON.stringify(FIXTURE_ORCHARD_CALENDAR)
      );
      const result = await loadPluginsFromDirectory(new PluginRegistry(), tmp);
      expect(result.registered).toEqual([]);
      expect(result.failed).toEqual([]);
    });
  });
});

describe('published JSON Schemas', () => {
  const read = (file: string) =>
    JSON.parse(readFileSync(path.join(REPO_ROOT, 'schemas', file), 'utf-8'));

  it.each([
    ['species.schema.json', 'species', ['foodProducingDefault', 'products', 'tile']],
    ['animal-health.schema.json', 'animal-health', ['productKind', 'labelUses']],
    ['pest-model.schema.json', 'pest-model', ['method', 'baseTempF', 'biofix', 'stages']]
  ])('%s is published, closed and names its kind', (file, type, required) => {
    const schema = read(file);
    expect(schema.$id).toBe(`https://cropcard.dev/schemas/${file}`);
    expect(schema.properties.type.const).toBe(type);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(['pluginId', 'type', ...required]));
  });

  it('pest-model method is an enum, never free text', () => {
    expect(read('pest-model.schema.json').properties.method.enum).toEqual([
      'simple-average',
      'single-sine'
    ]);
  });

  it.each(['herbicide', 'insecticide', 'fungicide'])(
    '%s schema carries grazingRestrictions',
    (kind) => {
      const g = read(`${kind}.schema.json`).properties.grazingRestrictions;
      expect(g.required).toEqual(['source']);
      expect(g.additionalProperties).toBe(false);
    }
  );
});
