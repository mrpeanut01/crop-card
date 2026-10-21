// @vitest-environment node
/** #868: "Schedule the next cut" saves English whatever language the page is
 *  in, through the unchanged `POST /api/tasks`, and every reader sees the
 *  task in their own language. */
import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { listTasks } from '$lib/db/tasks';
import { seasonYear } from '$lib/server/pantry.server';
import { pantryCutTemplateKey } from '$lib/garden/pantryCutTask';
import { taskDisplayBody, taskDisplayTitle } from '$lib/tasks/title';
import { POST } from '../../api/tasks/+server';
import { load } from './+page.server';

type CutTasks = Record<string, { title: string; body: string }>;

function seed(varietyDisplayName: string) {
  const ownerId = `pc-${randomUUID().slice(0, 8)}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  db.insert(users)
    .values({ id: `user-${ownerId}`, email: `${ownerId}@test.local` })
    .run();
  const plantingId = runWithTenant(ownerId, () => {
    const field = createField({ name: 'Herbs', kind: 'garden' });
    const block = createBlock({ name: 'Bed 1', fieldId: field.id, acres: 0.01 });
    return createPlanned({
      blockId: block.id,
      cropPluginId: 'basil-genovese',
      varietyDisplayName,
      plantingDate: Date.UTC(seasonYear(), 4, 1)
    }).id;
  });
  return { ownerId, plantingId };
}

function event(ownerId: string, locale: string, init?: { body: unknown }) {
  const url = new URL(init ? 'http://localhost/api/tasks' : 'http://localhost/plan/pantry');
  return {
    url,
    params: {},
    request: new Request(
      url.href,
      init
        ? {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(init.body)
          }
        : undefined
    ),
    locals: {
      locale,
      authVia: 'cookie',
      user: {
        id: `user-${ownerId}`,
        email: null,
        phone: null,
        role: 'owner',
        activeOwnerId: ownerId,
        isSuperadmin: false,
        impersonating: false
      }
    },
    cookies: { get: () => undefined }
  } as unknown as RequestEvent;
}

async function pageCutTasks(ownerId: string, locale: string): Promise<CutTasks> {
  const data = (await runWithTenantAsync(ownerId, async () =>
    load(event(ownerId, locale) as never)
  )) as unknown as { cutTasks: CutTasks; schedule: { plantings: Array<{ cropName: string }> } };
  return data.cutTasks;
}

describe('pantry cut task language (#868)', () => {
  it('the page hands over English text in either language', async () => {
    const { ownerId, plantingId } = seed('Basil — Genovese');
    const es = await pageCutTasks(ownerId, 'es');
    const en = await pageCutTasks(ownerId, 'en');
    expect(es[plantingId]).toEqual({
      title: 'Cut Basil — Genovese',
      body: 'The next cut for your pantry, from your harvest plan.'
    });
    expect(en).toEqual(es);
  });

  it('a Spanish owner saves English, a Spanish reader sees Spanish, an English helper English', async () => {
    const { ownerId, plantingId } = seed('Basil — Genovese');
    const cut = (await pageCutTasks(ownerId, 'es'))[plantingId]!;
    const res = await runWithTenantAsync(ownerId, async () =>
      POST(
        event(ownerId, 'es', {
          body: {
            kind: 'primary',
            ...cut,
            cropId: plantingId,
            scheduledFor: Date.now(),
            pluginTemplateKey: pantryCutTemplateKey(plantingId, '2026-07-06')
          }
        }) as never
      )
    );
    expect(res.status).toBe(201);
    const stored = runWithTenant(ownerId, () => listTasks({})).find(
      (t) => t.pluginTemplateKey === pantryCutTemplateKey(plantingId, '2026-07-06')
    )!;
    expect(stored.title).toBe('Cut Basil — Genovese');
    expect(stored.body).toBe('The next cut for your pantry, from your harvest plan.');
    expect(taskDisplayTitle(stored, 'es')).toBe('Cortar Albahaca Genovese');
    expect(taskDisplayBody(stored, 'es')).toBe(
      'El próximo corte para tu despensa, según tu plan de cosecha.'
    );
    expect(taskDisplayTitle(stored, 'en')).toBe('Cut Basil — Genovese');
    expect(taskDisplayBody(stored, null)).toBe(stored.body);
  });

  it('keeps an owner-typed planting name as typed', async () => {
    const { ownerId, plantingId } = seed('Grandma basil');
    const cut = (await pageCutTasks(ownerId, 'es'))[plantingId]!;
    expect(cut.title).toBe('Cut Grandma basil');
    expect(
      taskDisplayTitle({ ...cut, pluginTemplateKey: pantryCutTemplateKey(plantingId, 'w') }, 'es')
    ).toBe('Cortar Grandma basil');
  });
});
