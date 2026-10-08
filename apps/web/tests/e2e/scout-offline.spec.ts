import { expect, test } from './lib/test';
import { signInAsDemoOwner } from './lib/auth';

test('a scout observation saved with no signal queues and uploads when back online', async ({
  page,
  context
}) => {
  await signInAsDemoOwner(page);
  await page.goto('/scout');
  await page.waitForLoadState('networkidle');

  await context.setOffline(true);
  await page.getByLabel('Spot 1: weeds in 10 sq ft').fill('7');
  await page.getByRole('button', { name: 'Save observation' }).click();

  await expect(page.getByText('saved on this phone', { exact: false })).toBeVisible();
  const queued = page.getByRole('list', { name: 'Saved on this device' });
  await expect(queued.getByText('Will save when online')).toBeVisible();

  await context.setOffline(false);
  await expect(queued).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText('No observations recorded for this block yet')).toHaveCount(0);
  await expect(page.getByTestId('scout-uploaded')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('saved on this phone', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Uploaded/ })).toBeVisible();
});

test('a plain note saves without any weed counts', async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto('/scout');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('FR-07')).toHaveCount(0);
  const save = page.getByRole('button', { name: 'Save observation' });
  await expect(save).toBeDisabled();
  const text = `Aphids on the kale ${Date.now()}`;
  await page.getByLabel(/What did you notice/).fill(text);
  await save.click();
  await expect(page.getByRole('button', { name: /Saved/ })).toBeVisible();
  await expect(page.getByText(text)).toBeVisible();
});

test('a pest count saves with its note and reads in words (#713 #731)', async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto('/scout');
  await page.waitForLoadState('networkidle');
  const pest = `squash bug ${Date.now()}`;
  const note = `Eggs under the leaves ${Date.now()}`;
  await page.getByLabel(/What did you notice/).fill(note);
  await page.getByLabel('Pest or disease', { exact: true }).fill(pest);
  await expect(page.getByTestId('scout-pest-no-threshold')).toBeVisible();
  await page.getByLabel('What you counted').selectOption('count-per-plant');
  await page.getByLabel('Count', { exact: true }).fill('4');
  await page.getByTestId('scout-pest-save').click();
  await expect(page.getByTestId('scout-saved')).toHaveText('Saved to the farm.');
  const row = page.locator('.history li', { hasText: pest });
  await expect(row).toContainText('Per plant');
  await expect(row).toContainText(note);
  await expect(page.locator('.history')).not.toContainText('count-per-plant');
});
