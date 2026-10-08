/**
 * Onboarding and Getting Started state for the active Owner (Phase 30).
 *
 * `onboarding_status`:
 *   - `in-progress`: the farm exists but screen 2 ("What are you growing
 *     on?") is unanswered. /today sends the owner back to /onboarding.
 *   - `later` / `complete`: done. Farms made before Phase 30 carry either of
 *     these or nothing, and are never redirected.
 */

import { deleteSetting, getSetting, setSetting, type SettingReader } from '$lib/db/settings';
import {
  FARM_ANIMALS_KEY,
  FARM_PROFILE_KEY,
  parseFarmAnimals,
  parseFarmProfile,
  serializeFarmAnimals,
  type FarmAnimalChoice,
  type FarmProfile
} from './profile';

export const ONBOARDING_STATUS_KEY = 'onboarding_status';
const STATUS_KEY = ONBOARDING_STATUS_KEY;
export const GETTING_STARTED_DISMISSED_KEY = 'getting_started_dismissed_at';

export type OnboardingStatus = 'in-progress' | 'later' | 'complete';

export function getOnboardingStatus(read: SettingReader = getSetting): OnboardingStatus | null {
  const v = read(STATUS_KEY);
  return v === 'in-progress' || v === 'later' || v === 'complete' ? v : null;
}

export function setOnboardingStatus(status: OnboardingStatus): void {
  setSetting(STATUS_KEY, status);
}

export function getFarmProfile(read: SettingReader = getSetting): FarmProfile | null {
  return parseFarmProfile(read(FARM_PROFILE_KEY));
}

export function setFarmProfile(profile: FarmProfile): void {
  setSetting(FARM_PROFILE_KEY, profile);
}

/** The animal tiles the owner picked; empty when none or never asked. */
export function getFarmAnimals(read: SettingReader = getSetting): FarmAnimalChoice[] {
  return parseFarmAnimals(read(FARM_ANIMALS_KEY));
}

export function setFarmAnimals(choices: readonly FarmAnimalChoice[]): void {
  const value = serializeFarmAnimals(choices);
  if (value) setSetting(FARM_ANIMALS_KEY, value);
  else deleteSetting(FARM_ANIMALS_KEY);
}

export function getGettingStartedDismissedAt(read: SettingReader = getSetting): number | null {
  const n = Number(read(GETTING_STARTED_DISMISSED_KEY));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function dismissGettingStarted(now: number = Date.now()): void {
  setSetting(GETTING_STARTED_DISMISSED_KEY, String(now));
}

export function restoreGettingStarted(): void {
  deleteSetting(GETTING_STARTED_DISMISSED_KEY);
}
