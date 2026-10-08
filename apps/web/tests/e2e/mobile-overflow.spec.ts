import { test, expect } from './lib/test';
import { signInAsDemoOwner } from './lib/auth';

const ROUTES = [
  '/today',
  '/plan',
  '/plan/farm',
  '/plan/calendar',
  '/spray/fungicide',
  '/inventory',
  '/inventory/seed/add',
  '/inventory?type=amendment',
  '/inventory/amendment/add',
  '/equipment',
  '/animals',
  '/records?watering=1',
  '/records/organic',
  '/harvest',
  '/finance',
  '/finance/new?kind=income',
  '/settings/about',
  '/settings/billing',
  '/settings/ai',
  '/settings/farm',
  '/forage',
  '/pricing'
];

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

test('the top bar wordmark is never covered by the right-hand controls at 375px (#678)', async ({
  page
}) => {
  await signInAsDemoOwner(page);
  await page.goto('/today');
  const geometry = await page.evaluate(() => {
    const cluster = document.querySelector('.topbar .brand-cluster')!.getBoundingClientRect();
    const right = document.querySelector('.topbar .right')!.getBoundingClientRect();
    const brand = document.querySelector<HTMLElement>('.topbar .brand')!;
    const visible = getComputedStyle(brand).display !== 'none';
    const box = brand.getBoundingClientRect();
    return { clusterRight: cluster.right, rightLeft: right.left, visible, brandRight: box.right };
  });
  expect(geometry.clusterRight).toBeLessThanOrEqual(geometry.rightLeft);
  if (geometry.visible) expect(geometry.brandRight).toBeLessThanOrEqual(geometry.clusterRight);
});

test('/settings/farm controls are at least 48px tall on a phone (#748)', async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto('/settings/farm');
  await page.waitForLoadState('networkidle');
  const small = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '#main-content button, #main-content select, #main-content input:not([type=hidden]):not([type=checkbox]):not([type=radio]), #main-content a.primary-sm, #main-content a.card-link, #main-content a.map-edit-link'
      )
    )
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ el: el.outerHTML.slice(0, 80), h: el.getBoundingClientRect().height }))
      .filter((r) => r.h < 47.5)
  );
  expect(small).toEqual([]);
  await expect(page.locator('#main-content a[href="/settings/season"]')).not.toHaveText(
    '/settings/season'
  );
});
