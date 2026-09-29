import { json } from '@sveltejs/kit';
import { getField } from '$lib/db/fields';
import { rejectForeignRefs } from '$lib/server/foreignRefs';
import { MAP_FEATURE_LABELS, servesManyAreas, type MapFeatureKind } from '$lib/farm/mapFeatures';

/** `areaIds` is for hydrants and waterers only, and every id must be one of
 *  the active Owner's Areas. Returns the 400 to send, or null. */
export function checkAreaIds(kind: MapFeatureKind, areaIds: readonly string[]): Response | null {
  if (!servesManyAreas(kind)) {
    return json(
      {
        error: `a ${MAP_FEATURE_LABELS[kind].toLowerCase()} belongs to one Area; send fieldId instead`
      },
      { status: 400 }
    );
  }
  return rejectForeignRefs(...areaIds.map((id) => ['areaIds', id, getField] as const));
}
