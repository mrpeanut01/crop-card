import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

// Phase 32B (cluster B4): the animal tiles on onboarding screen 2, the
// "Add your animals" Getting Started item, the coop_pen Area kind and the
// housed-animals list on the Area Card sheet.

type Area = { id: string; name: string; kind: string; details?: Record<string, unknown> | null };

async function areas(page: import('@playwright/test').Page): Promise<Area[]> {
  const res = await page.request.get('/api/fields');
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { fields?: Area[] } | Area[];
  return Array.isArray(body) ? body : (body.fields ?? []);
}

test.describe('animals on onboarding and Areas', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a household picks Pets and Backyard chickens and gets a coop, no livestock wording', async ({
    page
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signInNewUser(page, 'hens');
    await createOnboardedFarm(page);

    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('What are you growing on?');
    const animals = page.getByRole('group', { name: 'Any animals?' });
    await expect(animals).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375
    );
    expect(await page.locator('main, body').first().innerText()).not.toMatch(/livestock/i);

    const go = page.getByRole('button', { name: /Take me to Today/ });
    await expect(go).toBeDisabled();
    await animals.getByText('Pets', { exact: true }).click();
    await animals.getByText('Backyard chickens', { exact: true }).click();
    await expect(go).toBeEnabled();
    await go.click();
    await expect(page).toHaveURL(/\/today$/);

    const card = page.getByTestId('getting-started');
    await expect(card).toBeVisible();
    const item = card.locator('[data-item="animals"]');
    await expect(item).toContainText('Add your animals');
    await expect(item).not.toContainText('(done)');
    await expect(card.locator('[data-item="equipment"]')).toHaveCount(0);

    const made = await areas(page);
    expect(made.map((a) => [a.name, a.kind])).toEqual([['Chicken Coop', 'coop_pen']]);

    const flock = await page.request.post('/api/animal-groups', {
      data: { name: 'Hens', speciesId: 'chicken', headCount: 4, housingFieldId: made[0].id },
      headers: { origin: originOf(page) }
    });
    expect(flock.ok(), await flock.text()).toBe(true);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(card.locator('[data-item="animals"]')).toContainText('(done)');
  });

  test('a farm without animal tiles never sees the animals item', async ({ page }) => {
    await signInNewUser(page, 'noanimals');
    await createOnboardedFarm(page, { growing: ['fields'] });
    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('getting-started')).toBeVisible();
    await expect(page.locator('[data-item="animals"]')).toHaveCount(0);
  });

  test('a coop or pen is added with a capacity and its card lists who lives there', async ({
    page
  }) => {
    await signInNewUser(page, 'coop');
    await createOnboardedFarm(page, { growing: ['fields'] });
    await page.goto('/plan/farm?mode=sketch');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '+ Add' }).click();
    const drawer = page.getByRole('dialog', { name: 'Add to map' });
    await drawer.getByRole('button', { name: /^Coop or pen/ }).click();
    const form = page.getByTestId('sketch-add-field');
    await expect(form.getByRole('heading', { name: /Add a coop or pen/ })).toBeVisible();
    await form.getByLabel('Name').fill('Hen House');
    await form.getByLabel('Width (ft)').fill('10');
    await form.getByLabel('Length (ft)').fill('12');
    await form.getByLabel('Holds up to').fill('24');
    await form.getByRole('button', { name: 'Add coop or pen' }).click();

    // The click posts the Area; read it back once the save has landed.
    await expect
      .poll(async () => (await areas(page)).find((a) => a.name === 'Hen House'))
      .toMatchObject({ kind: 'coop_pen', details: { capacity: 24 } });
    const coop = (await areas(page)).find((a) => a.name === 'Hen House');

    const flock = await page.request.post('/api/animal-groups', {
      data: { name: 'Layers', speciesId: 'chicken', headCount: 26, housingFieldId: coop!.id },
      headers: { origin: originOf(page) }
    });
    expect(flock.ok(), await flock.text()).toBe(true);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Open the card for Hen House' }).first().click();
    const sheet = page.getByTestId('area-card-sheet');
    await expect(sheet).toHaveAttribute('data-area-kind', 'coop_pen');
    await expect(sheet.getByText('Lives here')).toBeVisible();
    await expect(sheet.getByText('Layers · 26 chickens · food animals')).toBeVisible();
    await expect(sheet.getByText('Over capacity (26 of 24)')).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Open Animals' })).toHaveAttribute(
      'href',
      '/animals'
    );
  });
});
