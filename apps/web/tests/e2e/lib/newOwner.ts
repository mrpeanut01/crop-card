import { expect, type Page } from '@playwright/test';

/**
 * A brand-new user with no farm yet, signed in through the direct-mode
 * email form. Each call gets a unique address so parallel specs never share
 * an Owner.
 */

export function originOf(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

export async function signInNewUser(page: Page, prefix = 'newowner'): Promise<string> {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
  const res = await page.request.post('/?/signin', {
    form: { email },
    headers: { 'x-sveltekit-action': 'true', origin: originOf(page) },
    maxRedirects: 0
  });
  const body = (await res.json()) as { location?: string };
  expect(body.location).toBe('/onboarding');
  return email;
}

/**
 * Both onboarding screens through the form actions: a farm at a Loudoun
 * pin, then the growing answers. With `growing` empty the owner stops on
 * screen 2, which is what a real owner who closes the tab would see.
 */
export async function createOnboardedFarm(
  page: Page,
  opts: { name?: string; growing?: string[]; latLon?: [number, number] } = {}
): Promise<void> {
  const headers = { 'x-sveltekit-action': 'true', origin: originOf(page) };
  const [lat, lon] = opts.latLon ?? [39.137, -77.714];
  const farm = await page.request.post('/onboarding?/farm', {
    form: {
      farmName: opts.name ?? `E2E Farm ${Date.now()}`,
      lat: String(lat),
      lon: String(lon)
    },
    headers,
    maxRedirects: 0
  });
  const farmBody = (await farm.json()) as { type?: string; location?: string };
  expect(farmBody, JSON.stringify(farmBody)).toMatchObject({
    type: 'redirect',
    location: '/onboarding'
  });
  if (!opts.growing || opts.growing.length === 0) return;
  const form = new URLSearchParams();
  for (const g of opts.growing) form.append('growing', g);
  const growing = await page.request.post('/onboarding?/growing', {
    data: form.toString(),
    headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
    maxRedirects: 0
  });
  expect(((await growing.json()) as { location?: string }).location).toBe('/today');
}
