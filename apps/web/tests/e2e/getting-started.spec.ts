import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';
import { signInAsDemoOwner } from './lib/auth';

test.describe('Getting Started card', () => {
  test('reflects live data and stays dismissed until re-shown', async ({ page }) => {
    await signInNewUser(page, 'checklist');
    await createOnboardedFarm(page, { growing: ['fields'] });

    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    const card = page.getByTestId('getting-started');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-item="bed"]')).toHaveCount(0);
    await expect(card.locator('[data-item="calibrate"]')).toHaveCount(0);
    await expect(card.locator('[data-item="area"]')).not.toContainText('(done)');

    const sprayer = await page.request.post('/api/equipment', {
      data: { type: 'sprayer', label: 'Backpack sprayer' },
      headers: { origin: originOf(page) }
    });
    expect(sprayer.ok(), await sprayer.text()).toBe(true);
    const block = await page.request.post('/api/blocks', {
      data: { name: 'North Block', widthFt: 100, lengthFt: 200 },
      headers: { origin: originOf(page) }
    });
    expect(block.ok(), await block.text()).toBe(true);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(card.locator('[data-item="equipment"]')).toContainText('(done)');
    await expect(card.locator('[data-item="area"]')).toContainText('(done)');
    await expect(card.locator('[data-item="calibrate"]')).toBeVisible();
    await expect(card.locator('[data-item="calibrate"]')).not.toContainText('(done)');

    await card.getByRole('button', { name: 'Dismiss' }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('getting-started')).toHaveCount(0);
    await expect(page.getByTestId('getting-started-strip')).toHaveCount(0);

    await page.goto('/settings');
    await page.getByRole('button', { name: 'Re-show setup checklist' }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByTestId('getting-started')).toBeVisible();
  });

  test('helpers never see it', async ({ page }) => {
    await signInAsDemoOwner(page);
    const res = await page.request.post('/?/demo', {
      form: { role: 'helper' },
      headers: { 'x-sveltekit-action': 'true', origin: originOf(page) },
      maxRedirects: 0
    });
    expect(res.ok()).toBe(true);
    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('getting-started')).toHaveCount(0);
    await expect(page.getByTestId('getting-started-strip')).toHaveCount(0);
    const refused = await page.request.post('/today?/dismissSetup', {
      form: {},
      headers: { 'x-sveltekit-action': 'true', origin: originOf(page) },
      maxRedirects: 0
    });
    expect(refused.status()).toBe(403);
  });
});

test.describe('first-use hints', () => {
  test('the first-crop hint shows once, across reloads and devices', async ({ page, browser }) => {
    await signInNewUser(page, 'hint');
    await createOnboardedFarm(page, { growing: ['fields'] });
    const block = await page.request.post('/api/blocks', {
      data: { name: 'Hint Block', acres: 0.5 },
      headers: { origin: originOf(page) }
    });
    expect(block.ok()).toBe(true);

    const closeWizard = async () => {
      const wizard = page.locator('.aw-modal');
      if (await wizard.isVisible()) {
        await page.keyboard.press('Escape');
        await expect(wizard).toBeHidden();
      }
    };

    await page.goto('/plan?setup=skip');
    await page.waitForLoadState('networkidle');
    await closeWizard();
    const tip = page.getByRole('note', { name: 'Tip' });
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Start here.');
    await expect(page.getByRole('note', { name: 'Tip' })).toHaveCount(1);
    await tip.getByRole('button', { name: 'Got it' }).click();
    await expect(tip).toHaveCount(0);

    await expect
      .poll(async () => {
        const res = await page.request.get('/api/me/hints');
        const body = (await res.json()) as { hints: Array<{ key: string }> };
        return body.hints.map((h) => h.key);
      })
      .toContain('plan_first_crop');

    await page.reload();
    await page.waitForLoadState('networkidle');
    await closeWizard();
    await expect(page.getByRole('button', { name: /Add planting/ }).first()).toBeVisible();
    await expect(page.getByRole('note', { name: 'Tip' })).toHaveCount(0);

    const cookies = await page.context().cookies();
    const other = await browser.newContext({ baseURL: originOf(page) });
    await other.addCookies(cookies);
    const phone = await other.newPage();
    await phone.route(
      (url) => url.origin !== new URL(originOf(page)).origin && url.protocol.startsWith('http'),
      (route) => route.fulfill({ status: 204, body: '' })
    );
    await phone.goto('/plan?setup=skip');
    await phone.waitForLoadState('networkidle');
    const wizard = phone.locator('.aw-modal');
    if (await wizard.isVisible()) {
      await phone.keyboard.press('Escape');
      await expect(wizard).toBeHidden();
    }
    await expect(phone.getByRole('button', { name: /Add planting/ }).first()).toBeVisible();
    await phone.waitForTimeout(500);
    await expect(phone.getByRole('note', { name: 'Tip' })).toHaveCount(0);
    await other.close();
  });
});
