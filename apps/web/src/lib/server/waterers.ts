/**
 * Automatic waterers on the server (Phase 37E, R-21). Server-only: storing a
 * schedule, checking target refs, and turning equipment rows plus their
 * targets into `Waterer`s.
 */

import type { Equipment } from '$lib/db/equipment';
import type { WaterTargetRow } from '$lib/db/waterers';
import type { IrrigationSchedule, StoredSchedule } from '$lib/irrigation/apiSchemas';
import {
  sameProgram,
  scheduleOf,
  type Waterer,
  type WatererTarget
} from '$lib/irrigation/schedule';

/** The schedule to store: `activeFrom` stays when the program did not
 *  change, and is `nowMs` for a new or changed one. The owner's "running
 *  since" day (FU870-4) is kept only when given, so leaving it out clears it. */
export function storeSchedule(
  input: IrrigationSchedule,
  existing: StoredSchedule | null,
  nowMs: number
): StoredSchedule {
  const { runningSince, ...rest } = input;
  const clean: IrrigationSchedule = {
    ...rest,
    days: [...input.days].sort((a, b) => a - b),
    inchesPerRun: input.inchesPerRun ?? null,
    gallonsPerMinute: input.gallonsPerMinute ?? null,
    ...(runningSince ? { runningSince } : {})
  };
  const activeFrom = existing && sameProgram(existing, clean) ? existing.activeFrom : nowMs;
  return { ...clean, activeFrom };
}

type TargetRow = Pick<WaterTargetRow, 'equipmentId' | 'fieldId' | 'blockId'> &
  Pick<WatererTarget, 'sharePct' | 'sqFt' | 'blockFieldId'>;

/** Live irrigation equipment with a schedule, joined to its targets. A
 *  target keeps its typed share, size and current Area when the row has
 *  them, for the gallons split (FU870-1). */
export function waterersFrom(
  equipment: ReadonlyArray<
    Pick<Equipment, 'id' | 'label' | 'spec' | 'retiredAt'> & { type: string }
  >,
  targets: readonly TargetRow[]
): Waterer[] {
  const byEquipment = new Map<string, TargetRow[]>();
  for (const t of targets)
    byEquipment.set(t.equipmentId, [...(byEquipment.get(t.equipmentId) ?? []), t]);
  const out: Waterer[] = [];
  for (const e of equipment) {
    if (e.type !== 'irrigation' || e.retiredAt !== undefined) continue;
    const schedule = scheduleOf(e.spec);
    const own = byEquipment.get(e.id);
    if (!schedule || !own?.length) continue;
    out.push({
      equipmentId: e.id,
      label: e.label,
      schedule,
      targets: own.map((t) => ({
        fieldId: t.fieldId,
        blockId: t.blockId,
        ...(t.sharePct !== undefined ? { sharePct: t.sharePct } : {}),
        ...(t.sqFt !== undefined ? { sqFt: t.sqFt } : {}),
        ...(t.blockFieldId !== undefined ? { blockFieldId: t.blockFieldId } : {})
      }))
    });
  }
  return out.sort(
    (a, b) => a.label.localeCompare(b.label) || a.equipmentId.localeCompare(b.equipmentId)
  );
}
