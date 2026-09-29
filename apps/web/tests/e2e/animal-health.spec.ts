import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

// Phase 32C (cluster C3): the withdrawal gate on eggs, through the pages.
// No animal-health product ships with sourced numbers yet, so the owner
// types the egg withdrawal read from the label.

const PHONE = { width: 375, height: 800 };

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

async function flockWithHen(page: Page) {
  const out = await post<{ group: { id: string }; members: { id: string }[] }>(
    page,
    '/api/animal-groups',
    { name: 'Backyard hens', speciesId: 'chicken', headCount: 4, members: [{ name: 'Pearl' }] }
  );
  return { groupId: out.group.id, henId: out.members[0].id };
}

test.describe('animal health records', () => {
  test.describe.configure({ timeout: 180_000 });

  test('treating one hen holds the flock eggs until the clear date, and discard still saves', async ({
    page,
    browser
  }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    const { groupId, henId } = await flockWithHen(page);

    await open(page, `/animals/${henId}/health`);
    await page.getByRole('button', { name: 'Record a treatment or visit' }).click();
    const form = page.getByRole('form', { name: 'Record health' });
    await form.getByLabel('Wormer', { exact: true }).check();
    await form.getByRole('textbox', { name: /^Product/ }).fill('Farm store wormer');
    await form.getByLabel('How it was given').selectOption('oral');
    await form.getByLabel('As the label says', { exact: true }).check();
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await expect(page.getByText('HOLD eggs: withdrawal not known')).toBeVisible();
    await noHorizontalOverflow(page);

    await page.getByRole('button', { name: 'Add withdrawal' }).click();
    const entry = page.getByRole('form', { name: 'Add a withdrawal' });
    await entry.getByLabel('Which food').selectOption('eggs');
    await entry.getByLabel('How long').fill('7');
    await entry.getByLabel(/The label names this animal/).check();
    await entry.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Withdrawal added.' })).toBeVisible();

    await open(page, `/animals/groups/${groupId}`);
    const chip = page.getByTestId('hold-chips');
    await expect(chip).toContainText(/HOLD eggs until \w{3}, \w{3} \d{1,2}, \d{4}/);
    await noHorizontalOverflow(page);

    await open(page, `/animals/${groupId}/log`);
    const log = page.getByRole('form', { name: 'Log eggs, milk or a weight' });
    await log.getByLabel('How much').fill('9');
    await log.getByLabel('For the table', { exact: true }).check();
    await log.getByRole('button', { name: 'Save' }).click();
    const stop = page.getByRole('dialog', { name: 'Still in its withdrawal time' });
    await expect(stop).toBeVisible();
    await expect(stop.getByTestId('food-stop')).toContainText('Clear from');
    await expect(stop).toContainText('cannot be overridden');
    await expect(page.getByTestId('log-status')).toContainText('Stopped:');
    await noHorizontalOverflow(page);
    await stop.getByRole('button', { name: 'Save as discarded' }).click();
    await expect(stop).toBeHidden();
    await expect(page.getByTestId('log-status')).toContainText('Saved as thrown out.');
    await expect(page.getByText('Thrown out', { exact: true }).last()).toBeVisible();

    const helper = await provisionHelper(page, browser);
    await helper.setViewportSize(PHONE);
    await open(helper, `/animals/${henId}/health`);
    await expect(helper.getByRole('button', { name: 'Add withdrawal' })).toHaveCount(0);
    await expect(helper.getByText(/Ask the owner/).first()).toBeVisible();
    const refused = await helper.request.post('/api/animals/production/record', {
      data: {
        subjectType: 'group',
        subjectId: groupId,
        kind: 'eggs',
        quantity: 6,
        unit: 'eggs',
        use: 'food'
      },
      headers: { origin: originOf(helper) }
    });
    expect(refused.status()).toBe(422);
    expect(await refused.json()).toMatchObject({ resubmitAs: 'discard', overridable: false });
    await helper.context().close();
  });

  test('a household vet visit for the dog shows no lock and no withdrawal', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    const { animal } = await post<{ animal: { id: string } }>(page, '/api/animals', {
      speciesId: 'dog',
      name: 'Biscuit'
    });

    await open(page, `/animals/${animal.id}/health`);
    await page.getByRole('button', { name: 'Record a treatment or visit' }).click();
    const form = page.getByRole('form', { name: 'Record health' });
    await form.getByLabel('Vet visit', { exact: true }).check();
    await form.getByRole('textbox', { name: /^Vet/ }).fill('Dr. Lane');
    await form.getByLabel(/Notes/).fill('Yearly checkup and shots');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await expect(page.getByTestId('health-row')).toContainText('Vet visit');
    await expect(page.getByTestId('health-row')).toContainText('Dr. Lane');

    await page.getByRole('button', { name: 'Record a treatment or visit' }).click();
    const shot = page.getByRole('form', { name: 'Record health' });
    await shot.getByLabel('Vaccine', { exact: true }).check();
    await shot.getByRole('textbox', { name: /^Product/ }).fill('Rabies vaccine');
    await expect(shot.getByText('Used how?')).toHaveCount(0);
    await shot.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

    await page.getByRole('button', { name: 'Record a treatment or visit' }).click();
    const medicine = page.getByRole('form', { name: 'Record health' });
    await medicine.getByLabel('Vet visit', { exact: true }).check();
    await medicine.getByRole('textbox', { name: /^Medicine given/ }).fill('Rimadyl');
    await medicine.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('health-row')).toHaveCount(3);

    const text = (await page.locator('main').innerText()).toLowerCase();
    expect(text).not.toContain('withdrawal');
    expect(text).not.toContain('locked');
    expect(text).not.toMatch(/\bhold\b/);
    await expect(page.getByTestId('hold-chips')).toHaveCount(0);
    await noHorizontalOverflow(page);

    await open(page, `/animals/${animal.id}`);
    await expect(page.getByTestId('hold-chips')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Health' })).toBeVisible();
  });

  test('the family cow: the vet milk withdrawal shows when milk can go back in the house', async ({
    page,
    browser
  }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    const { animal } = await post<{ animal: { id: string } }>(page, '/api/animals', {
      speciesId: 'cattle',
      name: 'Clover',
      sex: 'female'
    });

    await open(page, `/animals/${animal.id}/health`);
    await page.getByRole('button', { name: 'Record a treatment or visit' }).click();
    const form = page.getByRole('form', { name: 'Record health' });
    await form.getByLabel('Treatment', { exact: true }).check();
    await form.getByRole('textbox', { name: /^Product/ }).fill('Vet-prescribed antibiotic');
    await form.getByLabel('How it was given').selectOption('injection-im');
    await form.getByLabel('My vet directed it', { exact: true }).check();
    await form.getByRole('textbox', { name: /^Vet/ }).fill('Dr. Reyes');
    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/api/animals/health/record') && r.request().method() === 'POST'
    );
    await form.getByRole('button', { name: 'Save' }).click();
    const eventId = ((await (await saved).json()) as { event: { id: string } }).event.id;
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await expect(page.getByText('HOLD milk: withdrawal not known')).toBeVisible();
    await expect(page.getByText(/HOLD eggs/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Add withdrawal' }).click();
    const entry = page.getByRole('form', { name: 'Add a withdrawal' });
    await entry.getByLabel('From my vet', { exact: true }).check();
    await entry.getByLabel('Which food').selectOption('milk');
    await entry.getByLabel('How long').fill('4');
    await entry.getByRole('textbox', { name: 'Vet' }).fill('Dr. Reyes');
    await entry.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Withdrawal added.' })).toBeVisible();

    await open(page, `/animals/${animal.id}`);
    await expect(page.getByTestId('hold-chips')).toContainText(
      /HOLD milk until \w{3}, \w{3} \d{1,2}, \d{4}/
    );
    await noHorizontalOverflow(page);

    const helper = await provisionHelper(page, browser);
    await helper.setViewportSize(PHONE);
    await open(helper, `/animals/${animal.id}/health`);
    await expect(helper.getByRole('button', { name: 'Add withdrawal' })).toHaveCount(0);
    await expect(helper.getByText(/Ask the owner/).first()).toBeVisible();
    const refused = await helper.request.post(`/api/animals/health/${eventId}/entries`, {
      data: { kind: 'vet', food: 'milk', amount: 1, unit: 'days', vetName: 'Dr. Reyes' },
      headers: { origin: originOf(helper) }
    });
    expect(refused.status()).toBe(403);
    await helper.context().close();
  });
});
