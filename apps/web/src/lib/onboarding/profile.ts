/**
 * Farm profile (Phase 30): a per-Owner hint from onboarding screen 2 that
 * tunes which setup items and wording an owner sees. It never switches off
 * records, exports or any safety step.
 */

export const FARM_PROFILES = ['garden', 'farm', 'mixed'] as const;
export type FarmProfile = (typeof FARM_PROFILES)[number];

export const FARM_PROFILE_KEY = 'farm_profile';

export function parseFarmProfile(raw: unknown): FarmProfile | null {
  return typeof raw === 'string' && (FARM_PROFILES as readonly string[]).includes(raw)
    ? (raw as FarmProfile)
    : null;
}

/** Farms that predate the profile are treated as farms, never as gardens. */
export function profileIncludesGarden(profile: FarmProfile | null): boolean {
  return profile === 'garden' || profile === 'mixed';
}

export function profileIncludesFarm(profile: FarmProfile | null): boolean {
  return profile !== 'garden';
}
