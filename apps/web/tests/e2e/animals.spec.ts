import { expect, test } from './lib/test';
import type { Page } from '@playwright/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

async function addPlace(page: Page, name: string, kind: string): Promise<string> {
  const res = await page.request.post('/api/fields', {
    data: { name, kind },
    headers: { origin: originOf(page) }
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { field: { id: string } }).field.id;
}

async function addFlockOf24(page: Page): Promise<string> {
  await page.goto('/animals/add');
  await page.getByLabel('Chickens').check();
  await expect(page.getByText('Food animal', { exact: true })).toBeVisible();
  await page.getByLabel('How many?').fill('24');
  await page.getByLabel(/What do you call this flock/).fill('Layers');
  await page.getByRole('button', { name: 'Add a new place' }).click();
  await page.getByLabel('Coop or pen').check();
  await page.getByLabel('What do you call it?').fill('Hen house');
  await page.getByRole('button', { name: 'Add this place' }).click();
  await expect(page.getByLabel(/Where do they live/)).toHaveValue(/.+/);
  await page.getByRole('button', { name: 'Add this flock' }).click();
  await page.waitForURL(/\/animals\/groups\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Layers' })).toBeVisible();
  await expect(page.getByText('24 chickens')).toBeVisible();
  const fields = (await (await page.request.get('/api/fields')).json()) as {
    fields: { name: string; kind: string }[];
  };
  expect(fields.fields.find((f) => f.name === 'Hen house')?.kind).toBe('coop_pen');
  return page.url().split('/animals/groups/')[1];
}

test('an owner adds 24 layers, a helper moves them offline and the move replays once', async ({
  page,
  browser
}) => {
  await provisionEmptyFarm(page);
  const groupId = await addFlockOf24(page);
  const pastureId = await addPlace(page, 'Back pasture', 'pasture');

  await page.goto('/animals');
  await expect(page.getByRole('heading', { level: 1, name: 'Animals' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Layers/ })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Animals', exact: true })
  ).toHaveCount(1);

  const helper = await provisionHelper(page, browser);
  await helper.goto(`/animals/groups/${groupId}`);
  await helper.waitForLoadState('networkidle');
  await expect(helper.getByRole('heading', { name: 'Owner settings' })).toHaveCount(0);

  await helper.context().setOffline(true);
  await helper.getByRole('button', { name: 'Move' }).click();
  await helper.getByLabel('Move to').selectOption(pastureId);
  await helper.getByRole('button', { name: 'Save the move' }).click();
  await expect(helper.getByText('Saved on this phone')).toBeVisible();

  await helper.context().setOffline(false);
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/animal-groups/${groupId}`);
        const body = (await res.json()) as {
          group: { housingFieldId: string | null };
          locations: unknown[];
        };
        return { at: body.group.housingFieldId, stays: body.locations.length };
      },
      { timeout: 20_000 }
    )
    .toEqual({ at: pastureId, stays: 2 });

  await helper.reload();
  await helper.waitForLoadState('networkidle');
  const res = await page.request.get(`/api/animal-groups/${groupId}`);
  expect(((await res.json()) as { locations: unknown[] }).locations).toHaveLength(2);
  await helper.context().close();
});

test('a helper can move and record changes but not add, edit or change flags', async ({
  page,
  browser
}) => {
  await provisionEmptyFarm(page);
  const groupId = await addFlockOf24(page);
  const helper = await provisionHelper(page, browser);

  await helper.goto('/animals/add');
  await expect(helper.getByText(/Ask the owner to add animals/)).toBeVisible();
  await helper.goto('/animals');
  await expect(helper.getByRole('link', { name: 'Add', exact: true })).toHaveCount(0);

  await helper.goto(`/animals/groups/${groupId}`);
  await expect(helper.getByRole('button', { name: 'Move' })).toBeVisible();
  await expect(helper.getByRole('button', { name: 'Record a change' })).toBeVisible();
  await expect(helper.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(helper.getByRole('button', { name: /food animal/i })).toHaveCount(0);
  await expect(helper.getByRole('button', { name: 'Delete' })).toHaveCount(0);

  await helper.getByRole('button', { name: 'Record a change' }).click();
  await helper.getByLabel('Died').check();
  await helper.getByLabel('How many?').fill('2');
  await helper.getByLabel(/Why\?/).fill('Fox');
  await helper.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(helper.getByText('Recorded 2 died.')).toBeVisible();
  await expect(helper.getByText('22 chickens')).toBeVisible();
  await expect(helper.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await helper.context().close();
});

test('an owner records an animal as rehomed and can undo it inside the lock window', async ({
  page
}) => {
  await provisionEmptyFarm(page);
  await page.goto('/animals/add');
  await page.getByLabel('Horses').check();
  await page.getByLabel('One animal').check();
  await page.getByLabel('Name', { exact: true }).fill('Duke');
  await page.getByRole('button', { name: 'Add this animal' }).click();
  await page.waitForURL(/\/animals\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Duke' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark not for slaughter' })).toBeVisible();

  await page.getByRole('button', { name: 'Record a change' }).click();
  await page.getByLabel('Rehomed').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('No longer here', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move' })).toHaveCount(0);

  await page.goto('/animals');
  await expect(page.getByText('No longer here (1)')).toBeVisible();

  await page.goBack();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Move' })).toBeVisible();
});

test('a garden household sees Pets & animals, no tag field and never the word livestock', async ({
  page
}) => {
  await signInNewUser(page, 'pets');
  await createOnboardedFarm(page, { growing: ['garden'] });

  await page.goto('/animals');
  await expect(page.getByRole('heading', { level: 1, name: 'Pets & animals' })).toBeVisible();
  await page.getByRole('button', { name: 'Add your first animal' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add an animal' });
  await sheet.getByLabel('Dogs').check();
  await expect(sheet.getByLabel('Name', { exact: true })).toBeVisible();
  await expect(sheet.getByLabel(/^Tag/)).toHaveCount(0);
  await expect(sheet.getByText(/not food animals/)).toBeVisible();
  await sheet.getByLabel('Name', { exact: true }).fill('Biscuit');
  await sheet.getByRole('button', { name: 'Add this animal' }).click();
  await page.waitForURL(/\/animals\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Biscuit' })).toBeVisible();

  await page.goto('/animals/add');
  await page.getByLabel('Chickens').check();
  await expect(page.getByText(/because people eat their eggs/)).toBeVisible();
  await page.getByLabel('How many?').fill('4');
  await page.getByRole('button', { name: 'Add this flock' }).click();
  await page.waitForURL(/\/animals\/groups\//);
  await expect(page.getByTestId('food-chip')).toBeVisible();

  await page.goto('/animals');
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Pets & animals' })
  ).toHaveCount(1);
  const individuals = page.getByRole('heading', { name: 'Your animals' });
  const flocks = page.getByRole('heading', { name: 'Flocks and groups' });
  const [a, b] = await Promise.all([individuals.boundingBox(), flocks.boundingBox()]);
  expect(a!.y).toBeLessThan(b!.y);
  for (const path of ['/animals', '/animals/add']) {
    await page.goto(path);
    expect((await page.locator('body').innerText()).toLowerCase()).not.toContain('livestock');
  }
});

test.describe('at 375px', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('/animals, the add form and a group page have no horizontal overflow', async ({ page }) => {
    await provisionEmptyFarm(page);
    const groupId = await addFlockOf24(page);
    for (const path of ['/animals', '/animals/add', `/animals/groups/${groupId}`]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      if (path === '/animals/add') await page.getByLabel('Chickens').check();
      if (path.startsWith('/animals/groups')) {
        await page.getByRole('button', { name: 'Move' }).click();
        await page.getByLabel('Some of them').check();
      }
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, path).toBeLessThanOrEqual(375);
    }
  });
});
