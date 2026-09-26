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
  // Week strip lives behind the deck's Calendar view
  await deck.getByRole('button', { name: 'Calendar' }).click();
  await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();
  // Season-at-a-glance
  await expect(page.getByText('Season at a glance')).toBeVisible();
  // Sprayers and the rules version stay on the page
  await expect(page.getByTestId('today-gear')).toContainText('Rules version');

  // Only flag console errors that aren't pre-existing 404s for fonts/manifest
  // (Phase 25a self-host work still pending).
  const real = consoleErrors.filter((m) => !/Failed to load resource.*404/.test(m));
  expect(real).toEqual([]);
});
