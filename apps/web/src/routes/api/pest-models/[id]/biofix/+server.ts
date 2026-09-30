/**
 * PUT /api/pest-models/[id]/biofix  { year, date | null }
 *
 * Records (or clears) the grower's first trap catch for a trap-catch pest
 * model and year. Owners and helpers may; inspectors are read-only. Stored
 * in app settings as `pest_biofix.<modelId>.<year>`. Not gated by the season
 * close-out: it is a planning aid, not a compliance record.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireMutator } from '$lib/server/auth';
import { getDataKinds } from '$lib/server/registry';
import { clearBiofix, setBiofix } from '$lib/db/pestBiofix';
import { farmTimeZone } from '$lib/db/userProfile';
import { biofixPutSchema } from '$lib/ipm/apiSchemas';
import { acceptsManualBiofix } from '$lib/ipm/pestModels';
import { farmYmd } from '$lib/server/degreeDays.server';

export const _requestSchema = biofixPutSchema;

export const PUT: RequestHandler = async (event) => {
  const user = requireMutator(event);
  const model = (await getDataKinds()).pestModels.get(event.params.id ?? '');
  if (!model) return json({ error: 'pest model not found' }, { status: 404 });
  if (!acceptsManualBiofix(model)) {
    return json(
      { error: 'This model counts from a fixed date, not a trap catch.', code: 'BIOFIX_NOT_TRAP' },
      { status: 400 }
    );
  }
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = biofixPutSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }
  const { year, date } = parsed.data;
  if (date === null) {
    clearBiofix(model.pluginId, year);
    return json({ biofix: null });
  }
  const today = farmYmd(Date.now(), farmTimeZone());
  if (date > today) {
    return json(
      { error: 'The catch date cannot be in the future.', code: 'IN_THE_FUTURE' },
      { status: 400 }
    );
  }
  const value = { date, byUserId: user.id, at: Date.now() };
  setBiofix(model.pluginId, year, value);
  return json({ biofix: value });
};
