/** PUT /api/finance/labour-rate: the owner's one labour rate (F2-13),
 *  in cents an hour; null clears it. Owner only. */

import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteSetting, setSetting } from '$lib/db/settings';
import { labourRateSchema } from '$lib/finance/apiSchemas';
import { requireMoneyWriter } from '$lib/finance/access';
import { invalidBody, readBody } from '$lib/finance/entryRules.server';
import { LABOUR_RATE_SETTING } from '$lib/finance/profit.server';

export const _requestSchema = labourRateSchema;

export const PUT: RequestHandler = async (event) => {
  requireMoneyWriter(event);
  const read = await readBody(event.request);
  if (!read.ok) return json({ error: 'invalid JSON body' }, { status: 400 });
  const parsed = labourRateSchema.safeParse(read.body);
  if (!parsed.success) return invalidBody(parsed.error);
  const { centsPerHour } = parsed.data;
  if (centsPerHour === null) deleteSetting(LABOUR_RATE_SETTING);
  else setSetting(LABOUR_RATE_SETTING, String(centsPerHour));
  return json({ centsPerHour });
};
