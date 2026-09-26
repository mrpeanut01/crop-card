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

/** Printed provenance line: human labels, not enum names. */
export function provenanceText(list: ReadonlyArray<{ source: string; detail?: string }>): string {
  return list
    .map((p) => {
      const label = PROVENANCE_LABEL[p.source as ProvenanceSourceName] ?? p.source;
      return p.detail ? `${label} (${p.detail})` : label;
    })
    .join(' · ');
}
