import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

type Area = { name: string; kind: string; geometryGeojson?: string | null };

async function areas(page: import('@playwright/test').Page): Promise<Area[]> {
  const res = await page.request.get('/api/fields');
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { fields?: Area[] } | Area[];
  return Array.isArray(body) ? body : (body.fields ?? []);
}

test.describe('two-screen onboarding', () => {
  test('a new owner reaches Today in two screens with GPS', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 39.137, longitude: -77.714 });
    await signInNewUser(page, 'sherry');

    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tell us about your farm');
    await expect(page.getByLabel('Farm name')).toHaveValue("Sherry's Farm");
    const cont = page.getByRole('button', { name: /^Continue/ });
    await expect(cont).toBeDisabled();

    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.getByTestId('picked-location')).toContainText('39.1370, -77.7140');
    await expect(page.getByTestId('frost-lastFrost')).not.toHaveText('None on record');
    const frost = page.locator('section[aria-labelledby="frost-title"]');
    await expect(frost.locator('[data-provenance="data"]').first()).toBeVisible();
    await expect(frost.getByText(/using NOAA's 1991-2020 climate normals/)).toBeVisible();

    const median = await page.getByTestId('frost-lastFrost').textContent();
    await frost.getByLabel(/Cautious dates/).check();
    await expect(page.getByTestId('frost-lastFrost')).not.toHaveText(median ?? '');
    await frost.getByLabel(/Cautious dates/).uncheck();
    await expect(page.getByTestId('frost-lastFrost')).toHaveText(median ?? '');

    await frost.getByRole('button', { name: 'My place runs colder' }).click();
    await frost.getByRole('button', { name: 'About a week colder' }).click();
    await expect(page.getByTestId('frost-lastFrost')).not.toHaveText(median ?? '');
    await expect(frost.locator('[data-provenance="manual"]').first()).toBeVisible();
    await frost.getByRole('button', { name: 'Use the station dates' }).click();
    await expect(page.getByTestId('frost-lastFrost')).toHaveText(median ?? '');
    await expect(frost.locator('[data-provenance="manual"]')).toHaveCount(0);
    await frost.getByText('Enter exact dates').click();
    await frost.getByRole('button', { name: 'Type my own dates' }).click();
    await frost.getByLabel('Last spring frost').fill('04-28');

    await expect(cont).toBeEnabled();
    await cont.click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('What are you growing on?');

    await page.goto('/today');
    await expect(page).toHaveURL(/\/onboarding$/);

    const go = page.getByRole('button', { name: /Take me to Today/ });
    await expect(go).toBeDisabled();
    await page.getByText('A garden', { exact: true }).click();
    await page.getByText('Hay or pasture', { exact: true }).click();
    await go.click();
    await expect(page).toHaveURL(/\/today$/);

    const card = page.getByTestId('getting-started');
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Getting started · 1 of \d+/);
    await expect(card.locator('[data-item="location"]')).toContainText('(done)');
    await expect(card.locator('[data-item="bed"]')).toBeVisible();
    await expect(card.locator('[data-item="equipment"]')).toBeVisible();
    await expect(card.locator('[data-item="assistant"]')).toContainText('Optional');

    const made = await areas(page);
    expect(made.map((a) => [a.name, a.kind]).sort()).toEqual([
      ['Hayfield', 'pasture'],
      ['Kitchen Garden', 'garden']
    ]);
    expect(made.every((a) => !a.geometryGeojson)).toBe(true);

    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('frost-lastFrost')).toHaveText('Apr 28');
    const saved = page.locator('section[aria-labelledby="frost-title"]');
    await expect(saved.locator('[data-provenance="manual"]').first()).toBeVisible();
    await expect(saved.locator('[data-provenance="data"]').first()).toBeVisible();
  });

  test('with the geocoder down, dropping a pin still completes setup', async ({ page }) => {
    await page.route('**/api/geocode**', (route) => route.fulfill({ status: 503, body: '' }));
    await signInNewUser(page, 'pin');
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');

    await page.getByLabel('Farm name').fill('Pin Farm');
    await page.getByLabel('Search for an address').fill('1 Main St, Purcellville VA');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText(/couldn't find that address/)).toBeVisible();

    const map = page.getByRole('application', { name: /Tap your farm to drop a pin/ });
    await expect(map).toBeVisible();
    await map.click({ position: { x: 120, y: 120 } });
    await expect(page.getByTestId('picked-location')).toContainText('Pin on the map');
    await expect(page.getByTestId('frost-lastFrost')).not.toHaveText('None on record');

    await page.getByRole('button', { name: /^Continue/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('What are you growing on?');
    await page.getByRole('button', { name: 'Not sure yet' }).click();
    await expect(page).toHaveURL(/\/today$/);
    expect(await areas(page)).toEqual([]);
  });

  test('the geocoder answers a new owner before a farm exists', async ({ page }) => {
    await signInNewUser(page, 'geo');
    const res = await page.request.get('/api/geocode?q=ab', { maxRedirects: 0 });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/3-200/) });
  });

  test('an address search fills the location', async ({ page }) => {
    await page.route('**/api/geocode**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          matches: [
            { label: '100 MAIN ST, PURCELLVILLE, VA, 20132', lat: 39.1368, lon: -77.7147 },
            { label: '100 MAIN ST, LEESBURG, VA, 20176', lat: 39.1157, lon: -77.5636 }
          ]
        })
      })
    );
    await signInNewUser(page, 'search');
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Search for an address').fill('100 Main St');
    await page.getByLabel('Search for an address').press('Enter');
    await page.getByRole('button', { name: /PURCELLVILLE/ }).click();
    await expect(page.getByTestId('picked-location')).toContainText('PURCELLVILLE');
    await expect(page.getByTestId('picked-location')).toContainText('39.1368, -77.7147');
  });

  test('a spot with no nearby station asks before using fallback dates', async ({ page }) => {
    await signInNewUser(page, 'ocean');
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Farm name').fill('Island Farm');
    await page.getByText('Type the coordinates instead').click();
    await page.getByLabel('Latitude').fill('30');
    await page.getByLabel('Longitude').fill('-45');

    const frost = page.locator('section[aria-labelledby="frost-title"]');
    await expect(frost.getByText(/No weather station within 50 miles/)).toBeVisible();
    await expect(frost.locator('[data-provenance="fallback"]').first()).toBeVisible();
    const cont = page.getByRole('button', { name: /^Continue/ });
    await expect(cont).toBeDisabled();
    await frost.getByLabel('These dates are fine for now').check();
    await expect(cont).toBeEnabled();
    await cont.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('What are you growing on?');
  });

  test('old wizard bookmarks redirect to Today', async ({ page }) => {
    await signInNewUser(page, 'legacy');
    await createOnboardedFarm(page, { growing: ['fields'] });
    for (const step of ['fields', 'location', 'season']) {
      const res = await page.request.get(`/onboarding?step=${step}`, { maxRedirects: 0 });
      expect(res.status()).toBe(308);
      expect(res.headers()['location']).toBe('/today');
    }
    await page.goto('/onboarding?step=fields');
    await expect(page).toHaveURL(/\/today$/);
  });

  test('a second farm submit from a stale tab is refused', async ({ page }) => {
    await signInNewUser(page, 'twice');
    await createOnboardedFarm(page, { growing: ['garden'] });
    const res = await page.request.post('/onboarding?/farm', {
      form: { farmName: 'Duplicate', lat: '39.1', lon: '-77.7' },
      headers: { 'x-sveltekit-action': 'true', origin: originOf(page) },
      maxRedirects: 0
    });
    expect(((await res.json()) as { type?: string }).type).toBe('failure');
  });
});
