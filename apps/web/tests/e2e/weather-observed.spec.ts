import { expect, test } from './lib/test';
import { signInAsDemoOwner } from './lib/auth';

test('observed-weather endpoint requires a session', async ({ request }) => {
  const res = await request.get(`/api/weather/observed?from=${Date.now() - 86_400_000}`);
  expect(res.status()).toBe(401);
});

test('observed-weather endpoint rejects a missing or out-of-range start', async ({ page }) => {
  await signInAsDemoOwner(page);
  for (const from of ['', 'abc', String(Date.now() + 86_400_000), '0']) {
    const res = await page.request.get(`/api/weather/observed?from=${from}`);
    expect(res.status(), `from=${from}`).toBe(400);
  }
});

test('/plan/wheat renders for the demo owner', async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto('/plan/wheat');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
