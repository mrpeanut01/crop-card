import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { eventsForPlanting } from '$lib/calendar/engine';
import type { CropPlugin, HerbicidePlugin } from '$lib/plugins/schemas';
import type { Philosophy, WeedStrategy } from './setup';
import {
  buildSeasonSprayFilter,
  effectiveWeedGate,
  filterSprayWindowsBySeason,
  herbicideWindowAllowed
} from './sprayWindowFilter';

const PLANT = Date.UTC(2027, 4, 20);

function crop(family: string, pluginId: string, extras: Partial<CropPlugin> = {}): CropPlugin {
  return {
    type: 'crop',
    pluginId,
    displayName: pluginId,
    version: '1',
    cropFamily: family,
    ...extras
  } as CropPlugin;
}

function herbicide(
  pluginId: string,
  chemistryClass: string,
  flags: HerbicidePlugin['complianceFlags'] = undefined
): HerbicidePlugin {
  return {
    type: 'herbicide',
    pluginId,
    displayName: pluginId,
    version: '1',
    activeIngredients: [{ name: pluginId, chemistryClass: chemistryClass as never }],
    ratePerAcre: { amount: 1, unit: 'pt' },
    gpaCalibration: 15,
    complianceFlags: flags
  } as HerbicidePlugin;
}

const POOL = [
  herbicide('clethodim', 'accase-inhibitor', { omriListed: false, certifiedOrganicAllowed: false }),
  herbicide('dicamba', 'synthetic-auxin')
];

const pumpkin = crop('cucurbit', 'pumpkin', {
  sprayWindows: [
    {
      chemistryClass: 'accase-inhibitor',
      anchor: 'planting',
      offsetDaysMin: 30,
      offsetDaysMax: 60,
      title: 'POST grass window (Clethodim)',
      purpose: 'post-emergent'
    }
  ]
});
const delicata = crop('cucurbit', 'winter-squash-delicata');
const corn = crop('corn', 'corn');

function windowsFor(c: CropPlugin, philosophy: Philosophy, weedStrategy: WeedStrategy) {
  const events = eventsForPlanting(
    {
      id: 'p',
      blockId: 'b',
      cropPluginId: c.pluginId,
      varietyDisplayName: c.pluginId,
      plantingDate: PLANT
    },
    c
  );
  const filter = buildSeasonSprayFilter({ philosophy, weedStrategy }, POOL);
  return filterSprayWindowsBySeason(
    events,
    (ms) => new Date(ms).getUTCFullYear(),
    () => filter
  ).filter((e) => e.kind === 'spray-window');
}

describe('#730 calendar spray windows follow Season Setup', () => {
  it('suggests no herbicide window to an organic, no-herbicide farm', () => {
    for (const c of [pumpkin, delicata, corn]) {
      expect(windowsFor(c, 'organic-transitioning', 'cultivate-first')).toEqual([]);
    }
  });

  it('drops herbicide windows on a cultivate-first conventional farm', () => {
    for (const c of [pumpkin, delicata, corn]) {
      expect(windowsFor(c, 'conventional', 'cultivate-first')).toEqual([]);
    }
  });

  it('drops a window whose chemistry no allowed product has', () => {
    expect(windowsFor(pumpkin, 'certified-organic', 'post-emergence-ok')).toEqual([]);
    expect(windowsFor(delicata, 'certified-organic', 'post-emergence-ok')).toEqual([]);
  });

  it('keeps the windows on a conventional post-emergence farm', () => {
    expect(windowsFor(pumpkin, 'conventional', 'post-emergence-ok')).toHaveLength(1);
    expect(windowsFor(delicata, 'conventional', 'post-emergence-ok')).toHaveLength(1);
    expect(windowsFor(corn, 'conventional', 'post-emergence-ok')).toHaveLength(2);
  });

  it('keeps post-emergent windows from a pre-emergence-only farm', () => {
    expect(windowsFor(pumpkin, 'conventional', 'pre-emergence-ok')).toEqual([]);
  });

  it('leaves events alone for a season with no setup', () => {
    const events = eventsForPlanting(
      {
        id: 'p',
        blockId: 'b',
        cropPluginId: 'pumpkin',
        varietyDisplayName: 'Pumpkin',
        plantingDate: PLANT
      },
      pumpkin
    );
    expect(
      filterSprayWindowsBySeason(
        events,
        () => 2027,
        () => null
      )
    ).toEqual(events);
  });

  it('only ever removes spray windows', () => {
    const philosophies: Philosophy[] = [
      'conventional',
      'no-till',
      'non-gmo',
      'organic-transitioning',
      'certified-organic'
    ];
    const weeds: WeedStrategy[] = ['cultivate-first', 'pre-emergence-ok', 'post-emergence-ok'];
    fc.assert(
      fc.property(
        fc.constantFrom(...philosophies),
        fc.constantFrom(...weeds),
        fc.constantFrom(pumpkin, delicata, corn),
        (philosophy, weed, c) => {
          const events = eventsForPlanting(
            {
              id: 'p',
              blockId: 'b',
              cropPluginId: c.pluginId,
              varietyDisplayName: 'x',
              plantingDate: PLANT
            },
            c
          );
          const filter = buildSeasonSprayFilter({ philosophy, weedStrategy: weed }, POOL);
          const out = filterSprayWindowsBySeason(
            events,
            () => 2027,
            () => filter
          );
          const others = events.filter((e) => e.kind !== 'spray-window');
          expect(out.filter((e) => e.kind !== 'spray-window')).toEqual(others);
          if (weed === 'cultivate-first') {
            expect(out.some((e) => e.kind === 'spray-window')).toBe(false);
          }
        }
      )
    );
  });
});

describe('effectiveWeedGate', () => {
  it('derives the gate from the purpose when the plugin sets none', () => {
    expect(effectiveWeedGate({ purpose: 'post-emergent' })).toBe('post-emergence-ok');
    expect(effectiveWeedGate({ purpose: 'pre-emergent' })).toBe('pre-emergence-ok');
    expect(effectiveWeedGate({ purpose: 'fungicide' })).toBeUndefined();
  });

  it('never loosens the purpose with a looser plugin gate', () => {
    expect(
      effectiveWeedGate({ purpose: 'post-emergent', weedStrategyGate: 'cultivate-first' })
    ).toBe('post-emergence-ok');
  });

  it('refuses a window with no chemistry where only some products are allowed', () => {
    const filter = buildSeasonSprayFilter(
      { philosophy: 'non-gmo', weedStrategy: 'post-emergence-ok' },
      POOL
    );
    expect(herbicideWindowAllowed({ purpose: 'post-emergent' }, filter)).toBe(false);
  });
});
