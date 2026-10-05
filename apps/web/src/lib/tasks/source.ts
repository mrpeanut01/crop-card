import { t, type TranslateKey } from '$lib/i18n';

const SOURCE_KEYS: [prefix: string, key: TranslateKey][] = [
  ['crop:', 'planui.sched.srcCrop'],
  ['equipment:', 'planui.sched.srcEquipment'],
  ['seedstart:', 'planui.sched.srcSeedStart'],
  ['care:', 'planui.sched.srcCare'],
  ['companion-check:', 'planui.sched.srcCompanion'],
  ['derived:', 'planui.sched.srcSuggestion']
];

/** Where a task came from, as a short label instead of its raw template key. */
export function taskSourceLabel(
  pluginTemplateKey: string | null | undefined,
  locale?: string | null
): string {
  if (!pluginTemplateKey) return t(locale, 'planui.shell.manual');
  const hit = SOURCE_KEYS.find(([prefix]) => pluginTemplateKey.startsWith(prefix));
  return t(locale, hit?.[1] ?? 'planui.sched.srcTemplate');
}
