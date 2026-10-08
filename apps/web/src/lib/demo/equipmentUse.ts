import type { DemoEquipmentKey } from './catalog';
import type { DemoTimeline } from './timeline';

/** When each piece of demo gear was last used at or before `now`, from the
 *  records the timeline holds: hay steps for the hay tools, field plantings
 *  for the planter and drill, and done tasks that name the gear. */
export function demoEquipmentLastUsed(
  t: Pick<DemoTimeline, 'hay' | 'plantings' | 'tasks'>,
  now: number
): Map<DemoEquipmentKey, number> {
  const out = new Map<DemoEquipmentKey, number>();
  const note = (key: DemoEquipmentKey, at: number | undefined) => {
    if (at === undefined || at > now) return;
    if (at > (out.get(key) ?? -Infinity)) out.set(key, at);
  };
  for (const cut of t.hay) {
    note('mower', cut.mowAt);
    note('tedder', cut.tedAt);
    note('rake', cut.rakeAt);
    note('baler', cut.baleAt);
  }
  for (const p of t.plantings) {
    if (!p.bed.startsWith('nf') || p.mode === 'perennial') continue;
    note(p.templateKey === 'corn' || p.templateKey === 'soy' ? 'planter' : 'drill', p.plantingDate);
  }
  for (const task of t.tasks) {
    if (task.equipment) note(task.equipment, task.doneAt);
  }
  return out;
}
