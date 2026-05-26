/**
 * Cover-crop N credit lookup (Phase 21b follow-on, regression #228).
 *
 * When `seasonSetup.fertilityApproach === 'cover-crop-credits'`, the prior
 * cover legume's biological N-fixation discount must come off the cash
 * crop's pre-plant N deficit. Without this, vetch → corn still recommends
 * the full 150 lb-N/ac removal target, which defeats the whole purpose of
 * picking the credits-based approach.
 *
 * Values are conservative small-plot rates from UMD Extension + Penn State
 * Agronomy Guide guidance. Sources prefer the *low end* of published ranges
 * because farmer-scale termination timing rarely hits ideal bloom-stage
 * incorporation.
 */

import type { CoverCropIntent } from '$lib/season/setup';

const COVER_LEGUME_N_CREDIT_LB_PER_AC: Record<CoverCropIntent, number> = {
  // Winter rye / oats / cereal grasses — non-legume; no biological fixation.
  'fall-cereal': 0,
  // Hairy vetch + crimson clover are the dominant small-plot N-fixers.
  // UMD Extension publishes 60–100 lb-N/ac; conservative 65 lb-N/ac matches
  // realistic termination at mid-bloom rather than full-bloom.
  'vetch-clover': 65,
  // Unknown mix — be conservative; operator can manually credit if known.
  other: 0,
  none: 0
};

export function coverCropNCreditLbPerAcre(intent: CoverCropIntent): number {
  return COVER_LEGUME_N_CREDIT_LB_PER_AC[intent] ?? 0;
}

export function coverCropCreditRationale(intent: CoverCropIntent): string | null {
  const credit = coverCropNCreditLbPerAcre(intent);
  if (credit <= 0) return null;
  return `Cover-crop N credit: ${credit} lb-N/ac (${intent})`;
}
