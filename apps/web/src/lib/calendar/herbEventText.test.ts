import { describe, expect, it } from 'vitest';
import { calendarEventBody, calendarEventTitle } from './eventTitle';
import { herbEventBody, herbEventTitle } from './herbEvents';
import { taskDisplayBody, taskDisplayTitle } from '$lib/tasks/title';
import { isTypicalTimingTask } from '$lib/schedule/typicalTiming';
import { suggestionTemplateKey } from '$lib/today/calendar';
import { cropDisplayName, cropDisplayNameByEnglish } from '$lib/i18n/cropName';
import { t } from '$lib/i18n';

const bring = {
  kind: 'bring-indoors' as const,
  blockId: 'b1',
  cropPluginId: 'rosemary-tuscan-blue',
  varietyDisplayName: 'Rosemary',
  startMs: Date.UTC(2026, 9, 1),
  endMs: Date.UTC(2026, 9, 15),
  title: herbEventTitle('bring-indoors', 'Rosemary'),
  body: herbEventBody('bring-indoors'),
  detail: { herbEvent: 'bring-indoors', provenance: 'data' }
};

describe('herb event text in the viewer language', () => {
  it('English stays byte-identical', () => {
    expect(calendarEventTitle(bring)).toBe('Bring Rosemary indoors or take cuttings');
    expect(calendarEventTitle(bring, 'en')).toBe(bring.title);
    expect(calendarEventBody(bring, 'en')).toBe(bring.body);
  });

  it('Spanish rebuilds the title with the crop name and translates the body', () => {
    const name = cropDisplayName('rosemary-tuscan-blue', 'Rosemary', 'es');
    expect(calendarEventTitle(bring, 'es')).toBe(
      t('es', 'herbsd.event.bringIndoors.title', { name })
    );
    expect(calendarEventBody(bring, 'es')).toBe(t('es', 'herbsd.event.bringIndoors.body'));
  });

  it('a task scheduled from the suggestion reads in Spanish; only restart is typical timing', () => {
    const task = {
      title: bring.title,
      body: bring.body,
      pluginTemplateKey: suggestionTemplateKey(bring)
    };
    expect(task.pluginTemplateKey.startsWith('derived:bring-indoors:')).toBe(true);
    expect(isTypicalTimingTask(task)).toBe(false);
    expect(taskDisplayTitle(task)).toBe(bring.title);
    expect(taskDisplayTitle(task, 'es')).toBe(
      t('es', 'herbsd.event.bringIndoors.title', {
        name: cropDisplayNameByEnglish('Rosemary', 'es')
      })
    );
    expect(taskDisplayBody(task, 'es')).toBe(t('es', 'herbsd.event.bringIndoors.body'));
    const restart = {
      title: herbEventTitle('restart', 'Chervil'),
      body: 'My own note',
      pluginTemplateKey: 'derived:restart:b1:1'
    };
    expect(taskDisplayTitle(restart, 'es')).toBe(
      t('es', 'herbsd.event.restart.title', { name: cropDisplayNameByEnglish('Chervil', 'es') })
    );
    expect(taskDisplayBody(restart, 'es')).toBe('My own note');
    expect(isTypicalTimingTask(restart)).toBe(true);
    expect(taskDisplayTitle({ ...restart, title: 'Typed by the owner' }, 'es')).toBe(
      'Typed by the owner'
    );
  });
});
