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
import { t } from '$lib/i18n';

export const _requestSchema = biofixPutSchema;

export const PUT: RequestHandler = async (event) => {
  const user = requireMutator(event);
  const model = (await getDataKinds()).pestModels.get(event.params.id ?? '');
  if (!model)
    return json({ error: t(event.locals?.locale, 'api.errB.pestModelNotFound') }, { status: 404 });
  if (!acceptsManualBiofix(model)) {
    return json(
      { error: t(event.locals?.locale, 'api.errB.biofixNotTrap'), code: 'BIOFIX_NOT_TRAP' },
      { status: 400 }
    );
  }
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidJsonShort') },
      { status: 400 }
    );
  }
  const parsed = biofixPutSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: t(event.locals?.locale, 'stockui.api.invalidRequest'),
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
      { error: t(event.locals?.locale, 'api.errB.catchFuture'), code: 'IN_THE_FUTURE' },
      { status: 400 }
    );
  }
  const value = { date, byUserId: user.id, at: Date.now() };
  setBiofix(model.pluginId, year, value);
  return json({ biofix: value });
};
