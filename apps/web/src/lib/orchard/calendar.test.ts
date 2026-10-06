import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { orchardCalendarPluginSchema, orchardCopyProblems } from '$lib/plugins/schemas';
import { ORCHARD_BEE_LINES, beeLineFor, orchardScoutTitle, orchardScoutTitleIn } from './appLines';
import {
  calendarAudienceFor,
  calendarStatusFor,
  lowInputSeason,
  parseScoutTaskKey,
  scoutTaskCategory,
  scoutTaskTemplateKey,
  scoutTitleParts,
  showsLabelLine,
  shownWindows,
  wantsSeasonalCalendar
} from './calendar';

const REPO = path.resolve(__dirname, '../../../../..');
const DIR = path.join(REPO, 'plugins/orchard-calendars');
const calendars = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) =>
    orchardCalendarPluginSchema.parse(JSON.parse(readFileSync(path.join(DIR, f), 'utf8')))
  );
const byId = (id: string) => calendars.find((c) => c.pluginId === id)!;
const SOURCES = JSON.parse(
  readFileSync(path.join(REPO, 'apps/web/scripts/orchard-calendar-sources.json'), 'utf8')
) as { entries: Record<string, { sources: { quote: string }[] }> };

describe('calendarAudienceFor (OP-4)', () => {
  it('follows the ruled order', () => {
    expect(
      calendarAudienceFor({ override: 'commercial', areaKind: 'garden', farmProfile: 'garden' })
    ).toEqual({ audience: 'commercial', reason: 'override', provenance: 'manual' });
    expect(
      calendarAudienceFor({ override: 'home', areaKind: 'orchard', farmProfile: 'farm' })
    ).toEqual({ audience: 'home', reason: 'override', provenance: 'manual' });
    expect(calendarAudienceFor({ areaKind: 'garden', farmProfile: 'farm' }).reason).toBe(
      'garden-area'
    );
    expect(calendarAudienceFor({ areaKind: 'greenhouse', farmProfile: 'farm' }).audience).toBe(
      'home'
    );
    expect(calendarAudienceFor({ areaKind: 'orchard', farmProfile: 'garden' }).reason).toBe(
      'garden-profile'
    );
    expect(calendarAudienceFor({ areaKind: 'orchard', farmProfile: null })).toEqual({
      audience: 'home',
      reason: 'no-profile',
      provenance: 'data'
    });
    expect(calendarAudienceFor({ areaKind: 'orchard', farmProfile: 'mixed' }).audience).toBe(
      'commercial'
    );
    expect(calendarAudienceFor({ areaKind: 'field', farmProfile: 'farm' }).reason).toBe(
      'farm-profile'
    );
  });

  it('an unknown override or profile reads as unset, so falls to home (the safer side)', () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (override, profile) => {
        const choice = calendarAudienceFor({
          override,
          areaKind: 'orchard',
          farmProfile: typeof profile === 'string' ? profile : null
        });
        if (
          override !== 'commercial' &&
          override !== 'home' &&
          profile !== 'farm' &&
          profile !== 'mixed'
        )
          expect(choice.audience).toBe('home');
      })
    );
  });
});

describe('calendar status (OC-6, OP-3, OP-28)', () => {
  it('finds the calendar for the crop and audience', () => {
    expect(calendarStatusFor(calendars, [], 'apple-gala', 'commercial')).toMatchObject({
      kind: 'calendar',
      calendar: { pluginId: 'pome-va-2026' }
    });
    expect(calendarStatusFor(calendars, [], 'apple-gala', 'home')).toMatchObject({
      calendar: { pluginId: 'pome-home-va-2026' }
    });
    expect(calendarStatusFor(calendars, [], 'pear-bosc', 'commercial')).toMatchObject({
      calendar: { pluginId: 'pear-va-2026' }
    });
  });

  it('a household never falls back to the commercial calendar', () => {
    const commercialOnly = calendars.filter((c) => c.audience === 'commercial');
    expect(calendarStatusFor(commercialOnly, [], 'apple-gala', 'home')).toEqual({ kind: 'none' });
  });

  it('a dropped calendar reads out of date and never shows another edition', () => {
    const others = calendars.filter((c) => c.pluginId !== 'pome-va-2026');
    const dropped = [{ audience: 'commercial' as const, hostCropPluginIds: ['apple-gala'] }];
    expect(calendarStatusFor(others, dropped, 'apple-gala', 'commercial')).toEqual({
      kind: 'out-of-date'
    });
    expect(calendarStatusFor(others, dropped, 'apple-gala', 'home').kind).toBe('calendar');
    expect(calendarStatusFor(others, dropped, 'pear-bosc', 'commercial').kind).toBe('calendar');
  });

  it('only tree fruit, grapes and blueberries ask for a calendar', () => {
    expect(wantsSeasonalCalendar({ pluginId: 'fig-celeste', cropFamily: 'orchard' })).toBe(true);
    expect(wantsSeasonalCalendar({ pluginId: 'plum-stanley', cropFamily: 'stone-fruit' })).toBe(
      true
    );
    expect(wantsSeasonalCalendar({ pluginId: 'grape-concord', cropFamily: 'vine-fruit' })).toBe(
      true
    );
    expect(
      wantsSeasonalCalendar({ pluginId: 'blueberry-bluecrop', cropFamily: 'small-fruit' })
    ).toBe(true);
    expect(wantsSeasonalCalendar({ pluginId: 'rootstock-apple-m9', cropFamily: 'orchard' })).toBe(
      false
    );
    expect(
      wantsSeasonalCalendar({ pluginId: 'tomato-yellow-mini-grape', cropFamily: 'solanaceae' })
    ).toBe(false);
    expect(wantsSeasonalCalendar({ pluginId: 'strawberry-jewel', cropFamily: 'small-fruit' })).toBe(
      false
    );
  });
});

describe('windows shown (OC-4, OP-8)', () => {
  it('a low-input season hides commercial risk windows only', () => {
    const pome = byId('pome-va-2026');
    const tight = pome.stages.find((s) => s.id === 'tight-cluster')!;
    const shown = shownWindows(pome, tight, true);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((w) => !['disease-risk', 'pest-risk'].includes(w.purpose))).toBe(true);
    expect(shownWindows(pome, tight, false)).toHaveLength(tight.windows.length);
    const home = byId('pome-home-va-2026');
    for (const s of home.stages) expect(shownWindows(home, s, true)).toHaveLength(s.windows.length);
  });

  it('lowInputSeason reads organic philosophies and a minimal pest strategy', () => {
    expect(lowInputSeason(null)).toBe(false);
    expect(lowInputSeason({ philosophy: 'certified-organic', pestStrategy: 'ipm' })).toBe(true);
    expect(lowInputSeason({ philosophy: 'organic-transitioning' })).toBe(true);
    expect(lowInputSeason({ philosophy: 'conventional', pestStrategy: 'minimal' })).toBe(true);
    expect(lowInputSeason({ philosophy: 'non-gmo', pestStrategy: 'ipm' })).toBe(false);
  });

  it('"Check the label." shows on commercial risk windows only', () => {
    expect(showsLabelLine({ audience: 'commercial' }, { purpose: 'disease-risk' })).toBe(true);
    expect(showsLabelLine({ audience: 'commercial' }, { purpose: 'pest-risk' })).toBe(true);
    expect(showsLabelLine({ audience: 'commercial' }, { purpose: 'scout' })).toBe(false);
    expect(showsLabelLine({ audience: 'home' }, { purpose: 'bloom' })).toBe(false);
  });

  it('every shipped guide has its own bee line, word for word from its source', () => {
    for (const c of calendars) {
      const line = ORCHARD_BEE_LINES[c.guide.publicationId];
      expect(line, c.pluginId).toBeDefined();
      const quotes = SOURCES.entries[line.sourceKey]?.sources.map((s) => s.quote) ?? [];
      expect(quotes, line.sourceKey).toContain(line.text);
      expect(beeLineFor(c.guide.publicationId)).toBe(line.text);
    }
    expect(beeLineFor('unknown')).toMatch(/bees/i);
  });
});

describe('Schedule a scouting task (OC-7)', () => {
  const SPRAY = /spray|insecticid|fungicid|pesticid|bactericid|\bapply|aplica|pulveriz|rociar/i;

  it('titles never say spray or name a product, in English or Spanish', () => {
    const problems: string[] = [];
    for (const c of calendars)
      for (const s of c.stages)
        for (const w of s.windows)
          for (const locale of ['en', 'es']) {
            const title = orchardScoutTitle(c.pluginId, s, w, locale);
            if (SPRAY.test(title)) problems.push(`${c.pluginId}.${w.id} ${locale}: ${title}`);
            for (const r of orchardCopyProblems(title))
              problems.push(`${c.pluginId}.${w.id} ${locale}: ${r}`);
          }
    expect(problems).toEqual([]);
  });

  it('leaves weather out and cuts long target lists', () => {
    expect(
      scoutTitleParts({
        targets: [
          { id: 'a', kind: 'disease' },
          { id: 'w', kind: 'weather' },
          { id: 'b', kind: 'pest' },
          { id: 'c', kind: 'pest' },
          { id: 'd', kind: 'pest' },
          { id: 'e', kind: 'pest' }
        ]
      })
    ).toEqual({ targetIds: ['a', 'b', 'c'], more: 2 });
    const pome = byId('pome-va-2026');
    const pink = pome.stages.find((s) => s.id === 'pink')!;
    expect(orchardScoutTitle(pome.pluginId, pink, { targets: [] })).toBe('Check: Pink');
    expect(
      orchardScoutTitle(pome.pluginId, pink, {
        targets: [
          { id: 'apple-scab', kind: 'disease' },
          { id: 'warm-wet-bloom', kind: 'weather' }
        ]
      })
    ).toBe('Scout: Apple scab');
  });

  it('a stored English title reads in Spanish, and an edited one stays as typed', () => {
    expect(orchardScoutTitleIn('Scout: Apple scab, Fire blight +2', 'es')).toBe(
      'Monitorear: Sarna del manzano, Fuego bacteriano +2'
    );
    expect(orchardScoutTitleIn('Check: Pink', 'es')).toBe('Revisar: Botón rosado');
    expect(orchardScoutTitleIn('Scout: my own words', 'es')).toBe('Scout: my own words');
    expect(orchardScoutTitleIn('Scout: Apple scab', 'en')).toBe('Scout: Apple scab');
  });

  it('category and key', () => {
    expect(scoutTaskCategory({ purpose: 'sanitation' })).toBe('prune');
    expect(scoutTaskCategory({ purpose: 'cultural' })).toBe('prune');
    expect(scoutTaskCategory({ purpose: 'harvest-prep' })).toBe('scout');
    expect(scoutTaskCategory({ purpose: 'pest-risk' })).toBe('scout');
    const key = scoutTaskTemplateKey('pome-va-2026', 'pink-traps', 'b_1', 2026);
    expect(key).toBe('derived:orchard-window:pome-va-2026:pink-traps:b_1:2026');
    expect(parseScoutTaskKey(key)).toEqual({ calendarId: 'pome-va-2026', windowId: 'pink-traps' });
    expect(parseScoutTaskKey('derived:orchard-task:b:1')).toBeNull();
  });
});
