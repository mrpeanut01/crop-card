/** Loader pieces shared by `/animals/[id]/health` and `/animals/[id]/log`.
 *  The id is an animal's or a group's; both pages work for either. */

import { error, type RequestEvent } from '@sveltejs/kit';
import { getAnimal } from '$lib/db/animals';
import { getAnimalGroup } from '$lib/db/animalGroups';
import { prefsFor } from '$lib/db/userProfile';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { resolveSubject } from '$lib/server/animalRecords';
import { pageHoldsFor } from '$lib/server/animalFoodGate';
import { getDataKinds } from '$lib/server/registry';
import { DEFAULT_PREFS } from '$lib/prefs';
import type { AnimalSubjectType } from './model';
import { animalLabel } from './display';
import type { HoldSummaries } from './holdCopy';
import type { Food } from '$lib/safety/animalWithdrawal';

export interface RecordSubject {
  type: AnimalSubjectType;
  id: string;
  name: string;
  speciesId: string;
  speciesName: string;
  foodProducing: boolean;
  detailHref: string;
}

export interface RecordPageBase {
  subject: RecordSubject;
  holds: HoldSummaries | null;
  /** Foods this subject gives. Empty for a pet: no hold UI at all. */
  foods: Food[];
  timeZone: string;
  isOwner: boolean;
  canLog: boolean;
}

export async function loadRecordPageBase(event: RequestEvent): Promise<RecordPageBase> {
  const id = event.params.id ?? '';
  const type: AnimalSubjectType | null = getAnimal(id)
    ? 'animal'
    : getAnimalGroup(id)
      ? 'group'
      : null;
  if (!type) throw error(404, 'Animal not found');
  const resolved = resolveSubject(type, id);
  if (!resolved) throw error(404, 'Animal not found');
  const user = currentUser(event);
  const timeZone = user ? prefsFor(user.id).timeZone : DEFAULT_PREFS.timeZone;
  const species = (await getDataKinds()).species.get(resolved.speciesId);
  const page = await pageHoldsFor(type, id, timeZone);
  return {
    subject: {
      type,
      id,
      name: resolved.animal ? animalLabel(resolved.animal) : resolved.name,
      speciesId: resolved.speciesId,
      speciesName: species?.displayName ?? 'Animal',
      foodProducing: resolved.foodProducing,
      detailHref: type === 'animal' ? `/animals/${id}` : `/animals/groups/${id}`
    },
    holds: page?.holds ?? null,
    foods: page?.foods ?? [],
    timeZone,
    isOwner: user?.role === 'owner',
    canLog: !!user && canMutate(user.role)
  };
}
