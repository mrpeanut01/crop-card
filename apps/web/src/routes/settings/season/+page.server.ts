import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { requireOwner } from '$lib/server/auth';
import { loadSeasonSetup } from '$lib/season/setup.server';
import { loadPlanningYearView } from '$lib/season/planningYear.server';

export const load: PageServerLoad = (event) => {
  const u = requireOwner(event);
  if (!u.activeOwnerId) throw redirect(303, '/owner-picker');

  const planningYear = loadPlanningYearView();
  const yearParam = event.url.searchParams.get('year');
  const requested = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;
  const pastView = requested !== null && planningYear.pastYears.includes(requested);
  const year = pastView ? requested : planningYear.activeYear;

  return {
    currentYear: year,
    calendarYear: new Date().getFullYear(),
    readOnly: pastView,
    planningYear,
    existing: loadSeasonSetup(year),
    lastYearSetup: loadSeasonSetup(year - 1)
  };
};
