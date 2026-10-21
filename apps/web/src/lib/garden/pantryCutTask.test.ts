import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { t } from '$lib/i18n';
import {
  isPantryCutKey,
  pantryCutBodyIn,
  pantryCutTaskText,
  pantryCutTemplateKey,
  pantryCutTitleIn
} from './pantryCutTask';
import { taskDisplayBody, taskDisplayTitle } from '$lib/tasks/title';

const KEY = pantryCutTemplateKey('p1', '2026-07-06');
const BODY = 'The next cut for your pantry, from your harvest plan.';

describe('pantry cut task (#868)', () => {
  it('saves English text under a derived:pantry-cut key', () => {
    expect(KEY).toBe('derived:pantry-cut:p1:2026-07-06');
    expect(isPantryCutKey(KEY)).toBe(true);
    expect(isPantryCutKey('derived:restart:p1')).toBe(false);
    expect(isPantryCutKey(null)).toBe(false);
    expect(pantryCutTaskText('Basil — Genovese')).toEqual({
      title: 'Cut Basil — Genovese',
      body: BODY
    });
  });

  it('reads any English title back in Spanish, and English unchanged', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => !/[\n\r\u2028\u2029]/.test(s)),
        (typed) => {
          const crop = `My ${typed}`;
          const { title, body } = pantryCutTaskText(crop);
          expect(pantryCutTitleIn(title, 'en')).toBe(title);
          expect(pantryCutTitleIn(title, null)).toBe(title);
          expect(pantryCutTitleIn(title, 'es')).toBe(`Cortar ${crop}`);
          expect(pantryCutBodyIn(body, 'en')).toBe(body);
          expect(pantryCutBodyIn(body, 'es')).toBe(t('es', 'herbsc.task.body'));
        }
      )
    );
  });

  it('translates the plugin crop name and the stored notes', () => {
    const task = { title: 'Cut Basil — Genovese', body: BODY, pluginTemplateKey: KEY };
    expect(taskDisplayTitle(task, 'es')).toBe('Cortar Albahaca Genovese');
    expect(taskDisplayBody(task, 'es')).toBe(t('es', 'herbsc.task.body'));
    expect(taskDisplayTitle(task, 'en')).toBe(task.title);
    expect(taskDisplayBody(task, 'en')).toBe(BODY);
  });

  it('leaves an edited title or note as saved', () => {
    const task = { title: 'Trim basil hard', body: 'my note', pluginTemplateKey: KEY };
    expect(taskDisplayTitle(task, 'es')).toBe('Trim basil hard');
    expect(taskDisplayBody(task, 'es')).toBe('my note');
    expect(taskDisplayTitle({ title: 'Cortar Albahaca', pluginTemplateKey: KEY }, 'en')).toBe(
      'Cortar Albahaca'
    );
  });

  it('only on pantry cut keys', () => {
    const task = {
      title: 'Cut Basil — Genovese',
      body: BODY,
      pluginTemplateKey: 'derived:other:x'
    };
    expect(taskDisplayTitle(task, 'es')).toBe(task.title);
    expect(taskDisplayBody(task, 'es')).toBe(BODY);
  });
});
