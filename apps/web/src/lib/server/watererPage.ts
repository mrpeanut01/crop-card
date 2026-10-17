/** What the equipment page needs to show and edit an automatic waterer
 *  (Phase 37E). Server-only; every read is tenant-scoped. */

import type { Equipment } from '$lib/db/equipment';
import { listBlocks } from '$lib/db/blocks';
import { listFields } from '$lib/db/fields';
import { listWaterTargets } from '$lib/db/waterers';
import { WATERER_METHODS, type WatererMethod } from '$lib/irrigation/apiSchemas';
import { scheduleOf } from '$lib/irrigation/schedule';

/** Area kinds a waterer can water: the ones that get watering advice. */
const WATERED_KINDS = ['garden', 'field'] as const;

function methodOf(spec: Record<string, unknown> | undefined): WatererMethod {
  const m = spec?.method;
  return (WATERER_METHODS as readonly unknown[]).includes(m) ? (m as WatererMethod) : 'drip';
}

export function watererPageData(equipment: Equipment) {
  const blocks = listBlocks({ plantings: 'none' });
  return {
    schedule: scheduleOf(equipment.spec),
    defaultMethod: methodOf(equipment.spec),
    targets: listWaterTargets([equipment.id]).map((t) => ({
      fieldId: t.fieldId,
      blockId: t.blockId
    })),
    areas: listFields({ kinds: WATERED_KINDS })
      .map((f) => ({
        id: f.id,
        name: f.name,
        beds: blocks
          .filter((b) => b.fieldId === f.id)
          .map((b) => ({ id: b.id, name: b.blockLabel ?? b.name }))
          .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  };
}
