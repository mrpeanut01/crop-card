import { t } from '$lib/i18n';
import {
  seasonalRowText,
  seasonalTextByEnglish,
  seasonalTitleWithCrop
} from '$lib/i18n/seasonalTaskText';
import { seedStartStepOf } from '$lib/schedule/seedStart';
import { orchardScoutTitleIn } from '$lib/orchard/appLines';
import { parseScoutTaskKey } from '$lib/orchard/calendar';
import { isPlantingTaskKey, plantingTaskDisplayTitle } from './plantingTask';

const SOW = /^Sow (.+) indoors$/;
const HARDEN = /^Start hardening off (.+)$/;
const TRANSPLANT = /^Transplant (.+?) to (.+)$/;
const SEASONAL_KEY = /^crop:([^:]+):seasonal:(.+)$/;
const DERIVED_SEASONAL = /^derived:(seasonal-task|orchard-task):/;

type TaskText = { title: string; body?: string | null; pluginTemplateKey?: string | null };

/**
 * A task's title in the viewer's language. Titles are stored in English;
 * the seed-start steps carry a `seedstart:` template key, so their title is
 * rebuilt from the crop and bed names it was written with. A crop seasonal
 * row (OP-21) shows in the viewer's language while the stored title is still
 * the row's shipped English. Every other title (equipment templates, typed
 * or edited titles) comes back as saved.
 */
export function taskDisplayTitle(task: TaskText, locale?: string | null): string {
  if (!locale || locale === 'en') return task.title;
  const step = seedStartStepOf(task.pluginTemplateKey);
  if (step === 'sow') {
    const m = SOW.exec(task.title);
    if (m) return t(locale, 'tasks.seedStart.sow', { crop: m[1] });
  } else if (step === 'harden') {
    const m = HARDEN.exec(task.title);
    if (m) return t(locale, 'tasks.seedStart.harden', { crop: m[1] });
  } else if (step === 'transplant') {
    const m = TRANSPLANT.exec(task.title);
    if (m) return t(locale, 'tasks.seedStart.transplant', { crop: m[1], bed: m[2] });
  }
  const key = task.pluginTemplateKey ?? '';
  if (isPlantingTaskKey(key)) return plantingTaskDisplayTitle(task.title, locale) ?? task.title;
  const row = SEASONAL_KEY.exec(key);
  if (row) return seasonalRowText(row[1], row[2], 'title', task.title, locale);
  if (DERIVED_SEASONAL.test(key)) return seasonalTitleWithCrop(task.title, locale);
  if (parseScoutTaskKey(key)) return orchardScoutTitleIn(task.title, locale);
  return task.title;
}

/** A task's notes in the viewer's language: a crop seasonal row's body while
 *  it is still the shipped English, anything else as saved. */
export function taskDisplayBody<B extends string | null | undefined>(
  task: { body?: B; pluginTemplateKey?: string | null },
  locale?: string | null
): B {
  const body = task.body;
  if (!locale || locale === 'en' || !body) return body as B;
  const key = task.pluginTemplateKey ?? '';
  const row = SEASONAL_KEY.exec(key);
  if (row) return seasonalRowText(row[1], row[2], 'body', body, locale) as B;
  if (DERIVED_SEASONAL.test(key)) return seasonalTextByEnglish(body, locale) as B;
  return body as B;
}
