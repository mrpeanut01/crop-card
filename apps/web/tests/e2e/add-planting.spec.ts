import { test, expect } from './lib/test';
import { signInAsDemoOwner } from './lib/auth';

test('add planting: seed on hand first, date helper, planting vs bought', async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto('/plan');
  const origin = new URL(page.url()).origin;
  const stock = await page.request.post('/api/stock', {
    data: {
      category: 'seed',
      displayName: 'Basil Genovese 1/4 oz packet',
      shortName: 'Genovese Basil',
      defaultUnit: 'seeds',
      pluginId: 'basil-genovese'
    },
    headers: { origin }
  });
  expect(stock.ok()).toBe(true);
  const { item } = (await stock.json()) as { item: { id: string } };
  const lot = await page.request.post(`/api/stock/${item.id}/lots`, {
    data: { receivedQuantity: 200, unit: 'seeds' },
    headers: { origin }
  });
  expect(lot.ok()).toBe(true);

  await page.goto('/plan?tab=overview');
  await page.waitForLoadState('networkidle');
  await page
    .getByRole('button', { name: /Add planting/ })
    .first()
    .click();

  const dialog = page.getByRole('dialog', { name: 'Add planting' });
  const crop = dialog.getByRole('combobox', { name: 'Crop' });
  await expect(crop).toBeFocused();

  const list = dialog.getByRole('listbox');
  await expect(list.getByText('Your seed')).toBeVisible();
  await list.getByRole('option', { name: /Genovese Basil/ }).click();
  await expect(dialog).toContainText('Using your seed: 200 seeds on hand');
  await dialog.getByPlaceholder('Optional').first().fill('10');
  await expect(
    dialog.getByText('Comes out of your seed on hand first, then what is ordered or planned.')
  ).toBeVisible();
  await dialog.getByPlaceholder('Optional').first().fill('');
  await expect(dialog.getByText('what you purchased')).toHaveCount(0);

  await expect(dialog.getByRole('group', { name: 'Suggested planting dates' })).toBeVisible();

  await crop.fill('okra');
  await expect(list.getByRole('option', { name: /Okra Clemson/ })).toBeVisible();
  await crop.press('Enter');
  await expect(dialog.getByText('None of your seed is linked to this crop.')).toBeVisible();
  await expect(dialog.getByText('what goes in the ground')).toBeVisible();
  await expect(dialog.getByText('what you purchased')).toBeVisible();

  const prime = dialog.getByRole('button', { name: /Prime/ });
  await prime.click();
  const dateValue = await dialog.locator('#np-date').inputValue();
  expect(dateValue).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  await dialog.getByPlaceholder('Optional').first().fill('30');
  await dialog.getByLabel('Planting unit').selectOption('seeds');
  await dialog.getByPlaceholder('Optional').nth(1).fill('100');
  await expect(
    dialog.getByText('Adds this seed to inventory; the planting comes out of it.')
  ).toBeVisible();

  const created = page.waitForResponse(
    (r) => /\/api\/blocks\/[^/]+\/plantings$/.test(r.url()) && r.request().method() === 'POST'
  );
  await dialog.getByRole('button', { name: 'Add planting' }).click();
  const res = await created;
  expect(res.status()).toBe(201);
  const body = (await res.json()) as {
    purchased?: { stockItemId: string };
    decrement?: { fulfilled: number };
  };
  expect(body.purchased?.stockItemId).toBeTruthy();
  expect(body.decrement?.fulfilled).toBe(30);
  await expect(dialog).toBeHidden();
});

test('add planting offers seed that is only ordered, and sets it aside (#475)', async ({
  page
}) => {
  await signInAsDemoOwner(page);
  await page.goto('/plan');
  const origin = new URL(page.url()).origin;
  const stock = await page.request.post('/api/stock', {
    data: {
      category: 'seed',
      displayName: 'Cherokee Purple tomato',
      defaultUnit: 'seeds',
      pluginId: 'tomato-cherokee-purple'
    },
    headers: { origin }
  });
  expect(stock.ok()).toBe(true);
  const { item } = (await stock.json()) as { item: { id: string } };
  const lot = await page.request.post(`/api/stock/${item.id}/lots`, {
    data: { receivedQuantity: 50, unit: 'seeds', quantityStatus: 'ordered' },
    headers: { origin }
  });
  expect(lot.ok()).toBe(true);

  await page.goto('/plan?tab=overview');
  await page.waitForLoadState('networkidle');
  await page
    .getByRole('button', { name: /Add planting/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add planting' });
  const crop = dialog.getByRole('combobox', { name: 'Crop' });
  await crop.fill('cherokee');
  const list = dialog.getByRole('listbox');
  await expect(list.getByText('Your seed')).toBeVisible();
  await list.getByRole('option', { name: /Cherokee Purple tomato/ }).click();
  await expect(dialog).toContainText('Using your seed: 50 seeds ordered');
  await dialog.getByPlaceholder('Optional').first().fill('12');
  await expect(
    dialog.getByText('Set aside from the seed you have ordered or planned.')
  ).toBeVisible();

  const created = page.waitForResponse(
    (r) => /\/api\/blocks\/[^/]+\/plantings$/.test(r.url()) && r.request().method() === 'POST'
  );
  await dialog.getByRole('button', { name: 'Add planting' }).click();
  const res = await created;
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { decrement?: { fulfilled: number; shortfall: number } };
  expect(body.decrement).toEqual({ fulfilled: 12, shortfall: 0 });
});
