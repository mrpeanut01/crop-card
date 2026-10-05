// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from './client';
import { owners } from './schema';
import { runWithTenant } from './tenant';
import { createField } from './fields';
import { addPlanting, createBlock } from './blocks';
import { createTask, getTask, reanchorCropTasks } from './tasks';

const DAY = 86_400_000;

describe('reanchorCropTasks', () => {
  it('moves a linked prep task that also carries the crop id once, not twice', () => {
    const owner = `reanchor-${randomUUID()}`;
    db.insert(owners)
      .values({ id: owner, name: owner, slug: owner, billingStatus: 'active' })
      .run();
    runWithTenant(owner, () => {
      const field = createField({ name: 'F' });
      const block = createBlock({ name: 'B', fieldId: field.id, acres: 1 });
      const crop = addPlanting({
        blockId: block.id,
        cropPluginId: 'tomato',
        varietyDisplayName: 'Tomato',
        plantingDate: Date.UTC(2030, 4, 1)
      });
      const base = Date.UTC(2030, 4, 10);
      const primary = createTask({
        title: 'Spray',
        kind: 'primary',
        cropId: crop.id,
        blockId: block.id,
        scheduledFor: base
      });
      const prep = createTask({
        title: 'Check nozzles',
        kind: 'pre-task',
        linkedToTaskId: primary.id,
        cropId: crop.id,
        scheduledFor: base - DAY
      });
      const res = reanchorCropTasks(crop.id, 0, 3 * DAY);
      expect(getTask(primary.id)!.scheduledFor).toBe(base + 3 * DAY);
      expect(getTask(prep.id)!.scheduledFor).toBe(base + 2 * DAY);
      expect(res.shifted).toBe(2);
    });
  });
});
