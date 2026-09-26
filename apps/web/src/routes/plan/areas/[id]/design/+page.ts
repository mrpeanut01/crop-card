import { browser } from '$app/environment';
import { error, redirect } from '@sveltejs/kit';
import type { DesignerPageData, GardenDesignResponse } from '$lib/garden/api';
import { resolvePlanningYear } from '$lib/season/planningYear';
import type { PageLoad } from './$types';

const NOT_DESIGNABLE = 'This Area has no garden designer. Only gardens and greenhouses do.';

function seasonFrom(season: string | null, now: Date): number {
  const asked = Number(season);
  return Number.isInteger(asked) && asked >= 2000 && asked <= 2100
    ? asked
    : resolvePlanningYear(null, now);
}

async function fromSnapshot(
  areaId: string,
  season: string | null,
  role: string
): Promise<DesignerPageData> {
  const [{ loadSnapshot }, { designerDataFromSnapshot }] = await Promise.all([
    import('$lib/client/cardStore'),
    import('$lib/garden/offlineDesign')
  ]);
  const row = await loadSnapshot().catch(() => null);
  if (!row) {
    error(
      503,
      "You're offline, and this garden isn't saved on this device yet. Open it once with signal, or open your saved Cards."
    );
  }
  const data = designerDataFromSnapshot(row.bundle, areaId, {
    seasonYear: seasonFrom(season, new Date()),
    role
  });
  if (!data) error(404, "This garden isn't in the copy saved on this device.");
  return data;
}

/** Online, the designer's data comes from `GET /api/garden/areas/[id]/design`.
 *  When that can't be reached in the browser (a client-side visit with no
 *  signal), the page is rebuilt read-only from the offline card snapshot. */
export const load: PageLoad = async ({ fetch, params, url, parent }) => {
  const season = url.searchParams.get('season');
  const path = `/api/garden/areas/${encodeURIComponent(params.id)}/design${
    season ? `?season=${encodeURIComponent(season)}` : ''
  }`;
  let res: Response | null = null;
  if (!(browser && navigator.onLine === false)) {
    try {
      res = await fetch(path);
    } catch {
      res = null;
    }
  }
  if (!res) {
    if (!browser) error(503, "The garden designer didn't load. Try again.");
    const { user } = await parent();
    return fromSnapshot(params.id, season, user?.role ?? 'owner');
  }
  if (res.status === 401) redirect(303, '/');
  if (res.status === 404) error(404, NOT_DESIGNABLE);
  if (!res.ok) error(res.status, "The garden designer didn't load. Try again.");
  const body = (await res.json()) as GardenDesignResponse;
  return { ...body, offline: false } satisfies DesignerPageData;
};
