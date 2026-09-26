/**
 * Onboarding and Getting Started state for the active Owner (Phase 30).
 *
 * `onboarding_status`:
 *   - `in-progress`: the farm exists but screen 2 ("What are you growing
 *     on?") is unanswered. /today sends the owner back to /onboarding.
 *   - `later` / `complete`: done. Farms made before Phase 30 carry either of
 *     these or nothing, and are never redirected.
 */

import { deleteSetting, getSetting, setSetting } from '$lib/db/settings';
import { FARM_PROFILE_KEY, parseFarmProfile, type FarmProfile } from './profile';

const STATUS_KEY = 'onboarding_status';
export const GETTING_STARTED_DISMISSED_KEY = 'getting_started_dismissed_at';

export type OnboardingStatus = 'in-progress' | 'later' | 'complete';

export function getOnboardingStatus(): OnboardingStatus | null {
  const v = getSetting(STATUS_KEY);
  return v === 'in-progress' || v === 'later' || v === 'complete' ? v : null;
}

export function setOnboardingStatus(status: OnboardingStatus): void {
  setSetting(STATUS_KEY, status);
}

export function getFarmProfile(): FarmProfile | null {
  return parseFarmProfile(getSetting(FARM_PROFILE_KEY));
}

export function setFarmProfile(profile: FarmProfile): void {
  setSetting(FARM_PROFILE_KEY, profile);
}

export function getGettingStartedDismissedAt(): number | null {
  const n = Number(getSetting(GETTING_STARTED_DISMISSED_KEY));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function dismissGettingStarted(now: number = Date.now()): void {
  setSetting(GETTING_STARTED_DISMISSED_KEY, String(now));
}

export function restoreGettingStarted(): void {
  deleteSetting(GETTING_STARTED_DISMISSED_KEY);
}
