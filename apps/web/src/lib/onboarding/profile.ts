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

/**
 * The animals answer from onboarding screen 2 (Phase 32B, B-15). It lives
 * in its own `farm_animals` setting so every reader of `farm_profile` stays
 * as it is. The value is the picked tiles as a comma list; no setting means
 * the farm predates 32B or picked no animal tile.
 */
export const FARM_ANIMAL_CHOICES = ['animals', 'pets', 'chickens'] as const;
export type FarmAnimalChoice = (typeof FARM_ANIMAL_CHOICES)[number];

export const FARM_ANIMALS_KEY = 'farm_animals';

/** Reads the stored answer: one choice, a comma list or a JSON array.
 *  Unknown values are dropped; the result is in canonical order. */
export function parseFarmAnimals(raw: unknown): FarmAnimalChoice[] {
  let values: unknown[] = [];
  if (Array.isArray(raw)) {
    values = raw;
  } else if (typeof raw === 'string') {
    const text = raw.trim();
    if (text.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(text);
        values = Array.isArray(parsed) ? parsed : [];
      } catch {
        values = [];
      }
    } else {
      values = text.split(',');
    }
  }
  const picked = new Set(values.map((v) => (typeof v === 'string' ? v.trim() : v)));
  return FARM_ANIMAL_CHOICES.filter((c) => picked.has(c));
}

export function serializeFarmAnimals(choices: readonly FarmAnimalChoice[]): string {
  return parseFarmAnimals([...choices]).join(',');
}

/** Animal screens use the simpler "Pets & animals" layout for a garden
 *  household, or when the answer includes Pets but not Animals. It never
 *  hides a safety chip. */
export function usesPetsLayout(
  profile: FarmProfile | null,
  choices: readonly FarmAnimalChoice[]
): boolean {
  if (profile === 'garden') return true;
  return choices.includes('pets') && !choices.includes('animals');
}
