import { t, type MessageKey } from '$lib/i18n';

/** The shipped English `hayOperations.mowTrigger` cues and their catalog
 *  keys. A cue a farm copy rewrote is shown as written. */
export const MOW_TRIGGER_KEYS: Readonly<Record<string, MessageKey>> = {
  '1/4 to 1/2 bloom': 'hayui.mowCue.quarterToHalfBloom',
  '10% bloom or 28 d after previous cut': 'hayui.mowCue.tenPctBloomOr28d',
  'boot to early head on the first cut': 'hayui.mowCue.bootToEarlyHead'
};

export function mowTriggerText(english: string, locale?: string | null): string {
  if (!locale || locale === 'en') return english;
  const key = Object.prototype.hasOwnProperty.call(MOW_TRIGGER_KEYS, english)
    ? MOW_TRIGGER_KEYS[english]
    : undefined;
  return key ? t(locale, key) : english;
}
