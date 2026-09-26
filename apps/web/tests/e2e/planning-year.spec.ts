import { expect, test, type Page } from '@playwright/test';

function origin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function signInFresh(page: Page): Promise<void> {
  const email = `year-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
  const res = await page.request.post('/?/signin', {
    form: { email },
    headers: { 'x-sveltekit-action': 'true', origin: origin(page) },
    maxRedirects: 0
  });
  const body = (await res.json()) as { location?: string };
  expect(body.location).toBe('/onboarding');
}

test.describe('planning year', () => {
  const thisYear = new Date().getFullYear();

  test('a new farm starts on the suggested planting year and can switch it later', async ({
    page
  }) => {
    await signInFresh(page);
    const onboard = await page.request.post('/onboarding?/farm', {
      form: { farmName: `Year Farm ${Date.now()}` },
      headers: { 'x-sveltekit-action': 'true', origin: origin(page) },
      maxRedirects: 0
    });
    expect(((await onboard.json()) as { location?: string }).location).toBe('/onboarding');

    await page.goto('/settings/season');
    await page.waitForLoadState('networkidle');
    const picker = page.getByRole('group', { name: /which planting year/i });
    await expect(picker.getByRole('radio')).toHaveCount(2);
    await expect(picker.getByText('Suggested')).toBeVisible();
    const active = Number(await picker.getByRole('radio', { checked: true }).getAttribute('value'));
    expect([thisYear, thisYear + 1]).toContain(active);
    await expect(page.getByText(`Settings · Season ${active}`)).toBeVisible();

    const other = active === thisYear ? thisYear + 1 : thisYear;
    await picker.getByLabel(String(other)).check();
    await expect(page.getByText(`Settings · Season ${other}`)).toBeVisible();
  });

  test('earlier seasons with data are listed and open read-only', async ({ page }) => {
    await signInFresh(page);
    const onboard = await page.request.post('/onboarding?/farm', {
      form: { farmName: `Past Farm ${Date.now()}`, planningYear: String(thisYear) },
      headers: { 'x-sveltekit-action': 'true', origin: origin(page) },
      maxRedirects: 0
    });
    expect(onboard.ok()).toBe(true);
    const past = thisYear - 2;
    const saved = await page.request.post('/api/season/setup', {
      data: {
        year: past,
        philosophy: 'certified-organic',
        weedStrategy: 'cultivate-first',
        pestStrategy: 'ipm',
        fertilityApproach: 'compost-amendments',
        coverCropIntent: 'none',
        sprayCapacity: 'backpack-4gal'
      },
      headers: { origin: origin(page) }
    });
    expect(saved.ok()).toBe(true);

    const refused = await page.request.post('/api/season/year', {
      data: { year: past },
      headers: { origin: origin(page) }
    });
    expect(refused.status()).toBe(400);

    await page.goto('/settings/season');
    await page.getByRole('link', { name: String(past), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`year=${past}`));
    await expect(page.getByText(/Past seasons are view only/)).toBeVisible();
    await expect(page.getByText(/Certified organic/)).toBeVisible();
    await expect(page.getByRole('button', { name: /edit/i })).toHaveCount(0);
  });
});
