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
});
