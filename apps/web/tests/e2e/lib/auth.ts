import type { Page } from '@playwright/test';

/**
 * Signs in as the seeded demo owner via the `POST /?/demo` form action.
 * `scripts/seed-test-data.mjs` gives owner@cropcard.local exactly one
 * helper_assignments(role='owner') row, so login must resolve straight to
 * /today. Anything else (/owner-picker, /onboarding) means the fixture
 * drifted (#246) and every signed-in spec would silently test the wrong
 * page — fail loudly here instead.
 *
 * APIRequestContext doesn't set `Origin`, and SvelteKit's CSRF check
 * rejects Origin-less form posts, so we send the baseURL as Origin.
 */
export async function signInAsDemoOwner(page: Page): Promise<void> {
  const baseURL =
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173';
  const res = await page.request.post('/?/demo', {
    form: { role: 'owner' },
    headers: {
      'x-sveltekit-action': 'true',
      origin: baseURL
    },
    maxRedirects: 0
  });
  if (!res.ok()) {
    throw new Error(`demo signin failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json().catch(() => null)) as { type?: string; location?: string } | null;
  if (body?.type !== 'redirect' || body.location !== '/today') {
    throw new Error(
      `demo signin should land on /today, got ${JSON.stringify(body)} — check seed-test-data.mjs helper_assignments for owner@cropcard.local`
    );
  }
}
