import type { Page } from '@playwright/test';

/**
 * Phase 25b (#86) — Playwright auth helper.
 *
 * Signs in as the demo owner via the existing `POST /?/demo` form
 * action (defined in `src/routes/+page.server.ts`). The seed script
 * (`scripts/seed-test-data.mjs`, wired into playwright.config.ts'
 * webServer command chain) creates the demo owner + their tenant +
 * blocks + plantings, so this helper just establishes the session
 * cookie.
 *
 * Usage in a spec:
 *   test('something', async ({ page }) => {
 *     await signInAsDemoOwner(page);
 *     await page.goto('/spray');
 *     // …
 *   });
 *
 * Idempotent — subsequent calls return the same cookie because
 * loginByEmail() upserts by email.
 */
export async function signInAsDemoOwner(page: Page): Promise<void> {
  // The demo action is a `formData` POST that returns a 303 redirect
  // to /today (or /onboarding for fresh users; seeded data short-
  // circuits to /today). Playwright follows the redirect by default
  // and the Set-Cookie header is captured in the page's context.
  const res = await page.request.post('/?/demo', {
    form: { role: 'owner' },
    headers: { 'x-sveltekit-action': 'true' },
    maxRedirects: 5
  });
  if (!res.ok()) {
    throw new Error(`demo signin failed: ${res.status()} ${await res.text()}`);
  }
}
