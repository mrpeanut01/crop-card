import { error } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth';
import { prefsFor } from '$lib/db/userProfile';
import { buildIrrigationRecordCards } from '$lib/server/recordCards';

/** Phase 32E (E4-14): a watering log opened from /records or a printed
 *  card's QR. Read-only for everyone. */
export const load: PageServerLoad = (event) => {
  const user = requireUser(event);
  const result = buildIrrigationRecordCards(event.params.id, { prefs: prefsFor(user.id) });
  if (!result || result.cards.length === 0)
    throw error(404, t(event.locals.locale, 'recui.err.noWatering'));
  return { card: result.cards[0] };
};
