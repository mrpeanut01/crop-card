import { lifecycleHere } from '$lib/garden/lifecycleHere';
import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import {
  GARDEN_BRIEF_SETTING_KEY,
  HERB_CALENDAR_SETTING_KEYS,
  briefGoalsFromSetting,
  herbCalendarInputs,
  herbContextFor,
  interimLifecycleVerdict
} from './herbCalendarContext';
import {
  E2E_TENDER_PERENNIAL_MARKER,
  manualZoneFromReader,
  serverHerbVerdict
} from '$lib/server/herbCalendar.server';

const crop = (over: Partial<CropPlugin>) =>
  ({
    pluginId: 'x',
    type: 'crop',
    displayName: 'X',
    version: '1.0.0',
    cropFamily: 'herb-culinary',
    harvestStyle: 'cut-and-come-again',
    ...over
  }) as CropPlugin;

function reader(values: Record<string, string>) {
  return (key: string) => values[key];
}

describe('briefGoalsFromSetting', () => {
  it('reads goal lists of strings or objects under goal-like keys', () => {
    expect([...briefGoalsFromSetting(JSON.stringify({ storageGoals: ['fresh', 'dry'] }))]).toEqual([
      'fresh',
      'dry'
    ]);
    expect([
      ...briefGoalsFromSetting(
        JSON.stringify({
          harvest: { value: [{ goal: 'pesto', target: 'a dozen' }], provenance: 'manual' }
        })
      )
    ]).toEqual(['pesto']);
    expect([
      ...briefGoalsFromSetting(JSON.stringify({ answers: { goals: [{ method: 'freeze' }] } }))
    ]).toEqual(['freeze']);
  });

  it('has no goals for a missing, broken or goal-free brief', () => {
    expect(briefGoalsFromSetting(undefined).size).toBe(0);
    expect(briefGoalsFromSetting('{not json').size).toBe(0);
    expect(briefGoalsFromSetting(JSON.stringify({ why: ['fresh'] })).size).toBe(0);
    expect(briefGoalsFromSetting(JSON.stringify({ goals: ['canning'] })).size).toBe(0);
  });
});

describe('interim lifecycle verdict (R-17 subset)', () => {
  it('reads only a plugin lifecycle, tagged fallback; perennials and defaults are unknown', () => {
    expect(interimLifecycleVerdict(crop({ agronomy: { lifecycle: 'annual' } }))).toEqual({
      lifecycle: 'annual',
      provenance: 'fallback'
    });
    expect(interimLifecycleVerdict(crop({ agronomy: { lifecycle: 'biennial' } })).lifecycle).toBe(
      'biennial'
    );
    expect(interimLifecycleVerdict(crop({ agronomy: { lifecycle: 'perennial' } })).lifecycle).toBe(
      'unknown'
    );
    expect(interimLifecycleVerdict(crop({})).lifecycle).toBe('unknown');
  });
});

describe('herbCalendarInputs', () => {
  it('lists every key it reads for the loader batch', () => {
    expect(HERB_CALENDAR_SETTING_KEYS).toEqual(
      expect.arrayContaining([
        SETTINGS_KEYS.lastFrost,
        SETTINGS_KEYS.firstFrost,
        SETTINGS_KEYS.hardinessZone,
        SETTINGS_KEYS.hardinessZoneProvenance,
        GARDEN_BRIEF_SETTING_KEY
      ])
    );
  });

  it('normalizes the saved frost dates and reads the goals', () => {
    const inputs = herbCalendarInputs(
      reader({
        [SETTINGS_KEYS.lastFrost]: '2026-04-20',
        [SETTINGS_KEYS.firstFrost]: '10-20',
        [GARDEN_BRIEF_SETTING_KEY]: JSON.stringify({ goals: ['fresh'] })
      })
    );
    expect(inputs.frost).toEqual({ lastMmDd: '04-20', firstMmDd: '10-20' });
    expect(inputs.goals.has('fresh')).toBe(true);
  });

  it('gives a context only to herb garden crops', () => {
    const inputs = herbCalendarInputs(reader({}));
    const basil = crop({ pluginId: 'basil-genovese' });
    expect(
      herbContextFor({ cropPluginId: 'basil-genovese', varietyDisplayName: 'Basil' }, basil, inputs)
    ).toMatchObject({ lifecycle: 'unknown' });
    expect(
      herbContextFor({ cropPluginId: 'tomato-x', varietyDisplayName: 'T' }, basil, inputs)
    ).toBeUndefined();
  });
});

describe('server verdict and its e2e hook', () => {
  const rosemary = crop({ pluginId: 'rosemary-tuscan-blue' });
  const marked = { varietyDisplayName: `Rosemary ${E2E_TENDER_PERENNIAL_MARKER}` };

  it('the marker reads as a tender perennial only with dev routes on', () => {
    expect(serverHerbVerdict({ ENABLE_DEV_ROUTES: '1' })(rosemary, marked)?.lifecycle).toBe(
      'tender-perennial'
    );
    expect(serverHerbVerdict({})(rosemary, marked)?.lifecycle).toBe('unknown');
    expect(
      serverHerbVerdict({ ENABLE_DEV_ROUTES: '1' })(rosemary, { varietyDisplayName: 'R' })
    ).toEqual(lifecycleHere(rosemary, null));
  });

  it('passes an unknown-zone perennial on to the engine as winterUnknown (CO-8)', () => {
    const lemongrass = crop({
      pluginId: 'lemongrass-east-indian',
      agronomy: { lifecycle: 'perennial' }
    } as Partial<CropPlugin>);
    const inputs = herbCalendarInputs(reader({}), serverHerbVerdict({}, '7a'));
    expect(
      herbContextFor(
        { cropPluginId: 'lemongrass-east-indian', varietyDisplayName: 'Lemongrass' },
        lemongrass,
        inputs
      )
    ).toMatchObject({ lifecycle: 'unknown', winterUnknown: true });
  });

  it("reads the owner's typed zone from the same batch", () => {
    expect(
      manualZoneFromReader(
        reader({
          [SETTINGS_KEYS.hardinessZone]: '7b',
          [SETTINGS_KEYS.hardinessZoneProvenance]: 'manual'
        })
      )
    ).toBe('7b');
    expect(manualZoneFromReader(reader({ [SETTINGS_KEYS.hardinessZone]: '7b' }))).toBeNull();
  });
});
