import { test, expect } from './lib/test';
import { signInAsDemoOwner } from './lib/auth';

test('plan v2 shell renders the Area card rail + header + plantings', async ({ page }) => {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
  });
  await signInAsDemoOwner(page);
  await page.goto('/plan');
  await page.waitForLoadState('networkidle');

  // Left rail "Areas · N" kicker over one compact Area card per Area
  await expect(page.getByText(/^Areas · /).first()).toBeVisible();
  await expect(
    page.getByTestId('plan-area-cards').locator('article[data-variant="compact"]').first()
  ).toBeVisible();
  // Filter input
  await expect(page.getByPlaceholder('Filter Areas, beds or crops…')).toBeVisible();
  // The selected block's plantings render as planting Cards
  await expect(page.locator('article[data-card-kind="planting"]').first()).toBeVisible();
  // Legacy editor in <details> exists (collapsed by default)
  await expect(page.locator('details.legacy-detail')).toBeVisible();

  const real = errs.filter((m) => !/404/.test(m));
  expect(real).toEqual([]);
});

test('plan v2 map overlay opens with ?map=open', async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto('/plan?map=open');
  await page.waitForLoadState('networkidle');
  // The Modal renders a <dialog> with the title set from MapOverlay.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Seeded blocks carry acres but no drawn geometry, so the overlay draws
  // the dimension sketch: the field outline plus one clickable shape per block.
  const svg = dialog.getByTestId('map-overlay-svg');
  await expect(svg).toBeVisible();
  await expect(svg.locator('path.field')).not.toHaveCount(0);
  await expect(svg.locator('g.block')).not.toHaveCount(0);
});
