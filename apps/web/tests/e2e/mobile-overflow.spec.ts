import { test, expect } from './lib/test';
import { signInAsDemoOwner } from './lib/auth';

const ROUTES = ['/today', '/plan', '/spray/fungicide', '/inventory'];

test.use({ viewport: { width: 375, height: 800 } });

for (const route of ROUTES) {
  test(`${route} has no horizontal page overflow at 375px`, async ({ page }) => {
    await signInAsDemoOwner(page);
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
  });
}
