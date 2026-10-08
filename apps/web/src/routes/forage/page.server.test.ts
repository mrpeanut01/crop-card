// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { load } from './+page.server';

const USER = 'forage-loader-owner';

db.insert(users)
  .values({ id: USER, email: `${USER}@test.local` })
  .onConflictDoNothing()
  .run();

function seedOwner(): string {
  const ownerId = `forage-loader-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: 'Forage farm', slug: ownerId, billingStatus: 'active' })
    .run();
  return ownerId;
}

function event(ownerId: string, path: string) {
  return {
    params: {},
    url: new URL(`http://localhost${path}`),
    request: new Request(`http://localhost${path}`),
    locals: {
      locale: 'en',
      authVia: 'cookie',
      user: {
        id: USER,
        email: `${USER}@test.local`,
        phone: null,
        role: 'owner',
        activeOwnerId: ownerId,
        isSuperadmin: false,
        impersonating: false
      }
    },
    cookies: { get: () => undefined }
  } as never;
}

type Data = {
  title: string;
  picker: Array<{ id: string; name: string }> | null;
  backHref: string;
};

async function run(ownerId: string, path: string): Promise<Data> {
  return runWithTenantAsync(ownerId, async () => (await load(event(ownerId, path))) as Data);
}

describe('/forage loader (#741)', () => {
  it('lists the farm’s crop Areas when nothing is named instead of a 400', async () => {
    const ownerId = seedOwner();
    const other = seedOwner();
    const pasture = runWithTenant(ownerId, () =>
      createField({ name: 'North pasture', kind: 'pasture' })
    );
    runWithTenant(ownerId, () => createField({ name: 'Barn', kind: 'barn' }));
    runWithTenant(other, () => createField({ name: 'Elsewhere', kind: 'pasture' }));

    const data = await run(ownerId, '/forage');
    expect(data.picker).toEqual([{ id: pasture.id, name: 'North pasture' }]);
    expect((await run(ownerId, '/forage?area=')).picker).not.toBeNull();
  });

  it('accepts ?area= as an alias for ?fieldId=', async () => {
    const ownerId = seedOwner();
    const pasture = runWithTenant(ownerId, () =>
      createField({ name: 'South pasture', kind: 'pasture' })
    );
    const data = await run(ownerId, `/forage?area=${pasture.id}`);
    expect(data.picker).toBeNull();
    expect(data.title).toBe('South pasture');
    expect(data.backHref).toBe(`/plan?area=${pasture.id}`);
  });
});
