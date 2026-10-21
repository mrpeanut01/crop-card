/** The pantry's "Schedule the next cut" task (Phase 37C). Its title and
 *  notes are stored in English, like every other `derived:` task, and shown
 *  in the reader's language by `taskDisplayTitle` / `taskDisplayBody`
 *  (#868). Pure and client-safe. */

import { t } from '$lib/i18n';
import { cropDisplayNameByEnglish } from '$lib/i18n/cropName';

export const PANTRY_CUT_KEY_PREFIX = 'derived:pantry-cut:';

const TITLE = /^Cut (.+)$/;

export function pantryCutTemplateKey(plantingId: string, week: string): string {
  return `${PANTRY_CUT_KEY_PREFIX}${plantingId}:${week}`;
}

export function isPantryCutKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.startsWith(PANTRY_CUT_KEY_PREFIX);
}

/** The English title and notes the task is saved with. `cropName` is the
 *  planting's stored (English or owner-typed) name. */
export function pantryCutTaskText(cropName: string): { title: string; body: string } {
  return {
    title: t(null, 'herbsc.task.title', { crop: cropName }),
    body: t(null, 'herbsc.task.body')
  };
}

/** A stored English pantry cut title in `locale`; any other title, such as
 *  one the owner edited, comes back as saved. */
export function pantryCutTitleIn(title: string, locale?: string | null): string {
  const crop = TITLE.exec(title)?.[1];
  if (crop === undefined) return title;
  return t(locale, 'herbsc.task.title', { crop: cropDisplayNameByEnglish(crop, locale) });
}

export function pantryCutBodyIn(body: string, locale?: string | null): string {
  return body === t(null, 'herbsc.task.body') ? t(locale, 'herbsc.task.body') : body;
}
