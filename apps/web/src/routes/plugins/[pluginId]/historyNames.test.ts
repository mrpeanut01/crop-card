// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenantAsync } from '$lib/db/tenant';
import { appendVersion } from '$lib/db/pluginVersions';
import { load } from './+page.server';

const suffix = randomUUID().slice(0, 8);
const otherUser = `hist-other-${suffix}`;
const viewer = `hist-viewer-${suffix}`;
const pluginId = `history-only-${suffix}`;

db.insert(users)
  .values([
    { id: otherUser, email: `other-${suffix}@farm-b.test` },
    { id: viewer, email: `viewer-${suffix}@farm-a.test` }
  ])
  .run();
const ownerId = `hist-owner-${suffix}`;
db.insert(owners).values({ id: ownerId, name: ownerId, slug: ownerId }).run();
appendVersion({
  pluginId,
  version: '1.0.0',
  kind: 'crop',
  hash: `h1-${suffix}`,
  payloadJson: '{}',
  changedByUserId: otherUser
});
appendVersion({
  pluginId,
  version: '1.0.1',
  kind: 'crop',
  hash: `h2-${suffix}`,
  payloadJson: '{}',
  changedByUserId: viewer
});

async function names(locals: Record<string, unknown>) {
  const data = (await runWithTenantAsync(ownerId, async () =>
    load({ params: { pluginId }, locals } as never)
  )) as { history: { changedByEmail?: string }[] };
  return data.history.map((r) => r.changedByEmail ?? null);
}

describe('/plugins/[pluginId] version history names', () => {
  it("never shows another farm's user to an owner", async () => {
    const shown = await names({ user: { id: viewer, role: 'owner' }, authVia: 'cookie' });
    expect(shown).toContain(`viewer-${suffix}@farm-a.test`);
    expect(shown).not.toContain(`other-${suffix}@farm-b.test`);
  });

  it('shows every name to an interactive superadmin', async () => {
    const shown = await names({
      user: { id: viewer, role: 'owner', isSuperadmin: true },
      authVia: 'cookie'
    });
    expect(shown).toContain(`other-${suffix}@farm-b.test`);
  });
});
