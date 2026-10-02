import { t, type TranslateKey } from '$lib/i18n';

export type ProvenanceSourceName = 'plugin' | 'data' | 'ai' | 'manual' | 'fallback';

/** Short chip labels shared by the Provenance chip and printed cards. */
export const PROVENANCE_LABEL: Readonly<Record<ProvenanceSourceName, string>> = {
  plugin: 'Plugin',
  data: 'Your data',
  ai: 'AI',
  manual: 'You typed',
  fallback: 'Fallback'
};

export const PROVENANCE_LONG: Readonly<Record<ProvenanceSourceName, string>> = {
  plugin: 'From a crop, input, or safety-kernel plugin',
  data: 'Derived from your records: scout, calibration, prior season',
  ai: 'Claude proposed this · always editable · falls back when off',
  manual: 'Entered or edited by you · the safety kernel still checks it',
  fallback: 'AI was off or unavailable, so the deterministic default was used'
};

const LABEL_KEY: Readonly<Record<ProvenanceSourceName, TranslateKey>> = {
  plugin: 'ui.prov.plugin',
  data: 'ui.prov.data',
  ai: 'ui.prov.ai',
  manual: 'ui.prov.manual',
  fallback: 'ui.prov.fallback'
};

/** A provenance chip label in `locale`; English with none. */
export function provenanceLabel(source: string, locale?: string | null): string {
  const key = LABEL_KEY[source as ProvenanceSourceName];
  if (!key) return source;
  return locale ? t(locale, key) : PROVENANCE_LABEL[source as ProvenanceSourceName];
}

/** Printed provenance line: human labels, not enum names. */
export function provenanceText(
  list: ReadonlyArray<{ source: string; detail?: string }>,
  locale?: string | null
): string {
  return list
    .map((p) => {
      const label = provenanceLabel(p.source, locale);
      return p.detail ? `${label} (${p.detail})` : label;
    })
    .join(' · ');
}
