import { browser } from '$app/environment';
import { error, redirect } from '@sveltejs/kit';
import type { DesignerPageData, GardenDesignResponse } from '$lib/garden/api';
import { resolvePlanningYear, type PlanningFrost } from '$lib/season/planningYear';
import { t } from '$lib/i18n';
import type { PageLoad } from './$types';

function seasonFrom(season: string | null, now: Date, frost: PlanningFrost | null): number {
  const asked = Number(season);
  return Number.isInteger(asked) && asked >= 2000 && asked <= 2100
    ? asked
    : resolvePlanningYear(null, now, frost);
}

async function fromSnapshot(
  areaId: string,
  season: string | null,
  role: string,
  locale: string | null | undefined
): Promise<DesignerPageData> {
  const [{ loadSnapshot }, { designerDataFromSnapshot }] = await Promise.all([
    import('$lib/client/cardStore'),
    import('$lib/garden/offlineDesign')
  ]);
  const row = await loadSnapshot().catch(() => null);
  if (!row) {
    error(503, t(locale, 'plan.design.offlineNotSaved'));
  }
  const frost = row.bundle.frost;
  const saved =
    frost && frost.provenance !== 'fallback'
      ? { lastSpring: frost.lastSpring, firstFall: frost.firstFall }
      : null;
  const data = designerDataFromSnapshot(row.bundle, areaId, {
    seasonYear: seasonFrom(season, new Date(), saved),
    role
  });
  if (!data) error(404, t(locale, 'plan.design.notInCopy'));
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
  const locale = async () => (await parent()).locale;
  if (!res) {
    if (!browser) error(503, t(await locale(), 'plan.design.didNotLoad'));
    const parentData = await parent();
    return fromSnapshot(params.id, season, parentData.user?.role ?? 'owner', parentData.locale);
  }
  if (res.status === 401) redirect(303, '/');
  if (res.status === 404) error(404, t(await locale(), 'plan.design.notDesignable'));
  if (!res.ok) error(res.status, t(await locale(), 'plan.design.didNotLoad'));
  const body = (await res.json()) as GardenDesignResponse;
  return { ...body, offline: false } satisfies DesignerPageData;
};
