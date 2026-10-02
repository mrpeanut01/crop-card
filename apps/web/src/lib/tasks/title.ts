import { t } from '$lib/i18n';
import { seedStartStepOf } from '$lib/schedule/seedStart';

const SOW = /^Sow (.+) indoors$/;
const HARDEN = /^Start hardening off (.+)$/;
const TRANSPLANT = /^Transplant (.+?) to (.+)$/;

/**
 * A task's title in the viewer's language. Titles are stored in English;
 * the seed-start steps carry a `seedstart:` template key, so their title is
 * rebuilt from the crop and bed names it was written with. Every other
 * title (plugin and equipment templates, typed titles) comes back as saved.
 */
export function taskDisplayTitle(
  task: { title: string; pluginTemplateKey?: string | null },
  locale?: string | null
): string {
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
  return task.title;
}
