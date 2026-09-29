import { test as base, expect, type Page } from '@playwright/test';

function markAlphaWelcomeSeen(): void {
  try {
    localStorage.setItem('cropcard.alpha-welcome.seen', '1');
  } catch {
    /* storage blocked: the spec sees the welcome */
  }
}

/**
 * Every spec runs hermetically: third-party requests (map tiles, weather,
 * anything off the preview origin) are answered with an empty 204 so
 * results don't depend on the runner's network, proxy CA, or upstream
 * uptime — and no "Failed to load resource" console noise leaks into the
 * console-error assertions.
 */
export const test = base.extend<{ hermetic: void; showAlphaWelcome: boolean }>({
  // The one-time alpha welcome on /today (#466) is a modal; specs that are
  // not about it start with it already seen on this device.
  showAlphaWelcome: [false, { option: true }],
  hermetic: [
    async ({ page, baseURL, browser, showAlphaWelcome }, use) => {
      const originalNewContext = browser.newContext.bind(browser);
      if (!showAlphaWelcome) {
        await page.context().addInitScript(markAlphaWelcomeSeen);
        browser.newContext = async (...args: Parameters<typeof browser.newContext>) => {
          const ctx = await originalNewContext(...args);
          await ctx.addInitScript(markAlphaWelcomeSeen);
          return ctx;
        };
      }
      const origin = new URL(baseURL ?? 'http://localhost:5173').origin;
      await page.route(
        (url) => url.origin !== origin && url.protocol.startsWith('http'),
        (route) => route.fulfill({ status: 204, body: '' })
      );
      try {
        await use();
      } finally {
        browser.newContext = originalNewContext;
      }
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
