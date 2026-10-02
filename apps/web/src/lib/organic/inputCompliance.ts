/**
 * How the plugin library marks an input for organic use (33B, B-17, O-04).
 * One reader of `complianceFlags` shared by organic records, the organic
 * input notice and `philosophyFilter`, so they can never disagree.
 * Client-safe.
 *
 * - `not-allowed`: the library says `certifiedOrganicAllowed: false`.
 * - `allowed`: `certifiedOrganicAllowed: true` or `omriListed: true`.
 * - `not-marked`: anything else, including a product with no plugin. Never
 *   shown as "prohibited".
 *
 * `transitioningAllowed`, `nonGmoCompliant` and the fertilizer `organic`
 * flag (organic source, not NOP-allowed) are never read here.
 */

export interface OrganicComplianceFlags {
  omriListed?: boolean;
  certifiedOrganicAllowed?: boolean;
  transitioningAllowed?: boolean;
  nonGmoCompliant?: boolean;
  notes?: string;
}

export type OrganicInputClass = 'allowed' | 'not-allowed' | 'not-marked';

export function organicInputClass(
  plugin: { type: string; complianceFlags?: OrganicComplianceFlags } | null | undefined
): OrganicInputClass {
  const flags = plugin?.complianceFlags;
  if (!flags) return 'not-marked';
  if (flags.certifiedOrganicAllowed === false) return 'not-allowed';
  if (flags.certifiedOrganicAllowed === true || flags.omriListed === true) return 'allowed';
  return 'not-marked';
}

/** B-19: every place the class shows says it is the library's mark. */
export const ORGANIC_INPUT_CLASS_LABEL: Readonly<Record<OrganicInputClass, string>> = {
  allowed: 'Library mark: allowed for organic use',
  'not-allowed': 'Library mark: not allowed for organic use',
  'not-marked': 'Library mark: not marked either way'
};

/** The raw flags as stored, for exports (B-46). */
export function complianceFlagsText(flags: OrganicComplianceFlags | undefined): string {
  if (!flags) return '';
  return (
    ['omriListed', 'certifiedOrganicAllowed', 'transitioningAllowed', 'nonGmoCompliant'] as const
  )
    .filter((k) => flags[k] !== undefined)
    .map((k) => `${k}=${String(flags[k])}`)
    .join('; ');
}
