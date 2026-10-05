/**
 * TEST FIXTURES ONLY. A schema-valid orchard calendar and matching sources
 * file. The stages, wording, degree days and sources are made up to
 * exercise validation and are not extension data. Never copy these into
 * plugins/ or apps/web/scripts/.
 */

import type { OrchardSourcesFile } from './orchardCalendarSources';

export const FIXTURE_ORCHARD_EDITION_YEAR = 2026;

export const FIXTURE_ORCHARD_CALENDAR = {
  pluginId: 'test-fixture-orchard-calendar',
  type: 'orchard-calendar',
  version: '0.0.0-test',
  audience: 'commercial',
  guide: {
    publisher: 'Test fixture publisher',
    title: 'Test fixture guide',
    publicationId: 'TF-1',
    url: 'https://a.example.edu/guide'
  },
  edition: '2026',
  hostCropFamilies: ['orchard'],
  hostCropPluginIds: ['test-fixture-apple'],
  stages: [
    {
      id: 'fixture-dormant',
      name: 'Test fixture dormant',
      order: 0,
      recognise: {
        description: 'Test fixture buds closed and brown.',
        sourceKey: 'fixture.dormant.recognise'
      },
      windows: [
        {
          id: 'fixture-prune',
          purpose: 'cultural',
          targets: [],
          pollinatorSensitive: false,
          note: 'Test fixture: prune out dead wood.',
          sourceKeys: ['fixture.dormant.prune']
        }
      ]
    },
    {
      id: 'fixture-green-tip',
      name: 'Test fixture green tip',
      order: 1,
      recognise: {
        description: 'Test fixture green tissue shows at the bud tip.',
        sourceKey: 'fixture.greenTip.recognise',
        gddEstimate: {
          baseTempF: 43,
          biofix: { kind: 'calendar-date', date: '03-01' },
          gddFrom: 90,
          gddTo: 120,
          sourceKey: 'fixture.greenTip.gdd'
        }
      },
      windows: [
        {
          id: 'fixture-scab-weather',
          purpose: 'disease-risk',
          targets: [
            { id: 'fixture-scab', kind: 'disease' },
            { id: 'fixture-wet-leaves', kind: 'weather' }
          ],
          pollinatorSensitive: false,
          note: 'Test fixture: watch for long wet periods.',
          sourceKeys: ['fixture.greenTip.scab']
        }
      ]
    },
    {
      id: 'fixture-bloom',
      name: 'Test fixture full bloom',
      order: 2,
      recognise: {
        description: 'Test fixture most flowers open.',
        sourceKey: 'fixture.bloom.recognise'
      },
      windows: [
        {
          id: 'fixture-bloom-watch',
          purpose: 'bloom',
          targets: [{ id: 'fixture-blight', kind: 'disease' }],
          pollinatorSensitive: true,
          note: 'Test fixture: most flowers are open.',
          sourceKeys: ['fixture.bloom.watch']
        }
      ]
    }
  ]
};

const fixtureSource = (host: string, quote: string) => ({
  url: `https://${host}/test-fixture`,
  publisher: 'Test fixture publisher',
  date: '2026-01-01',
  quote,
  edition: '2026',
  page: '1'
});

export const FIXTURE_ORCHARD_SOURCES: OrchardSourcesFile = {
  entries: {
    'fixture.dormant.recognise': { sources: [fixtureSource('a.example.edu', 'Test quote A.')] },
    'fixture.dormant.prune': { sources: [fixtureSource('a.example.edu', 'Test quote B.')] },
    'fixture.greenTip.recognise': { sources: [fixtureSource('a.example.edu', 'Test quote C.')] },
    'fixture.greenTip.gdd': {
      gateEligible: true,
      sources: [
        fixtureSource('a.example.edu', 'Test quote D.'),
        fixtureSource('b.example.gov', 'Test quote E.')
      ]
    },
    'fixture.greenTip.scab': { sources: [fixtureSource('a.example.edu', 'Test quote F.')] },
    'fixture.bloom.recognise': { sources: [fixtureSource('a.example.edu', 'Test quote G.')] },
    'fixture.bloom.watch': { sources: [fixtureSource('a.example.edu', 'Test quote H.')] }
  }
};

/** Crop lookup that knows only the fixture apple and a fixture fig. */
export const FIXTURE_ORCHARD_CROPS = {
  cropFamilyOf: (id: string) =>
    id === 'test-fixture-apple' || id === 'test-fixture-fig'
      ? 'orchard'
      : id === 'test-fixture-blueberry'
        ? 'small-fruit'
        : undefined
};
