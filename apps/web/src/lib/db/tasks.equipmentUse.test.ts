import { describe, expect, it } from 'vitest';
import { createEquipment, getEquipment, updateEquipmentState } from './equipment';
import { completeTask, createTask } from './tasks';
import { runWithTenant } from './tenant';

const OWNER = 'owner_home_farm';
const DAY = 86_400_000;

describe('completeTask marks the gear used (#670)', () => {
  it('sets Last used when a primary task naming the gear is done', () =>
    runWithTenant(OWNER, () => {
      const mower = createEquipment({ type: 'mower', label: 'Disc mower #670' });
      const at = Date.UTC(2027, 4, 18, 14);
      const task = createTask({
        title: 'Mow the hay',
        kind: 'primary',
        equipmentId: mower.id,
        scheduledFor: at
      });
      completeTask(task.id, { occurredAt: at });
      expect(getEquipment(mower.id)?.state.lastUsedAt).toBe(at);
    }));

  it('never moves Last used backward and ignores prep tasks', () =>
    runWithTenant(OWNER, () => {
      const baler = createEquipment({ type: 'baler', label: 'Baler #670' });
      const later = Date.UTC(2027, 5, 29, 14);
      updateEquipmentState(baler.id, { lastUsedAt: later });
      const older = createTask({
        title: 'Bale',
        kind: 'primary',
        equipmentId: baler.id,
        scheduledFor: later - 10 * DAY
      });
      completeTask(older.id, { occurredAt: later - 10 * DAY });
      const prep = createTask({
        title: 'Grease the knotters',
        kind: 'pre-task',
        equipmentId: baler.id,
        scheduledFor: later + DAY
      });
      completeTask(prep.id, { occurredAt: later + DAY });
      expect(getEquipment(baler.id)?.state.lastUsedAt).toBe(later);
    }));
});
