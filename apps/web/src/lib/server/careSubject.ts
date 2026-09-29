import { getAnimal } from '$lib/db/animals';
import { getAnimalGroup } from '$lib/db/animalGroups';
import type { AnimalSubjectType } from '$lib/animals/model';

export interface CareRouteSubject {
  subjectType: AnimalSubjectType;
  subjectId: string;
  name: string;
  speciesId: string;
  active: boolean;
}

/** `/api/animals/:id/care-plans` takes an animal id or a group id, like the
 *  health and log pages. Null when neither is on the active farm. */
export function careRouteSubject(id: string | undefined): CareRouteSubject | null {
  if (!id) return null;
  const animal = getAnimal(id);
  if (animal) {
    return {
      subjectType: 'animal',
      subjectId: animal.id,
      name: animal.name ?? (animal.tag ? `Tag ${animal.tag}` : 'This animal'),
      speciesId: animal.speciesId,
      active: animal.status === 'active'
    };
  }
  const group = getAnimalGroup(id);
  if (!group) return null;
  return {
    subjectType: 'group',
    subjectId: group.id,
    name: group.name,
    speciesId: group.speciesId,
    active: group.status === 'active'
  };
}
