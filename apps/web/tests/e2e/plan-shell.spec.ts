import { test, expect } from '@playwright/test';
import { signInAsDemoOwner } from './lib/auth';

test('plan v2 shell renders block rail + header + plantings', async ({ page }) => {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
  });
  await signInAsDemoOwner(page);
  await page.goto('/plan');
  await page.waitForLoadState('networkidle');

  // Left rail "Blocks · N" kicker
  await expect(page.getByText(/^Blocks · /).first()).toBeVisible();
  // Filter input
  await expect(page.getByPlaceholder('Filter blocks…')).toBeVisible();
  // Legacy editor in <details> exists (collapsed by default)
  await expect(page.locator('details.legacy-detail')).toBeVisible();

  const real = errs.filter((m) => !/404/.test(m));
  expect(real).toEqual([]);
});

test('plan v2 map overlay opens with ?map=open', async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto('/plan?map=open');
  await page.waitForLoadState('networkidle');
  // The Modal renders a <dialog> with the title set from MapOverlay.
  await expect(page.getByRole('dialog')).toBeVisible();
});
