import { signInAsDemoOwner } from './lib/auth';
import { expect, test } from './lib/test';

test.beforeEach(async ({ page }) => {
  await signInAsDemoOwner(page);
});

test('settings index counts the owner apart from helpers and lists Equipment', async ({ page }) => {
  await page.goto('/settings');
  const helpers = page.getByRole('link', { name: /Helpers & invites/ });
  await expect(helpers).toContainText('1 owner');
  await expect(helpers).toContainText(/\d+ helpers? · \d+ pending invites?/);
  await expect(page.getByRole('link', { name: /^Equipment/ })).toHaveAttribute(
    'href',
    '/settings/equipment'
  );
  await expect(page.getByRole('heading', { name: 'AI planning assistant' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Integrations/ })).toContainText('Claude API key');
});

test('integrations holds the Claude key form', async ({ page }) => {
  await page.goto('/settings/integrations');
  await expect(page.getByRole('heading', { name: 'Claude AI assistant' })).toBeVisible();
  await expect(page.getByLabel('Claude API key')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Usage & quotas' })).toHaveAttribute(
    'href',
    '/settings/ai'
  );
});

test('equipment settings groups sprayers under equipment', async ({ page }) => {
  await page.goto('/settings/equipment');
  await expect(page.getByRole('heading', { name: 'Equipment', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Sprayers & calibration/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Other equipment/ })).toBeVisible();
});

test('helpers page offers only Owner and Helper roles', async ({ page }) => {
  await page.goto('/settings/helpers');
  await expect(page.locator('.role-card')).toHaveCount(2);
  await expect(page.getByText('Inspector', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Invite helper/ }).click();
  await expect(page.locator('select[name="role"]')).toHaveCount(0);
});
