/**
 * DELETE /api/rain-gauge/:id: remove a mistyped gauge reading (E4-13). A
 * wrong 10 inches would silence the watering advice for a week. The owner,
 * or the member who entered it.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteRainGaugeReading, getRainGaugeReading } from '$lib/db/irrigation';
import { requireUser } from '$lib/server/auth';
import { canRemoveLog } from '$lib/server/irrigationApi';
import { t } from '$lib/i18n';

export const DELETE: RequestHandler = (event) => {
  const user = requireUser(event);
  const row = getRainGaugeReading(event.params.id ?? '');
  if (!row)
    return json({ error: t(event.locals?.locale, 'today.watering.err.noGauge') }, { status: 404 });
  if (!canRemoveLog(user, row.recordedById)) {
    return json(
      {
        error: t(event.locals?.locale, 'today.watering.err.removeGauge'),
        askOwner: true
      },
      { status: 403 }
    );
  }
  deleteRainGaugeReading(row.id);
  return json({ ok: true });
};
