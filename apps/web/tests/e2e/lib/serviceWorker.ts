import type { Page } from '@playwright/test';

const BOOT_FAILED = /Failed to fetch dynamically imported module/;
/** SvelteKit's start script rejects within a few hundred ms of the load. */
const BOOT_GRACE_MS = 2_000;

/**
 * Reloads the page so the service worker the first load installed controls
 * it. On that first controlled load Chromium now and then aborts one
 * precached module request (`net::ERR_ABORTED`), SvelteKit's start script
 * rejects with "Failed to fetch dynamically imported module" and the page
 * never hydrates, so nothing on it runs. That is the browser, not the spec
 * under test: reload again, up to three times, and fail loudly if the app
 * still does not start.
 */
export async function reloadUnderServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    let onError: ((e: Error) => void) | undefined;
    const bootFailed = new Promise<boolean>((resolve) => {
      onError = (e: Error) => {
        if (BOOT_FAILED.test(e.message)) resolve(true);
      };
      page.on('pageerror', onError);
    });
    try {
      await page.reload();
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      const failed = await Promise.race([
        bootFailed,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), BOOT_GRACE_MS))
      ]);
      if (!failed) return;
    } finally {
      if (onError) page.off('pageerror', onError);
    }
  }
  throw new Error('The app did not start under the service worker after three reloads.');
}
