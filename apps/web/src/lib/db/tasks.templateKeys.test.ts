// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from './client';
import { owners } from './schema';
import { createTask, existingTemplateKeys } from './tasks';
import { runWithTenant } from './tenant';

describe('existingTemplateKeys', () => {
  it("finds a scheduled suggestion's key whatever its date, and only on this farm", () => {
    const other = `tk-${randomUUID()}`;
    db.insert(owners)
      .values({ id: other, name: 'Other', slug: other, billingStatus: 'active' })
      .run();
    const mine = `derived:scout-window:b-${randomUUID()}:1790000000000`;
    const theirs = `derived:scout-window:b-${randomUUID()}:1790000000000`;
    runWithTenant('owner_home_farm', () =>
      createTask({
        title: 'Scout',
        kind: 'primary',
        scheduledFor: Date.UTC(2031, 0, 1),
        pluginTemplateKey: mine
      })
    );
    runWithTenant(other, () =>
      createTask({
        title: 'Scout',
        kind: 'primary',
        scheduledFor: Date.UTC(2020, 0, 1),
        pluginTemplateKey: theirs
      })
    );
    const found = runWithTenant('owner_home_farm', () =>
      existingTemplateKeys([mine, theirs, 'derived:none'])
    );
    expect([...found]).toEqual([mine]);
  });
});
