import { json, type RequestHandler } from '@sveltejs/kit';
import { listAnimals, type AnimalListStatus } from '$lib/db/animals';
import { getField } from '$lib/db/fields';
import { animalCreateSchema } from '$lib/animals/apiSchemas';
import { requireOwner } from '$lib/server/auth';
import { assertAnimalSubject, rejectForeignRefs } from '$lib/server/foreignRefs';
import { createAnimalWithHousing, getSpecies, parseBody, ruleResponse } from '$lib/server/animals';
import { getAnimalGroupSummary } from '$lib/db/animalGroups';
import { farmTimeZone } from '$lib/db/userProfile';
import { grazingPlacementGate } from '$lib/server/grazingGate';
import { guardedHoldWrite } from '$lib/server/holdGuard';

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
  const group = input.groupId ? getAnimalGroupSummary(input.groupId) : undefined;
  const now = Date.now();
  const gate = await grazingPlacementGate(
    {
      fieldId: group ? group.housingFieldId : (input.housingFieldId ?? null),
      speciesId: species.pluginId,
      sex: input.sex ?? null,
      foodProducing: species.foodProducingDefault || (group?.effectiveFoodProducing ?? false),
      kind: 'animal'
    },
    user.role,
    farmTimeZone(),
    now
  );
  if (!gate.ok) return json(gate.body, { status: gate.status });
  try {
    const { animal, warnings } = await guardedHoldWrite(event, user, () =>
      createAnimalWithHousing(input, species, user.id, now, {
        rulesVersion: gate.rulesVersion ?? null,
        exposureFloor: gate.exposureFloor ?? null
      })
    );
    return json({ animal, warnings, grazingWarnings: gate.warnings }, { status: 201 });
  } catch (e) {
    return ruleResponse(e);
  }
};
