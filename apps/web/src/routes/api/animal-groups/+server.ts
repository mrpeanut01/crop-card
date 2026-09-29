import { json, type RequestHandler } from '@sveltejs/kit';
import { listAnimalGroups } from '$lib/db/animalGroups';
import { getField } from '$lib/db/fields';
import { animalGroupCreateSchema } from '$lib/animals/apiSchemas';
import { requireOwner } from '$lib/server/auth';
import { rejectForeignRefs } from '$lib/server/foreignRefs';
import { createGroupWithMembers, getSpecies, parseBody, ruleResponse } from '$lib/server/animals';
import { farmTimeZone } from '$lib/db/userProfile';
import { grazingPlacementGate } from '$lib/server/grazingGate';
import { guardedHoldWrite } from '$lib/server/holdGuard';

const LIST_STATUSES = ['active', 'archived', 'all'] as const;
type ListStatus = (typeof LIST_STATUSES)[number];

export const GET: RequestHandler = ({ url }) => {
  const status = (url.searchParams.get('status') ?? 'active') as ListStatus;
  if (!LIST_STATUSES.includes(status)) return json({ error: 'unknown status' }, { status: 400 });
  return json({
    groups: listAnimalGroups({
      status,
      housingFieldId: url.searchParams.get('fieldId') ?? undefined,
      speciesId: url.searchParams.get('speciesId') ?? undefined
    })
  });
};

export const _requestSchema = animalGroupCreateSchema;

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const body = await parseBody(event.request, animalGroupCreateSchema);
  if (!body.ok) return body.response;
  const input = body.data;
  const foreign = rejectForeignRefs(['housingFieldId', input.housingFieldId, getField]);
  if (foreign) return foreign;
  const species = await getSpecies(input.speciesId);
  if (!species) return json({ error: 'unknown speciesId' }, { status: 400 });
  const now = Date.now();
  const gate = await grazingPlacementGate(
    {
      fieldId: input.housingFieldId ?? null,
      speciesId: species.pluginId,
      foodProducing: species.foodProducingDefault,
      kind: 'group'
    },
    user.role,
    farmTimeZone(),
    now
  );
  if (!gate.ok) return json(gate.body, { status: gate.status });
  try {
    const created = await guardedHoldWrite(event, user, () =>
      createGroupWithMembers(input, species, user.id, now, {
        rulesVersion: gate.rulesVersion ?? null,
        exposureFloor: gate.exposureFloor ?? null
      })
    );
    return json({ ...created, grazingWarnings: gate.warnings }, { status: 201 });
  } catch (e) {
    return ruleResponse(e);
  }
};
