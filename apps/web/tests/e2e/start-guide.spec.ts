import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { signInAsDemoOwner } from './lib/auth';
import { en } from '../../src/lib/i18n/catalogs/en';
import { es } from '../../src/lib/i18n/catalogs/es';

const PORT = Number(process.env.E2E_PORT ?? 5173);
const MAGIC_BASE = `http://localhost:${Number(process.env.E2E_MAGIC_PORT ?? PORT + 1)}`;

test.use({ viewport: { width: 375, height: 800 } });

async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('public "How to start" guide', () => {
  test('a signed-out visitor goes from the landing page to the guide', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'What you can do' })).toBeVisible();
    for (const name of [
      'For your garden',
      'For your fields',
      'For animals',
      'For records and inspections'
    ]) {
      await expect(page.getByRole('heading', { name })).toBeVisible();
    }
    await expectNoOverflow(page);

    // The sign-in form stays within about one phone screen of the top, even
    // with the alpha notice still showing above it.
    const email = await page.getByLabel('Email', { exact: true }).boundingBox();
    expect(email?.y ?? Infinity).toBeLessThan(850);

    const link = page.getByRole('link', { name: 'Read how to start', exact: true });
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    await Promise.all([page.waitForURL(/\/start$/), link.click()]);
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveTitle(en['start.title']);
    await expect(page.getByRole('heading', { level: 1, name: 'How to start' })).toBeVisible();
    for (const track of ['garden', 'fields'] as const) {
      const section = page.getByTestId(`track-${track}`);
      await expect(section.getByRole('heading', { level: 2 })).toHaveText(
        en[`start.${track}.title`]
      );
      await expect(section.locator('ol.steps > li')).toHaveCount(8);
      await expect(section.getByText('In CropCard:')).toHaveCount(8);
    }
    await expect(page.getByRole('heading', { name: 'Words you will see' })).toBeVisible();
    await expect(page.getByText('Pre-harvest interval', { exact: true })).toBeVisible();
    await expectNoOverflow(page);

    await page.getByTestId('pick-fields').click();
    await expect(page).toHaveURL(/\/start#fields$/);

    await expect(page.getByRole('link', { name: 'Start free' })).toHaveAttribute(
      'href',
      '/#signin-title'
    );
    await expect(page.getByRole('link', { name: 'Try the demo farm' })).toHaveAttribute(
      'href',
      '/#demo-farm'
    );
    await expect(page.getByRole('link', { name: 'See plans and pricing' })).toHaveAttribute(
      'href',
      '/pricing'
    );
    await expect(page.getByRole('link', { name: 'Go to Today' })).toHaveCount(0);
  });

  test('the hero link also opens the guide', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('start-link')).toHaveAttribute('href', '/start');
    await expect(page.locator('#demo-farm')).toHaveAttribute('data-testid', 'demo-card');
  });

  test('a signed-in owner sees a way back to Today, not sign-up links', async ({ page }) => {
    await signInAsDemoOwner(page);
    await page.goto('/start');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1, name: 'How to start' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to Today' })).toHaveAttribute('href', '/today');
    await expect(page.getByRole('link', { name: 'Start free' })).toHaveCount(0);
    await expectNoOverflow(page);
  });

  test('the landing page and the guide render in Spanish with no sideways scroll', async ({
    browser
  }) => {
    const context = await browser.newContext({
      baseURL: MAGIC_BASE,
      locale: 'es-MX',
      extraHTTPHeaders: { 'Accept-Language': 'es-MX,es;q=0.9' },
      viewport: { width: 375, height: 800 }
    });
    const page = await context.newPage();

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('heading', { name: es['entry.land.do.title']! })).toBeVisible();
    await expect(page.getByText(en['entry.land.do.garden.1'])).toHaveCount(0);
    await expectNoOverflow(page);

    await page.goto('/start');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('heading', { level: 1, name: es['start.h1']! })).toBeVisible();
    await expect(page.getByText(es['start.fields.s7.title']!)).toBeVisible();
    await expect(page.getByText(en['start.garden.s1.title'])).toHaveCount(0);
    await expect(page.getByText('In CropCard:')).toHaveCount(0);
    await expectNoOverflow(page);
    await context.close();
  });
});
