import { expect, test } from './lib/test';
import type { Page } from '@playwright/test';
import { provisionEmptyFarm } from './lib/freshFarm';
import { createOnboardedFarm, signInNewUser } from './lib/newOwner';

// Phase 32B persona journeys, through the UI: the garden household (a dog,
// two cats and four hens from the onboarding tiles, never "livestock") and
// the small farm (12 ewes, a ram and a family cow, then the ewes move).

type Area = { id: string; name: string; kind: string };

async function areaNamed(page: Page, name: string): Promise<Area> {
  const res = await page.request.get('/api/fields');
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { fields?: Area[] } | Area[];
  const all = Array.isArray(body) ? body : (body.fields ?? []);
  const area = all.find((a) => a.name === name);
  expect(area, `Area ${name}`).toBeTruthy();
  return area!;
}

async function noLivestock(page: Page, where: string) {
  await page.waitForLoadState('networkidle');
  expect((await page.locator('body').innerText()).toLowerCase(), where).not.toContain('livestock');
}

async function addPlace(page: Page, kind: string, name: string) {
  await page.getByRole('button', { name: 'Add a new place' }).click();
  const panel = page.getByRole('group', { name: 'New place' });
  await panel.getByRole('radio', { name: new RegExp(`^${kind} `) }).check();
  await panel.getByLabel('What do you call it?').fill(name);
  await panel.getByRole('button', { name: 'Add this place' }).click();
  await expect(panel).toHaveCount(0);
}

test.describe('persona journeys', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a garden household adds a dog, two cats and four hens and never sees "livestock"', async ({
    page
  }) => {
    await signInNewUser(page, 'household');
    await createOnboardedFarm(page);

    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    const tiles = page.getByRole('group', { name: 'Any animals?' });
    await tiles.getByText('Pets', { exact: true }).click();
    await tiles.getByText('Backyard chickens', { exact: true }).click();
    await page.getByRole('button', { name: /Take me to Today/ }).click();
    await expect(page).toHaveURL(/\/today$/);

    await page.goto('/animals');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1, name: 'Pets & animals' })).toBeVisible();
    await page.getByRole('button', { name: 'Add your first animal' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add an animal' });
    await sheet.getByLabel('Dogs', { exact: true }).check();
    await sheet.getByLabel('Name', { exact: true }).fill('Biscuit');
    await sheet.getByRole('button', { name: 'Add this animal' }).click();
    await page.waitForURL(/\/animals\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Biscuit' })).toBeVisible();
    const dogPage = page.url();

    await page.goto('/animals/add');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Cats', { exact: true }).check();
    await page.getByLabel('Name', { exact: true }).fill('Mittens');
    await addPlace(page, 'House', 'Our house');
    await expect(page.getByLabel(/Where does it live/)).toHaveValue(/.+/);
    await page.getByRole('button', { name: 'Add this animal' }).click();
    await page.waitForURL(/\/animals\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Mittens' })).toBeVisible();
    const catPage = page.url();

    const house = await areaNamed(page, 'Our house');
    expect(house.kind).toBe('residence');
    await page.goto('/animals/add');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Cats', { exact: true }).check();
    await page.getByLabel('Name', { exact: true }).fill('Pepper');
    await page.getByLabel(/Where does it live/).selectOption(house.id);
    await page.getByRole('button', { name: 'Add this animal' }).click();
    await page.waitForURL(/\/animals\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Pepper' })).toBeVisible();

    const coop = await areaNamed(page, 'Chicken Coop');
    await page.goto('/animals/add');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Chickens', { exact: true }).check();
    await page.getByLabel('How many?').fill('4');
    await page.getByLabel(/What do you call this flock/).fill('Hens');
    await page.getByLabel(/Where do they live/).selectOption(coop.id);
    await page.getByRole('button', { name: 'Add this flock' }).click();
    await page.waitForURL(/\/animals\/groups\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Hens' })).toBeVisible();
    await expect(page.getByText('4 chickens')).toBeVisible();
    const henPage = page.url();

    await page.goto('/animals');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('link', { name: /Biscuit/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Mittens/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Pepper/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Hens/ })).toBeVisible();
    await noLivestock(page, '/animals');
    for (const url of [dogPage, catPage, henPage, '/animals/add']) {
      await page.goto(url);
      await noLivestock(page, url);
    }

    await page.goto('/plan/farm');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Open the card for Our house', exact: true }).click();
    const card = page.getByTestId('area-card-sheet');
    await expect(card.getByText('Lives here')).toBeVisible();
    await expect(card.getByText(/Mittens/)).toBeVisible();
    await expect(card.getByText(/Pepper/)).toBeVisible();
    expect((await card.innerText()).toLowerCase()).not.toContain('livestock');
  });

  test('a small farm houses 12 ewes, a ram and a family cow, then moves the ewes', async ({
    page
  }) => {
    await provisionEmptyFarm(page);

    await page.goto('/animals/add');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Sheep', { exact: true }).check();
    await expect(page.getByLabel('How many?')).toBeVisible();
    await page.getByLabel('How many?').fill('12');
    await page.getByLabel(/What do you call this flock/).fill('Ewes');
    await addPlace(page, 'Barn', 'Red barn');
    await page.getByRole('button', { name: 'Add this flock' }).click();
    await page.waitForURL(/\/animals\/groups\/[^/]+$/);
    await expect(page.getByText('12 sheep')).toBeVisible();
    const ewesId = page.url().split('/animals/groups/')[1];
    const barn = await areaNamed(page, 'Red barn');

    await page.goto('/animals/add');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Sheep', { exact: true }).check();
    await page.getByLabel('One animal').check();
    await page.getByLabel('Name', { exact: true }).fill('Samson');
    await page.getByLabel('Tag', { exact: true }).fill('1');
    await page.getByLabel(/Where does it live/).selectOption(barn.id);
    await page.getByRole('button', { name: 'Add this animal' }).click();
    await page.waitForURL(/\/animals\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Samson' })).toBeVisible();
    const ramId = page.url().split('/animals/')[1];

    await page.goto('/animals/add');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Cattle', { exact: true }).check();
    await page.getByLabel('One animal').check();
    await page.getByLabel('Name', { exact: true }).fill('Daisy');
    await addPlace(page, 'Pasture', 'Home pasture');
    await page.getByRole('button', { name: 'Add this animal' }).click();
    await page.waitForURL(/\/animals\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Daisy' })).toBeVisible();
    const pasture = await areaNamed(page, 'Home pasture');
    expect(pasture.kind).toBe('pasture');

    await page.goto('/animals');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1, name: 'Animals' })).toBeVisible();
    await expect(page.getByText(/14\s+animals here/)).toBeVisible();

    await page.goto(`/animals/groups/${ewesId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Move' }).click();
    await page.getByLabel('Move to').selectOption(pasture.id);
    await page.getByRole('button', { name: 'Save the move' }).click();
    await expect
      .poll(async () => {
        const res = await page.request.get(`/api/animal-groups/${ewesId}`);
        return ((await res.json()) as { group: { housingFieldId: string | null } }).group
          .housingFieldId;
      })
      .toBe(pasture.id);
    const ram = (await (await page.request.get(`/api/animals/${ramId}`)).json()) as {
      animal: { housingFieldId: string | null };
    };
    expect(ram.animal.housingFieldId).toBe(barn.id);
  });
});
