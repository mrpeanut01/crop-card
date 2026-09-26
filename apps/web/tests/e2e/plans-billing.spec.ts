import type { Page } from '@playwright/test';
import { signInAsDemoOwner } from './lib/auth';
import { provisionEmptyFarm } from './lib/freshFarm';
import { originOf } from './lib/newOwner';
import { expect, test } from './lib/test';

async function signInAs(page: Page, email: string): Promise<void> {
  const res = await page.request.post('/?/signin', {
    form: { email },
    headers: { 'x-sveltekit-action': 'true', origin: originOf(page) },
    maxRedirects: 0
  });
  const body = (await res.json()) as { location?: string };
  expect(body.location, `${email} should land on /today`).toBe('/today');
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
}

test.describe('public pricing page', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('compares the three plans at 375px without signing in', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Free for every farm');
    for (const plan of ['free', 'grower', 'farm']) {
      await expect(page.getByTestId(`plan-card-${plan}`)).toBeVisible();
    }
    await expect(page.getByTestId('interval-year')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('plan-card-grower')).toContainText('$8');
    await expect(page.getByTestId('plan-card-grower')).toContainText('billed $96 a year');
    await expect(page.getByTestId('plan-card-farm')).toContainText('$16');

    await page.getByTestId('interval-month').click();
    await expect(page.getByTestId('plan-card-grower')).toContainText('$10');
    await expect(page.getByTestId('plan-card-farm')).toContainText('$20');

    await expect(page.getByTestId('free-forever')).toContainText(
      'Free forever: records, safety, exports'
    );
    await expect(page.getByTestId('plan-cta-free')).toHaveAttribute('href', '/');
    await page.waitForLoadState('networkidle');
    await noHorizontalOverflow(page);
  });

  test('is linked from the landing page and the About page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'See plans and pricing' })).toHaveAttribute(
      'href',
      '/pricing'
    );
    await signInAsDemoOwner(page);
    await page.goto('/settings/about');
    await expect(page.getByRole('link', { name: 'See plans and pricing' })).toHaveAttribute(
      'href',
      '/pricing'
    );
  });
});

test.describe('plan & billing page', () => {
  test('a Free owner picks Grower monthly through a mocked Stripe checkout', async ({ page }) => {
    await signInAsDemoOwner(page);
    await page.goto('/settings/billing');
    await expect(page.getByTestId('current-plan')).toContainText('Free');
    await expect(page.getByTestId('free-forever')).toBeVisible();
    await expect(page.getByTestId('plan-card-free')).toContainText('Your plan');

    let sent: unknown = null;
    await page.route('**/api/billing/checkout', async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: '/settings/billing?checkout=success' })
      });
    });

    await page.getByTestId('interval-month').click();
    await page.getByTestId('plan-cta-grower').click();
    await expect(page.getByText('Checkout complete.')).toBeVisible();
    expect(sent).toEqual({ plan: 'grower', interval: 'month' });
  });

  test('the plan page and the alert settings link to each other', async ({ page }) => {
    await signInAsDemoOwner(page);
    await page.goto('/settings/billing');
    await page.getByRole('link', { name: 'Choose your alerts' }).click();
    await expect(page).toHaveURL(/\/settings\/notifications$/);
    await page.getByRole('link', { name: 'See your plan and billing' }).click();
    await expect(page).toHaveURL(/\/settings\/billing$/);
    await expect(page.getByTestId('current-plan')).toBeVisible();
  });

  test('yearly is the default period at checkout', async ({ page }) => {
    await signInAsDemoOwner(page);
    await page.goto('/settings/billing');
    let sent: unknown = null;
    await page.route('**/api/billing/checkout', async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: '/settings/billing?checkout=cancel' })
      });
    });
    await page.getByTestId('plan-cta-farm').click();
    await expect(page.getByText('Checkout canceled. Nothing was charged.')).toBeVisible();
    expect(sent).toEqual({ plan: 'farm', interval: 'year' });
  });

  test('a Grower owner switches plans through the billing portal', async ({ page }) => {
    await signInAs(page, 'grower@cropcard.local');
    await page.goto('/settings/billing');
    await expect(page.getByTestId('current-plan')).toContainText('Grower');
    await expect(page.getByTestId('current-plan')).toContainText('$96 a year');
    await expect(page.getByTestId('plan-card-grower')).toContainText('Your plan');

    let portalHits = 0;
    await page.route('**/api/billing/portal', async (route) => {
      portalHits += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: '/settings/billing?checkout=success' })
      });
    });
    await page.route('**/api/billing/checkout', (route) =>
      route.fulfill({ status: 500, body: 'checkout must not be used for a plan change' })
    );
    await expect(page.getByTestId('plan-cta-farm')).toHaveText('Switch to Farm');
    await page.getByTestId('plan-cta-farm').click();
    await expect(page.getByText('Checkout complete.')).toBeVisible();
    expect(portalHits).toBe(1);
  });
});

test.describe('AI limit', () => {
  test('a Free farm past its budget sees the upgrade prompt, and it leads to plans', async ({
    page
  }) => {
    await signInAs(page, 'capped@cropcard.local');
    const usage = await page.request.get('/api/ai/usage');
    expect(usage.ok()).toBe(true);
    const body = (await usage.json()) as { usage: { exhausted: boolean; plan: string } };
    expect(body.usage).toMatchObject({ exhausted: true, plan: 'free' });

    await page.goto('/settings/ai');
    const meter = page.getByTestId('ai-budget');
    await expect(meter.getByTestId('ai-limit-note')).toContainText(
      "You've used this month's AI help"
    );
    const upsell = meter.getByTestId('ai-upsell');
    await expect(upsell).toHaveText('More AI on Grower');
    await upsell.click();
    await expect(page).toHaveURL(/\/settings\/billing$/);
    await expect(page.getByTestId('plan-cta-grower')).toHaveText('Choose Grower');
  });

  test('the demo owner with budget left sees no upgrade prompt', async ({ page }) => {
    await signInAsDemoOwner(page);
    await page.goto('/settings/ai');
    await expect(page.getByTestId('ai-budget')).toBeVisible();
    await expect(page.getByTestId('ai-upsell')).toHaveCount(0);
  });
});

test.describe('helper seats', () => {
  test('invites stop at the plan seat limit and say helpers stay active', async ({ page }) => {
    await provisionEmptyFarm(page);
    const origin = originOf(page);
    for (let i = 0; i < 2; i++) {
      const res = await page.request.post('/api/invites', {
        data: { email: `seat-${i}-${Date.now()}@e2e.cropcard.local`, role: 'helper' },
        headers: { origin }
      });
      expect(res.ok(), await res.text()).toBe(true);
    }
    const third = await page.request.post('/api/invites', {
      data: { email: `seat-3-${Date.now()}@e2e.cropcard.local`, role: 'helper' },
      headers: { origin }
    });
    expect(third.status()).toBe(409);
    expect(await third.json()).toMatchObject({ error: 'seat-limit', limit: 2 });

    await page.goto('/settings/helpers');
    await expect(page.getByTestId('seat-limit')).toContainText(
      'Seat limit reached (grandfathered helpers stay active)'
    );
    await expect(page.getByRole('button', { name: /Invite helper/ })).toBeDisabled();
  });
});
