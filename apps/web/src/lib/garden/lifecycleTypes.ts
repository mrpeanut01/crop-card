/** What a herb is on this farm (Phase 37B). `lifecycleHere()` in
 *  `lifecycleHere.ts` (37B) returns a `LifecycleVerdict`. */
export const LIFECYCLE_HERE = [
  'perennial-here',
  'tender-perennial',
  'annual',
  'biennial',
  'unknown'
] as const;
export type LifecycleHere = (typeof LIFECYCLE_HERE)[number];

export interface LifecycleVerdict {
  lifecycle: LifecycleHere;
  provenance: 'plugin' | 'manual' | 'fallback';
  /** The farm zone came from the wide lookup and equals the crop's zone. */
  nearLimit?: boolean;
  /** CO-8: a perennial with no sourced zone; whether it survives winter
   *  here is not known, so it gets the bring-indoors reminder. */
  winterUnknown?: boolean;
}
