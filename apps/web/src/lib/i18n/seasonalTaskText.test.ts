// @vitest-environment node
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPluginsFromDirectory } from '$lib/plugins/loader';
import { PluginRegistry } from '$lib/plugins/registry';
import { calendarEventBody, calendarEventTitle } from '$lib/calendar/eventTitle';
import { taskDisplayBody, taskDisplayTitle } from '$lib/tasks/title';
import { en } from './catalogs/en';
import { es } from './catalogs/es';
import {
  RETIRED_SEASONAL_KEYS,
  seasonalMessageKey,
  seasonalRowText,
  seasonalTextByEnglish,
  seasonalTitleWithCrop,
  shippedSeasonalText
} from './seasonalTaskText';

const PLUGINS_DIR = path.resolve(__dirname, '../../../../../plugins');

let library: PluginRegistry;
beforeAll(async () => {
  library = new PluginRegistry();
  await loadPluginsFromDirectory(library, PLUGINS_DIR);
});

const EN = en as Record<string, string>;
const ES = es as Record<string, string | undefined>;
const seasonalKeys = () => Object.keys(EN).filter((k) => k.startsWith('seasonal.'));

describe('seasonal row catalog (OP-21)', () => {
  it('holds the shipped English of every seasonal row, and nothing else', () => {
    const expected = new Map<string, string>();
    for (const c of library.crops()) {
      const rows = c.seasonalTasks ?? [];
      const keys = rows.map((r) => r.key);
      expect(new Set(keys).size, c.pluginId).toBe(keys.length);
      for (const r of rows) {
        expected.set(seasonalMessageKey(c.pluginId, r.key, 'title'), r.title);
        if (r.body) expected.set(seasonalMessageKey(c.pluginId, r.key, 'body'), r.body);
      }
    }
    expect(expected.size).toBeGreaterThan(20);
    for (const k of RETIRED_SEASONAL_KEYS) expected.set(k, EN[k]);
    const actual = new Map(seasonalKeys().map((k) => [k, EN[k]]));
    expect(actual).toEqual(expected);
  });

  it('has a Spanish value for every row, and one Spanish text per English text', () => {
    const spanishFor = new Map<string, string>();
    for (const k of seasonalKeys()) {
      const value = ES[k];
      expect(value, k).toBeTruthy();
      expect(value, k).not.toBe(EN[k]);
      const seen = spanishFor.get(EN[k]);
      if (seen !== undefined) expect(value, k).toBe(seen);
      else spanishFor.set(EN[k], value!);
    }
  });

  it('keeps every number of the English in the Spanish', () => {
    const numbers = (s: string) => (s.match(/\d+/g) ?? []).sort();
    for (const k of seasonalKeys()) expect(numbers(ES[k]!), k).toEqual(numbers(EN[k]));
  });
});

const TITLE = shippedSeasonalText('strawberry-jewel', 'frost-watch', 'title')!;
const BODY = shippedSeasonalText('strawberry-jewel', 'frost-watch', 'body')!;
const ES_TITLE = ES[seasonalMessageKey('strawberry-jewel', 'frost-watch', 'title')]!;
const ES_BODY = ES[seasonalMessageKey('strawberry-jewel', 'frost-watch', 'body')]!;

describe('seasonalRowText', () => {
  it('shows Spanish only while the text is the shipped English', () => {
    expect(seasonalRowText('strawberry-jewel', 'frost-watch', 'title', TITLE, 'es')).toBe(ES_TITLE);
    expect(seasonalRowText('strawberry-jewel', 'frost-watch', 'body', BODY, 'es')).toBe(ES_BODY);
    expect(
      seasonalRowText('strawberry-jewel', 'frost-watch', 'title', 'My frost check', 'es')
    ).toBe('My frost check');
  });

  it('returns the English unchanged without a locale or in English', () => {
    expect(seasonalRowText('strawberry-jewel', 'frost-watch', 'title', TITLE, null)).toBe(TITLE);
    expect(seasonalRowText('strawberry-jewel', 'frost-watch', 'title', TITLE, 'en')).toBe(TITLE);
  });

  it('leaves unknown plugins and rows alone', () => {
    expect(seasonalRowText('farm-copy', 'frost-watch', 'title', TITLE, 'es')).toBe(TITLE);
    expect(seasonalRowText('strawberry-jewel', null, 'title', TITLE, 'es')).toBe(TITLE);
  });

  it('matches text alone for keyless rows', () => {
    expect(seasonalTextByEnglish(BODY, 'es')).toBe(ES_BODY);
    expect(seasonalTextByEnglish('Something else', 'es')).toBe('Something else');
    expect(seasonalTitleWithCrop(`${TITLE} — Jewel`, 'es')).toBe(`${ES_TITLE} — Jewel`);
    expect(seasonalTitleWithCrop(`Edited — Jewel`, 'es')).toBe('Edited — Jewel');
  });
});

describe('tasks and calendar events', () => {
  it('translates a materialized seasonal task while its text is the shipped English', () => {
    const task = {
      title: TITLE,
      body: BODY,
      pluginTemplateKey: 'crop:strawberry-jewel:seasonal:frost-watch'
    };
    expect(taskDisplayTitle(task, 'es')).toBe(ES_TITLE);
    expect(taskDisplayBody(task, 'es')).toBe(ES_BODY);
    expect(taskDisplayTitle(task, 'en')).toBe(TITLE);
    expect(taskDisplayBody({ ...task, body: 'Mine' }, 'es')).toBe('Mine');
    expect(
      taskDisplayTitle({ ...task, pluginTemplateKey: 'crop:x:seasonal:frost-watch' }, 'es')
    ).toBe(TITLE);
  });

  it('translates a task scheduled from a seasonal suggestion', () => {
    const task = {
      title: `${TITLE} — Jewel`,
      body: BODY,
      pluginTemplateKey: 'derived:seasonal-task:blk_1:1700000000000'
    };
    expect(taskDisplayTitle(task, 'es')).toBe(`${ES_TITLE} — Jewel`);
    expect(taskDisplayBody(task, 'es')).toBe(ES_BODY);
    expect(taskDisplayBody({ ...task, pluginTemplateKey: 'derived:scout:x:1' }, 'es')).toBe(BODY);
  });

  it('translates a seasonal calendar event', () => {
    const e = {
      title: `${TITLE} — Jewel`,
      body: BODY,
      cropPluginId: 'strawberry-jewel',
      varietyDisplayName: 'Jewel',
      detail: { taskKey: 'frost-watch', year: 2026 }
    };
    expect(calendarEventTitle(e, 'es')).toBe(`${ES_TITLE} — Jewel`);
    expect(calendarEventBody(e, 'es')).toBe(ES_BODY);
    expect(calendarEventTitle(e, 'en')).toBe(e.title);
    expect(calendarEventBody({ ...e, body: 'Farm note' }, 'es')).toBe('Farm note');
  });
});
