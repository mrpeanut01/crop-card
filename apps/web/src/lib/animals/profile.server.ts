import { hasAnyAnimalRecord } from '$lib/db/animals';
import { getSetting } from '$lib/db/settings';
import { FARM_PROFILE_KEY, parseFarmProfile } from '$lib/onboarding/profile';
import {
  FARM_ANIMALS_KEY,
  animalsLayout,
  animalsTitle,
  parseFarmAnimals,
  showsAnimalsNav,
  type AnimalsLayout,
  type FarmAnimalChoice
} from './profile';

export interface AnimalsProfile {
  layout: AnimalsLayout;
  title: string;
  choices: FarmAnimalChoice[];
}

export function loadAnimalsProfile(): AnimalsProfile {
  const choices = parseFarmAnimals(getSetting(FARM_ANIMALS_KEY));
  const layout = animalsLayout(parseFarmProfile(getSetting(FARM_PROFILE_KEY)), choices);
  return { layout, title: animalsTitle(layout), choices };
}

/** Any animal or group on the farm, archived included. */
export function farmHasAnimals(): boolean {
  return hasAnyAnimalRecord();
}

/** The nav entry's label, or null when the farm has no animals to show.
 *  Crop-only farms pay one settings read and one existence check. */
export function animalsNavLabel(): string | null {
  const choices = parseFarmAnimals(getSetting(FARM_ANIMALS_KEY));
  if (!showsAnimalsNav(choices, false) && !hasAnyAnimalRecord()) return null;
  const layout = animalsLayout(parseFarmProfile(getSetting(FARM_PROFILE_KEY)), choices);
  return animalsTitle(layout);
}
