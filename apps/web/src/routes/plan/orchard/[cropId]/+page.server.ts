import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { t } from '$lib/i18n';
import { beeLineFor } from '$lib/orchard/appLines';
import { orchardCalendarView } from '$lib/orchard/calendarView';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { loadOrchardPlantingView } from '$lib/server/orchardCalendar.server';

/** The seasonal calendar for one tree fruit planting (#562, OC-7: "the
 *  calendar"). Windows show for every stage; the marked stage opens first.
 *  No degree-day estimate (OC-5) and no dated task from a stage. */
export const load: PageServerLoad = async (event) => {
  const locale = event.locals?.locale;
  const view = await loadOrchardPlantingView(event.params.cropId, { locale });
  if (!view) error(404, t(locale, 'orchardui.err.notFound'));
  const user = currentUser(event);
  const role = user?.role ?? null;
  const calendar = view.calendar;
  return {
    view: {
      cropId: view.cropId,
      cropPluginId: view.cropPluginId,
      cropName: view.cropName,
      blockName: view.blockName,
      area: view.area,
      year: view.year,
      audience: view.audience,
      status: view.status,
      lowInput: view.lowInput,
      mark: view.mark
    },
    calendar: calendar
      ? {
          ...orchardCalendarView(calendar, view.lowInput),
          beeLine: beeLineFor(calendar.guide.publicationId)
        }
      : null,
    canMark: role !== null && canMutate(role),
    canChooseGuide: role === 'owner' && !!view.area,
    isOwner: role === 'owner'
  };
};
