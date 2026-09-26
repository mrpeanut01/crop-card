import { redirect, type ServerLoad } from '@sveltejs/kit';
import { listBlocks } from '$lib/db/blocks';
import { listFields } from '$lib/db/fields';
import { buildMapSnapshot } from '$lib/server/mapSnapshot';
import { farmZone } from '$lib/climate/zoneSettings.server';

export const load: ServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/');
  if (!locals.user.activeOwnerId) throw redirect(303, '/owner-picker');

  const fields = listFields();
  const blocks = listBlocks();
  return {
    snapshot: { ...buildMapSnapshot({ fields, blocks }), zone: await farmZone() },
    mapFields: fields.map((f) => ({
      id: f.id,
      name: f.name,
      kind: f.kind,
      acres: f.acres,
      widthFt: f.widthFt,
      lengthFt: f.lengthFt,
      geometryGeojson: f.geometryGeojson
    })),
    mapBlocks: blocks.map((b) => ({
      id: b.id,
      name: b.name,
      fieldId: b.fieldId,
      acres: b.acres,
      widthFt: b.widthFt,
      lengthFt: b.lengthFt,
      geometryGeojson: b.geometryGeojson
    })),
    canEdit: locals.user.role === 'owner'
  };
};
