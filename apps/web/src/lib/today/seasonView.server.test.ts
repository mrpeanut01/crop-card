// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { owners, tasks } from '$lib/db/schema';
import { runWithTenant, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createTask } from '$lib/db/tasks';
import type { PluginRegistry } from '$lib/plugins';
import { loadSeasonView } from './seasonView.server';

const registry = { get: () => undefined } as unknown as PluginRegistry;

describe('loadSeasonView field work (#467 review)', () => {
  it('shows a tilled block that has no planting yet', () => {
    const ownerId = `season-view-${randomUUID()}`;
    db.insert(owners)
      .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
      .run();
    const view = runWithTenant(ownerId, () => {
      const field = createField({ name: 'Home', kind: 'field' });
      const block = createBlock({ name: 'Fallow field', fieldId: field.id });
      const task = createTask({
        title: 'Till',
        kind: 'primary',
        blockId: block.id,
        scheduledFor: new Date(2026, 3, 1).getTime()
      });
      db.update(tasks)
        .set({ category: 'till' })
        .where(withTenant(tasks, eq(tasks.id, task.id)))
        .run();
      return loadSeasonView(registry, '2026', new Date(2026, 4, 1).getTime());
    });
    expect(view.timeline.rows).toHaveLength(1);
    expect(view.timeline.rows[0]).toMatchObject({ blockWork: true, blockName: 'Fallow field' });
    expect(view.timeline.rows[0].spans.map((s) => s.kind)).toEqual(['till']);
  });
});
