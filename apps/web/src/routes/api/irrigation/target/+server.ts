/**
 * POST /api/irrigation/target: the owner's weekly water target for one Area
 * (E4-12), stored as `manual` in the setting `water_target_in_week.<fieldId>`.
 * `inches: null` goes back to the sourced default. Owner only.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteSetting, setSetting } from '$lib/db/settings';
import { waterTargetSchema } from '$lib/irrigation/apiSchemas';
import { requireUser } from '$lib/server/auth';
import { assertField, rejectForeignRefs } from '$lib/server/foreignRefs';
import { invalid, readJson } from '$lib/server/irrigationApi';
import { resolveTarget } from '$lib/server/waterAdvice.server';
import { waterTargetKey } from '$lib/weather/waterSources';

export const _requestSchema = waterTargetSchema;

export const POST: RequestHandler = async (event) => {
  const user = requireUser(event);
  if (user.role !== 'owner') {
    return json(
      { error: 'Only the owner sets the water target. Ask the owner.', askOwner: true },
      { status: 403 }
    );
  }
  const read = await readJson(event.request);
  if (!read.ok) return json({ error: 'invalid JSON body' }, { status: 400 });
  const parsed = waterTargetSchema.safeParse(read.body);
  if (!parsed.success) return invalid(parsed.error);
  const foreign = rejectForeignRefs(assertField('fieldId', parsed.data.fieldId));
  if (foreign) return foreign;
  const key = waterTargetKey(parsed.data.fieldId);
  if (parsed.data.inches === null) deleteSetting(key);
  else setSetting(key, String(Math.round(parsed.data.inches * 100) / 100));
  return json({
    target: resolveTarget(parsed.data.inches === null ? null : String(parsed.data.inches))
  });
};
