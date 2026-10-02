import type { Browser, Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

async function signInAs(page: Page, email: string, expected: string): Promise<void> {
  const res = await page.request.post('/?/signin', {
    form: { email },
    headers: { 'x-sveltekit-action': 'true', origin: originOf(page) },
    maxRedirects: 0
  });
  const body = (await res.json()) as { location?: string };
  expect(body.location).toBe(expected);
}

async function superadminPage(browser: Browser, baseURL: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  await signInAs(page, 'superadmin@cropcard.local', '/admin/owners');
  return page;
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('alpha notice on the landing page', () => {
  test('welcomes a signed-out visitor, points to sign-in, and stays dismissed', async ({
    page
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const banner = page.getByTestId('alpha-banner');
    await expect(banner).toContainText('alpha review');
    await expect(banner.getByRole('link', { name: 'sign in' })).toHaveAttribute(
      'href',
      '#signin-title'
    );
    await noHorizontalOverflow(page);
    await banner.getByRole('button', { name: 'Dismiss alpha notice' }).click();
    await expect(banner).toBeHidden();
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('alpha-banner')).toBeHidden();
  });
});

test.describe('first visit to /today', () => {
  test.use({ showAlphaWelcome: true });

  test('shows the alpha welcome once and leads to the feedback form', async ({ page }) => {
    await signInNewUser(page, 'welcome');
    await createOnboardedFarm(page, { growing: ['garden'] });
    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    const welcome = page.getByRole('dialog', { name: 'Welcome to CropCard' });
    await expect(welcome).toBeVisible();
    await welcome.getByRole('button', { name: 'Send feedback now' }).click();
    await expect(welcome).toBeHidden();

    const sheet = page.getByRole('dialog', { name: 'Send feedback' });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel('Idea or request').check();
    await sheet.getByRole('textbox').fill('Welcome note idea from e2e');
    await sheet.getByRole('button', { name: 'Send feedback' }).click();
    await expect(sheet.getByTestId('feedback-sent')).toContainText('Thanks');

    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    await expect(page.getByRole('dialog', { name: 'Welcome to CropCard' })).toBeHidden();
  });
});

test.describe('Send feedback from the app chrome', () => {
  test('a grower reports a bug at 375px and a superadmin triages it', async ({
    page,
    browser,
    baseURL
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signInNewUser(page, 'fbchrome');
    await createOnboardedFarm(page, { growing: ['garden'] });
    await page.goto('/plan?area=secret-id-123');
    await page.waitForLoadState('networkidle');
    await noHorizontalOverflow(page);

    await page.getByLabel('Account menu').click();
    const item = page.getByRole('button', { name: 'Send feedback' });
    const box = await item.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    await item.click();

    const sheet = page.getByRole('dialog', { name: 'Send feedback' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('public issue list on GitHub');
    await expect(sheet).toContainText('/plan');
    await expect(sheet).not.toContainText('secret-id-123');
    const message = `The plan page froze ${Date.now()}`;
    await sheet.getByRole('textbox').fill(message);
    await sheet.getByRole('button', { name: 'Send feedback' }).click();
    await expect(sheet.getByTestId('feedback-sent')).toBeVisible();
    await noHorizontalOverflow(page);
    await sheet.getByTestId('feedback-sent').getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();

    const admin = await superadminPage(browser, baseURL!);
    await admin.goto('/admin/feedback');
    await admin.waitForLoadState('networkidle');
    await expect(admin.getByText('Sending to GitHub is off.')).toBeVisible();
    const card = admin.getByTestId('feedback-item').filter({ hasText: message });
    await expect(card).toContainText('Something is broken');
    await expect(card).toContainText('/plan');
    await expect(card).not.toContainText('secret-id-123');
    await expect(card).toContainText('owner');
    await expect(card.getByRole('button', { name: 'Send to GitHub' })).toHaveCount(0);

    await admin.setViewportSize({ width: 375, height: 800 });
    const browserLabel = card.locator('dt', { hasText: 'Browser' });
    const labelBox = await browserLabel.boundingBox();
    expect(labelBox?.height ?? 99).toBeLessThan(30);
    await expect(card.locator('.ua dd')).not.toContainText('Mozilla');
    for (const link of await card.locator('.context a').all()) {
      expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    }
    await admin.setViewportSize({ width: 1280, height: 800 });

    await card.getByLabel('Status').selectOption('triaged');
    await card.getByLabel(/Notes/).fill('Seen on a phone, checking');
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(card.getByRole('status')).toHaveText('Saved.');

    await admin.goto('/admin/feedback?status=triaged');
    await admin.waitForLoadState('networkidle');
    const triaged = admin.getByTestId('feedback-item').filter({ hasText: message });
    await expect(triaged).toHaveAttribute('data-status', 'triaged');
    await expect(triaged.getByLabel(/Notes/)).toHaveValue('Seen on a phone, checking');

    await admin.goto('/admin/owners');
    await admin.waitForLoadState('networkidle');
    await expect(admin.getByRole('cell', { name: 'feedback_triage' }).first()).toBeVisible();
    await admin.context().close();
  });

  test('the account menu holds Send feedback on a desktop screen too', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signInNewUser(page, 'fbdesk');
    await createOnboardedFarm(page, { growing: ['garden'] });
    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Account menu').click();
    await page.getByRole('button', { name: 'Send feedback' }).click();
    await expect(page.getByRole('dialog', { name: 'Send feedback' })).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('every page is one menu away at laptop and tablet widths, with no More', async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInNewUser(page, 'fbwidths');
    await createOnboardedFarm(page, { growing: ['garden'] });
    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    const groups: Record<string, string[]> = {
      actions: ['Spray', 'Scout', 'Harvest'],
      farm: ['Inventory', 'Equipment'],
      records: ['Records', 'Cards']
    };
    for (const width of [1440, 1366, 1280, 1024, 960, 900, 800, 769]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);
      await expect(nav.getByText('More', { exact: true })).toHaveCount(0);
      const fits = await nav.evaluate((n) => n.scrollWidth <= n.clientWidth + 1);
      expect(fits, `nav fits at ${width}`).toBe(true);
      for (const name of ['Today', 'Plan']) {
        await expect(
          nav.locator('a.nav-link', { hasText: name }),
          `${name} at ${width}`
        ).toBeVisible();
      }
      for (const [id, names] of Object.entries(groups)) {
        const summary = nav.locator(`details[data-group="${id}"] > summary`);
        await expect(summary, `${id} at ${width}`).toBeVisible();
        await summary.click();
        for (const name of names) {
          const link = nav.locator(`details[data-group="${id}"] .menu-link`, { hasText: name });
          await expect(link, `${name} at ${width}`).toBeVisible();
          const box = (await link.boundingBox())!;
          expect(box.x + box.width, `${name} on screen at ${width}`).toBeLessThanOrEqual(width);
          expect(box.height).toBeGreaterThanOrEqual(48);
        }
        await page.keyboard.press('Escape');
      }
      await noHorizontalOverflow(page);
    }
  });

  test('the triage screen is for superadmins only', async ({ page }) => {
    await signInNewUser(page, 'fbnotadmin');
    await createOnboardedFarm(page, { growing: ['garden'] });
    const res = await page.request.get('/admin/feedback');
    expect(res.status()).toBe(403);
  });
});

test.describe('who can send feedback', () => {
  test('someone still in onboarding and a read-only inspector can both send it', async ({
    page,
    browser,
    baseURL
  }) => {
    const origin = originOf(page);
    await signInNewUser(page, 'fbpartial');
    const partial = await page.request.post('/api/feedback', {
      data: { kind: 'other', message: 'Onboarding question from e2e', pagePath: '/onboarding' },
      headers: { origin }
    });
    expect(partial.status()).toBe(201);

    const ctx = await browser.newContext({ baseURL });
    const inspector = await ctx.newPage();
    const demo = await inspector.request.post('/?/demo', {
      form: { role: 'inspector' },
      headers: { 'x-sveltekit-action': 'true', origin },
      maxRedirects: 0
    });
    expect(demo.ok()).toBe(true);
    const res = await inspector.request.post('/api/feedback', {
      data: { kind: 'bug', message: 'Inspector note from e2e', pagePath: '/records' },
      headers: { origin }
    });
    expect(res.status()).toBe(201);
    const blocked = await inspector.request.post('/api/blocks', {
      data: { name: 'nope' },
      headers: { origin }
    });
    expect(blocked.status()).toBe(403);
    await ctx.close();
  });
});
