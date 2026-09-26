/**
 * How loudly the pesticide record-keeping (VDACS) material is presented
 * (Phase 30 decision, 2026-09-26). Display only: the lock window, retention,
 * owner-only deletes, exports and every spray-flow check never read this.
 * A garden household that has never recorded a pesticide gets it folded
 * into one disclosure; the first herbicide, insecticide or fungicide record
 * brings the full tier back, and farm, mixed or unknown profiles always get
 * it.
 */

import type { FarmProfile } from '$lib/onboarding/profile';

export type ComplianceChromeLevel = 'quiet' | 'full';

export interface PesticideRecordCounts {
  sprays: number;
  insecticides: number;
  fungicides: number;
}

export function complianceChromeLevel(
  profile: FarmProfile | null,
  counts: PesticideRecordCounts
): ComplianceChromeLevel {
  if (profile !== 'garden') return 'full';
  const total = counts.sprays + counts.insecticides + counts.fungicides;
  return total === 0 ? 'quiet' : 'full';
}
