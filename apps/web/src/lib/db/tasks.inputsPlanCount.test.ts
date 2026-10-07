// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from './client';
import { owners } from './schema';
import { INPUTS_PLAN_TEMPLATE_KEY, countInputsPlanTasksInYear, createTask } from './tasks';
import { runWithTenant } from './tenant';

describe('countInputsPlanTasksInYear (#755)', () => {
  it("counts only that year's inputs-plan tasks on this farm", () => {
    const farm = `ip-${randomUUID()}`;
    const other = `ip-${randomUUID()}`;
    for (const id of [farm, other]) {
      db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
    }
    runWithTenant(farm, () => {
      for (const month of [3, 5, 8]) {
        createTask({
          title: 'Spray',
          kind: 'primary',
          scheduledFor: new Date(2027, month, 10).getTime(),
          pluginTemplateKey: INPUTS_PLAN_TEMPLATE_KEY
        });
      }
      createTask({
        title: 'Hand task',
        kind: 'primary',
        scheduledFor: new Date(2028, 4, 1).getTime()
      });
    });
    runWithTenant(other, () =>
      createTask({
        title: 'Spray',
        kind: 'primary',
        scheduledFor: new Date(2028, 4, 1).getTime(),
        pluginTemplateKey: INPUTS_PLAN_TEMPLATE_KEY
      })
    );
    runWithTenant(farm, () => {
      expect(countInputsPlanTasksInYear(2027)).toBe(3);
      expect(countInputsPlanTasksInYear(2028)).toBe(0);
    });
    runWithTenant(other, () => expect(countInputsPlanTasksInYear(2028)).toBe(1));
  });
});
