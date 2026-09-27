/**
 * Which layout `/animals` uses and what it shows (Phase 32B, Q9 + Q13).
 * One set of tables; the pets layout is only wording, ordering and hidden
 * farm fields. Safety chips (food-producing, and the 32C holds) show in
 * every layout.
 *
 * The onboarding answer and its parser live in `$lib/onboarding/profile`.
 */

import {
  FARM_ANIMALS_KEY,
  FARM_ANIMAL_CHOICES,
  parseFarmAnimals,
  usesPetsLayout,
  type FarmAnimalChoice,
  type FarmProfile
} from '$lib/onboarding/profile';
import type { AnimalPurpose } from './model';

export { FARM_ANIMALS_KEY, FARM_ANIMAL_CHOICES, parseFarmAnimals, type FarmAnimalChoice };

export type AnimalsLayout = 'farm' | 'pets';

/** The one pets-layout rule lives in `usesPetsLayout`. */
export function animalsLayout(
  profile: FarmProfile | null,
  choices: readonly FarmAnimalChoice[]
): AnimalsLayout {
  return usesPetsLayout(profile, choices) ? 'pets' : 'farm';
}

export function animalsTitle(layout: AnimalsLayout): string {
  return layout === 'pets' ? 'Pets & animals' : 'Animals';
}

/** Farm-only fields (tag, breed, acquired from, production figures) are
 *  hidden in the pets layout and on any animal kept as a pet. */
export function showsFarmFields(layout: AnimalsLayout, purpose?: AnimalPurpose | null): boolean {
  return layout === 'farm' && purpose !== 'pet';
}

/** The pets layout lists individuals first; the farm layout lists groups. */
export function individualsFirst(layout: AnimalsLayout): boolean {
  return layout === 'pets';
}

/** The nav shows the section once the owner said they keep animals or
 *  once any animal or group exists. Crop-only growers never see it. */
export function showsAnimalsNav(
  choices: readonly FarmAnimalChoice[],
  hasAnimals: boolean
): boolean {
  return choices.length > 0 || hasAnimals;
}

/** Tiles the add form offers first for each choice, so a household that
 *  said "Backyard chickens" lands on chickens. */
export function suggestedSpecies(choices: readonly FarmAnimalChoice[]): string | null {
  if (choices.length === 1 && choices[0] === 'chickens') return 'chicken';
  return null;
}
