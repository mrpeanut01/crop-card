/** The optional `waterers` part of the offline card snapshot (Phase 37E).
 *  Server-only. A farm with no waterer targets pays one read and adds
 *  nothing, so older bundles and readers that ignore the field are fine. */

import { listEquipment } from '$lib/db/equipment';
import { listWaterTargets } from '$lib/db/waterers';
import type { SnapshotWaterer } from '$lib/irrigation/snapshot';
import { waterersFrom } from './waterers';

export function watererSnapshotPart(): { waterers?: SnapshotWaterer[] } {
  const targets = listWaterTargets();
  if (targets.length === 0) return {};
  const waterers = waterersFrom(listEquipment(), targets).map((w) => ({
    equipmentId: w.equipmentId,
    label: w.label,
    schedule: {
      days: [...w.schedule.days],
      start: w.schedule.start,
      minutes: w.schedule.minutes,
      method: w.schedule.method,
      inchesPerRun: w.schedule.inchesPerRun ?? null
    },
    targets: w.targets.map((t) => ({ fieldId: t.fieldId, blockId: t.blockId }))
  }));
  return waterers.length ? { waterers } : {};
}
