import { test as base, expect, type Page } from '@playwright/test';

/**
 * Every spec runs hermetically: third-party requests (map tiles, weather,
 * anything off the preview origin) are answered with an empty 204 so
 * results don't depend on the runner's network, proxy CA, or upstream
 * uptime — and no "Failed to load resource" console noise leaks into the
 * console-error assertions.
 */
export const test = base.extend<{ hermetic: void }>({
  hermetic: [
    async ({ page, baseURL }, use) => {
      const origin = new URL(baseURL ?? 'http://localhost:5173').origin;
      await page.route(
        (url) => url.origin !== origin && url.protocol.startsWith('http'),
        (route) => route.fulfill({ status: 204, body: '' })
      );
      await use();
    },
    { auto: true }
  ]
});

export { expect };

/**
 * Settle the page before a visual snapshot: web fonts loaded, network
 * idle, and any scroll-into-view / focus side effects cleared.
 */
export async function settleForScreenshot(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.scrollTo(0, 0);
  });
}
