import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { openWizardFromPlan, provisionWizardTenant } from './lib/wizardTenant';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

function origin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

interface TaskRow {
  id: string;
  title: string;
  scheduledFor: number;
  pluginTemplateKey?: string;
}

async function seedStartTasks(page: Page, cropId: string): Promise<TaskRow[]> {
  const res = await page.request.get(`/api/tasks?cropId=${cropId}`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { tasks: TaskRow[] };
  return body.tasks
    .filter((t) => t.pluginTemplateKey?.startsWith('seedstart:'))
    .sort((a, b) => a.scheduledFor - b.scheduledFor);
}

test('choosing Seedling started indoors creates three dated tasks', async ({ page }) => {
  await provisionWizardTenant(page, { seeds: [] });
  await page.goto('/plan?tab=overview');
  await page.waitForLoadState('networkidle');
  await page
    .getByRole('button', { name: /Add planting/ })
    .first()
    .click();

  const dialog = page.getByRole('dialog', { name: 'Add planting' });
  const crop = dialog.getByRole('combobox', { name: 'Crop' });
  await crop.fill('red acre');
  await dialog
    .getByRole('listbox')
    .getByRole('option', { name: /Cabbage Red Acre/ })
    .click();
  await dialog.locator('#np-date').fill('2031-05-10');

  const sos = dialog.getByTestId('seed-or-seedling');
  const seedling = sos.getByRole('button', { name: 'Seedling', exact: true });
  await expect(seedling).toHaveAttribute('aria-pressed', 'true');
  const indoors = sos.getByRole('checkbox', { name: "I'll start these from seed indoors" });
  await expect(indoors).toBeChecked();
  await expect(sos).toContainText('Sow 4 to 6 weeks before transplant.');
  const box = await seedling.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);

  const created = page.waitForResponse(
    (r) => /\/api\/blocks\/[^/]+\/plantings$/.test(r.url()) && r.request().method() === 'POST'
  );
  await dialog.getByRole('button', { name: 'Add planting' }).click();
  const res = await created;
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { planting: { id: string } };
  await expect(dialog).toBeHidden();

  const tasks = await seedStartTasks(page, body.planting.id);
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  expect(tasks.map((t) => [t.title.split(' ')[0], day(t.scheduledFor)])).toEqual([
    ['Sow', '2031-04-05'],
    ['Start', '2031-04-26'],
    ['Transplant', '2031-05-10']
  ]);
});

test('bought seedlings make no tasks; unknown timing asks for the sow date', async ({ page }) => {
  await provisionWizardTenant(page, { seeds: [] });
  await page.goto('/plan?tab=overview');
  await page.waitForLoadState('networkidle');
  await page
    .getByRole('button', { name: /Add planting/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add planting' });
  const crop = dialog.getByRole('combobox', { name: 'Crop' });
  await crop.fill('san marzano');
  await dialog
    .getByRole('listbox')
    .getByRole('option', { name: /San Marzano/ })
    .click();
  await dialog.locator('#np-date').fill('2031-05-20');
  const sos = dialog.getByTestId('seed-or-seedling');
  await expect(sos.getByTestId('sow-timing-unknown')).toHaveText(
    'Indoor start timing is not known for this crop. Set the sow date yourself.'
  );
  await sos.getByRole('checkbox', { name: "I'll start these from seed indoors" }).uncheck();
  await expect(sos).toContainText('No indoor tasks for bought seedlings.');
  const created = page.waitForResponse(
    (r) => /\/api\/blocks\/[^/]+\/plantings$/.test(r.url()) && r.request().method() === 'POST'
  );
  await dialog.getByRole('button', { name: 'Add planting' }).click();
  const body = (await (await created).json()) as { planting: { id: string } };
  expect(await seedStartTasks(page, body.planting.id)).toEqual([]);
});

test('the germination stepper saves online and queues with no signal', async ({
  page,
  context
}) => {
  const tenant = await provisionWizardTenant(page, { seeds: [] });
  await page.goto('/today');
  const o = origin(page);
  const planting = await page.request.post(`/api/blocks/${tenant.blocks[0].id}/plantings`, {
    data: {
      cropPluginId: 'cabbage-red-acre',
      plantingDate: Date.now() + 30 * 86_400_000,
      establishment: 'transplant',
      startIndoors: true
    },
    headers: { origin: o }
  });
  expect(planting.status()).toBe(201);
  const cropId = ((await planting.json()) as { planting: { id: string } }).planting.id;
  const tray = await page.request.post('/api/seed-starts', {
    data: {
      cropId,
      sownAt: Date.now() - 86_400_000,
      trayLabel: 'Tray A',
      cells: 72,
      seedsPerCell: 1
    },
    headers: { origin: o }
  });
  expect(tray.status()).toBe(201);

  await page.goto(`/cards/planting/pl_${cropId}`);
  await page.waitForLoadState('networkidle');
  const panel = page.getByTestId('seed-start-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Start indoors 4 to 6 weeks before transplant.');
  const stepper = panel.getByTestId('germination-stepper');
  await expect(stepper.getByTestId('germination-text')).toHaveText('0 of 72 up');
  await stepper.getByRole('button', { name: 'One more up' }).click();
  await stepper.getByRole('button', { name: 'One more up' }).click();
  const saved = page.waitForResponse((r) => /\/api\/seed-starts\/[^/]+\/progress$/.test(r.url()));
  await stepper.getByRole('button', { name: 'Save count' }).click();
  expect((await saved).status()).toBe(201);
  await expect(stepper.getByTestId('germination-text')).toHaveText('2 of 72 up');

  await context.setOffline(true);
  await stepper.getByRole('button', { name: 'One more up' }).click();
  await stepper.getByRole('button', { name: 'Save count' }).click();
  await expect(stepper.locator('[data-queued]')).toBeVisible();
  await context.setOffline(false);

  const scroll = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(scroll).toBeLessThanOrEqual(0);
});

test('the garden designer asks Seed or seedling for a placed planting', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await provisionWizardTenant(page, { blocks: [], seeds: [] });
  const o = origin(page);
  const post = async <T>(url: string, data: unknown): Promise<T> => {
    const res = await page.request.post(url, {
      data: data as Record<string, unknown>,
      headers: { origin: o }
    });
    expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  };
  const area = await post<{ field: { id: string } }>('/api/fields', {
    name: 'Kitchen Garden',
    kind: 'garden',
    widthFt: 20,
    lengthFt: 30
  });
  const bedRes = await post<{ block: { id: string } }>('/api/blocks', {
    name: 'Bed 3',
    fieldId: area.field.id,
    kind: 'bed',
    bedStyle: 'raised',
    widthFt: 4,
    lengthFt: 8,
    xFt: 2,
    yFt: 3,
    rotationDeg: 0
  });
  const year = new Date().getUTCFullYear() + 1;
  const inGround = Date.UTC(year, 7, 20);
  const created = await post<{ plantings: Array<{ cropId: string }> }>('/api/garden/plantings', {
    plantings: [
      {
        blockId: bedRes.block.id,
        cropPluginId: 'broccoli-de-cicco',
        varietyDisplayName: 'Fall broccoli',
        plantingDateMs: inGround,
        footprint: { x_in: 0, y_in: 0, w_in: 24, l_in: 24 },
        spacingPattern: 'square',
        source: 'manual'
      }
    ]
  });
  const cropId = created.plantings[0].cropId;

  await page.goto(`/plan/areas/${area.field.id}/design?season=${year}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('garden-designer')).toHaveAttribute('data-ready', 'true');
  await page.locator('[data-testid="bed"][data-bed-name="Bed 3"]').click();
  await page.getByRole('tab', { name: 'Plantings' }).click();
  await page.locator(`[data-planting-row-id="${cropId}"]`).first().click();

  const box = page.getByTestId('designer-seed-or-seedling');
  await expect(box).toContainText('Not answered yet');
  await expect(box).toContainText('Usually set out as seedlings.');
  const patched = page.waitForResponse(
    (r) => r.url().endsWith(`/api/crops/${cropId}`) && r.request().method() === 'PATCH'
  );
  await box.getByRole('button', { name: 'Seedling, I start it indoors' }).click();
  expect((await patched).status()).toBe(200);
  await expect(box).toContainText('Fall broccoli: Seedlings');

  const tasks = await seedStartTasks(page, cropId);
  expect(tasks.map((t) => new Date(t.scheduledFor).toISOString().slice(0, 10))).toEqual([
    `${year}-07-16`,
    `${year}-08-06`,
    `${year}-08-20`
  ]);
});

test('the planning wizard forwards Seed or seedling and the server writes the tasks', async ({
  page
}) => {
  await provisionWizardTenant(page, {
    seasonSetup: true,
    seeds: [{ displayName: 'Cabbage Red Acre', pluginId: 'cabbage-red-acre', quantity: 60 }]
  });
  await openWizardFromPlan(page);
  const modal = page.locator('.aw-modal');
  const body = modal.locator('.aw-body');
  const footer = modal.locator('.aw-footer');
  for (const btn of await body.getByRole('button', { name: /^Select all .* seeds$/ }).all()) {
    if (await btn.isEnabled()) await btn.click();
  }
  await footer.getByRole('button', { name: /^Next: blocks/ }).click();
  await body.getByRole('button', { name: 'Select all' }).click();
  await footer.getByRole('button', { name: /^Generate plan \(2 blocks\)/ }).click();
  await footer.getByRole('button', { name: 'Accept all → schedule' }).click();
  await expect(body.getByRole('columnheader', { name: 'Planting date' })).toBeVisible();

  const sos = body.getByTestId('wizard-seed-or-seedling');
  await expect(sos).toBeVisible();
  await expect(sos.getByRole('button', { name: 'Seedling', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  await footer.getByRole('button', { name: /^Accept dates → inputs plan/ }).click();
  await expect(body.getByRole('button', { name: /Accept and commit/ })).toBeVisible();
  const posts: Array<Promise<{ status: number; req: Record<string, unknown>; id: string }>> = [];
  page.on('response', (r) => {
    if (/\/api\/blocks\/[^/]+\/plantings$/.test(r.url()) && r.request().method() === 'POST') {
      posts.push(
        r.json().then((b: { planting: { id: string } }) => ({
          status: r.status(),
          req: JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>,
          id: b.planting.id
        }))
      );
    }
  });
  const committed = page.waitForResponse((r) => r.url().endsWith('/api/plan/inputs/commit'));
  await body.getByRole('button', { name: /Accept and commit/ }).click();
  await committed;
  const done = await Promise.all(posts);
  expect(done.length).toBeGreaterThan(0);
  for (const p of done) {
    expect(p.status).toBe(201);
    expect(p.req).toMatchObject({ establishment: 'transplant', startIndoors: true });
    const tasks = await seedStartTasks(page, p.id);
    expect(tasks.map((t) => t.pluginTemplateKey?.split(':')[2])).toEqual([
      'sow',
      'harden',
      'transplant'
    ]);
  }
});

test('Done on a Sow indoors task offers Log the tray, which saves with the default date', async ({
  page
}) => {
  await signInNewUser(page, 'logtray');
  await createOnboardedFarm(page, { growing: ['garden'] });
  const o = originOf(page);
  const post = async <T>(url: string, data: Record<string, unknown>): Promise<T> => {
    const res = await page.request.post(url, { data, headers: { origin: o } });
    expect(res.status(), `${url}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()) as T;
  };
  const area = await post<{ field: { id: string } }>('/api/fields', {
    name: 'Kitchen garden',
    kind: 'garden',
    widthFt: 20,
    lengthFt: 30
  });
  const bed = await post<{ block: { id: string } }>('/api/blocks', {
    name: 'Bed 1',
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8,
    fieldId: area.field.id
  });
  const planting = await post<{ planting: { id: string } }>(
    `/api/blocks/${bed.block.id}/plantings`,
    {
      cropPluginId: 'cabbage-red-acre',
      plantingDate: Date.now() + 34 * 86_400_000,
      establishment: 'transplant',
      startIndoors: true
    }
  );
  const cropId = planting.planting.id;

  await page.goto('/today');
  await page.waitForLoadState('networkidle');
  const done = page.getByRole('button', { name: /^Done: Sow .*indoors/ }).first();
  await expect(done).toBeVisible();
  await done.click();
  await page.getByRole('button', { name: 'Done, skip time' }).click();
  const prompt = page.getByTestId('log-tray-prompt');
  await expect(prompt).toBeVisible();
  const link = prompt.getByRole('link', { name: 'Log the tray' });
  await expect(link).toHaveAttribute('href', new RegExp(`/cards/planting/pl_${cropId}#log-tray$`));
  await link.click();
  await page.waitForLoadState('networkidle');

  const panel = page.getByTestId('seed-start-panel');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/seed-starts') && r.request().method() === 'POST'
  );
  await panel.getByRole('button', { name: 'Save tray' }).click();
  expect((await saved).status()).toBe(201);
});
