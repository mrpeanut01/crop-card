import { json, type RequestHandler } from '@sveltejs/kit';
import { listAnimals, type AnimalListStatus } from '$lib/db/animals';
import { getField } from '$lib/db/fields';
import { animalCreateSchema } from '$lib/animals/apiSchemas';
import { requireOwner } from '$lib/server/auth';
import { assertAnimalSubject, rejectForeignRefs } from '$lib/server/foreignRefs';
import { createAnimalWithHousing, getSpecies, parseBody, ruleResponse } from '$lib/server/animals';

const LIST_STATUSES: readonly AnimalListStatus[] = ['active', 'gone', 'archived', 'all'];

export const GET: RequestHandler = ({ url }) => {
  const status = (url.searchParams.get('status') ?? 'active') as AnimalListStatus;
  if (!LIST_STATUSES.includes(status)) return json({ error: 'unknown status' }, { status: 400 });
  const ungrouped = url.searchParams.get('ungrouped');
  return json({
    animals: listAnimals({
      status,
      groupId: url.searchParams.get('groupId') ?? undefined,
      housingFieldId: url.searchParams.get('fieldId') ?? undefined,
      speciesId: url.searchParams.get('speciesId') ?? undefined,
      ungrouped: ungrouped === '1' ? true : ungrouped === '0' ? false : undefined
    })
  });
};

export const _requestSchema = animalCreateSchema;

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const body = await parseBody(event.request, animalCreateSchema);
  if (!body.ok) return body.response;
  const input = body.data;
  const foreign = rejectForeignRefs(
    ['housingFieldId', input.housingFieldId, getField],
    assertAnimalSubject('groupId', 'group', input.groupId)
  );
  if (foreign) return foreign;
  const species = await getSpecies(input.speciesId);
  if (!species) return json({ error: 'unknown speciesId' }, { status: 400 });
  try {
    const { animal, warnings } = createAnimalWithHousing(input, species, user.id);
    return json({ animal, warnings }, { status: 201 });
  } catch (e) {
    return ruleResponse(e);
  }
};
