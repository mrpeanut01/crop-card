/**
 * First-run wizard state for the active Owner. Progress is derived from live
 * data wherever a real record proves the step is done; the two per-Owner
 * settings below cover what data can't show (a farm that runs no implements,
 * and whether a brand-new Owner still owes the wizard a visit).
 */

import { getSetting, setSetting } from '$lib/db/settings';
import { listBlocks } from '$lib/db/blocks';
import { listCrops } from '$lib/db/crops';
import { listEquipment } from '$lib/db/equipment';
import { hasFarmLatLon } from '$lib/schedule/settings';
import { loadSeasonSetup } from '$lib/season/setup.server';
import type { OnboardingProgress } from './steps';

const STATUS_KEY = 'onboarding_status';
const IMPLEMENTS_KEY = 'onboarding_implements_confirmed';

/**
 * `in-progress` is written when onboarding creates the farm and sends the
 * owner back to the wizard from /today until they finish or choose "later".
 * Farms created before the wizard existed have no status and are left alone.
 */
export type OnboardingStatus = 'in-progress' | 'later' | 'complete';

export function getOnboardingStatus(): OnboardingStatus | null {
  const v = getSetting(STATUS_KEY);
  return v === 'in-progress' || v === 'later' || v === 'complete' ? v : null;
}

export function setOnboardingStatus(status: OnboardingStatus): void {
  setSetting(STATUS_KEY, status);
}

export function confirmImplements(): void {
  setSetting(IMPLEMENTS_KEY, '1');
}

export function loadOnboardingProgress(year: number): OnboardingProgress {
  return {
    farm: true,
    location: hasFarmLatLon(),
    fields: listBlocks().length > 0,
    implements: getSetting(IMPLEMENTS_KEY) === '1' || listEquipment().length > 0,
    season: loadSeasonSetup(year) !== null,
    plan: listCrops({ limit: 1 }).length > 0
  };
}
