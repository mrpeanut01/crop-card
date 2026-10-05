import { json } from '@sveltejs/kit';
import { getField } from '$lib/db/fields';
import { rejectForeignRefsIn } from '$lib/server/foreignRefs';
import { mapFeatureLabel, servesManyAreas, type MapFeatureKind } from '$lib/farm/mapFeatures';
import { t } from '$lib/i18n';

/** `areaIds` is for hydrants and waterers only, and every id must be one of
 *  the active Owner's Areas. Returns the 400 to send, or null. */
export function checkAreaIds(
  kind: MapFeatureKind,
  areaIds: readonly string[],
  locale?: string | null
): Response | null {
  if (!servesManyAreas(kind)) {
    return json(
      {
        error: t(locale, 'map.featErr.oneArea', {
          kind: mapFeatureLabel(kind, locale).toLowerCase()
        })
      },
      { status: 400 }
    );
  }
  return rejectForeignRefsIn(locale, ...areaIds.map((id) => ['areaIds', id, getField] as const));
}
