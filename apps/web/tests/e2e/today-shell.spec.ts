import { test, expect } from '@playwright/test';
import { signInAsDemoOwner } from './lib/auth';

test('today renders Almanac shell after sign-in', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  await signInAsDemoOwner(page);
  await page.goto('/today');
  await page.waitForLoadState('networkidle');

  // Greeting renders
  await expect(page.locator('h1')).toContainText(/Good (morning|afternoon|evening)/);
  // Quick actions card
  await expect(page.getByText('Quick actions')).toBeVisible();
  // Week strip header
  await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();
  // Season-at-a-glance
  await expect(page.getByText('Season at a glance')).toBeVisible();
  // Legacy details exists (collapsed by default)
  await expect(page.locator('details.legacy-detail')).toBeVisible();

  // Only flag console errors that aren't pre-existing 404s for fonts/manifest
  // (Phase 25a self-host work still pending).
  const real = consoleErrors.filter((m) => !/Failed to load resource.*404/.test(m));
  expect(real).toEqual([]);
});
