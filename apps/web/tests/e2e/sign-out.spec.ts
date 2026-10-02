import { signInAsDemoOwner } from './lib/auth';
import { expect, test } from './lib/test';

test('the avatar menu signs out and returns to the sign-in page', async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto('/today');
  // A click before hydration lands on the server-rendered button with no
  // handler, so the menu never opens.
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Account', { exact: true }).click();
  const signOut = page.getByRole('button', { name: 'Sign out' });
  await expect(signOut).toBeVisible();
  await signOut.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel('Account', { exact: true })).toHaveCount(0);

  await page.goto('/today');
  await expect(page).not.toHaveURL(/\/today/);
});
