import { test, expect } from './lib/test';
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
  // The day as a deck, with the legacy schedule tabs folded into its filters
  const deck = page.getByTestId('today-deck');
  await expect(deck.getByRole('heading', { name: "Today's work" })).toBeVisible();
  await expect(page.locator('details.legacy-detail')).toHaveCount(0);
  // Week is a calendar view next to the Day cards
  await deck.getByRole('button', { name: 'Week', exact: true }).click();
  await expect(page).toHaveURL(/view=week/);
  await expect(page.getByTestId('calendar-week')).toBeVisible();
  // Season-at-a-glance
  await expect(page.getByText('Season at a glance')).toBeVisible();
  // App data moved to Settings > Advanced (#470)
  await expect(page.getByTestId('today-gear')).toHaveCount(0);

  // Only flag console errors that aren't pre-existing 404s for fonts/manifest
  // (Phase 25a self-host work still pending).
  const real = consoleErrors.filter((m) => !/Failed to load resource.*404/.test(m));
  expect(real).toEqual([]);
});
