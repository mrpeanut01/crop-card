import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

// Phase 32G G3. The "Hold now covers a sale" alert: its toggles on
// /settings/notifications (owner only, push on by default, email opt-in),
// and the pages it opens, which mark the records it names. A push has no
// deterministic browser trigger, so the tick itself is covered by unit tests.

const PHONE = { width: 375, height: 800 };
const DAY = 86_400_000;

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('hold now covers a sale', () => {
  test.describe.configure({ timeout: 180_000 });

  test('the owner can choose the alert once the farm has animals; a helper never sees it', async ({
    page,
    browser
  }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    await open(page, '/settings/notifications');
    await expect(page.getByText('Hold now covers a sale')).toHaveCount(0);

    await post(page, '/api/animal-groups', {
      name: 'Layers',
      speciesId: 'chicken',
      headCount: 6
    });
    await open(page, '/settings/notifications');
    await expect(page.getByText('Hold now covers a sale').first()).toBeVisible();
    await expect(
      page
        .getByText(
          'A later record put egg, milk or meat records you already saved inside a hold. Owner only.'
        )
        .first()
    ).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /^Hold now covers a sale/ })).toBeChecked();
    const email = page.getByRole('checkbox', { name: /Email me: Hold now covers a sale/ });
    await expect(email).not.toBeChecked();
    const box = await email.locator('xpath=ancestor::label[1]').boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    await email.check();
    await expect(page.getByText('Saved.')).toBeVisible();
    await open(page, '/settings/notifications');
    await expect(
      page.getByRole('checkbox', { name: /Email me: Hold now covers a sale/ })
    ).toBeChecked();
    await noHorizontalOverflow(page);

    const helper = await provisionHelper(page, browser);
    await helper.setViewportSize(PHONE);
    await open(helper, '/settings/notifications');
    await expect(helper.getByText('Hold now covers a sale')).toHaveCount(0);
    await expect(helper.getByText('Hold cleared')).toHaveCount(0);
    await helper.context().close();
  });

  test('the pages the alert opens mark the egg sale and the meat sale inside a hold', async ({
    page
  }) => {
    await page.setViewportSize(PHONE);
    await signInNewUser(page, 'covers');
    await createOnboardedFarm(page, { growing: ['garden'] });
    const now = Date.now();

    const { group } = await post<{ group: { id: string } }>(page, '/api/animal-groups', {
      name: 'Layers',
      speciesId: 'chicken',
      headCount: 6
    });
    await post(page, '/api/animals/production/record', {
      subjectType: 'group',
      subjectId: group.id,
      kind: 'eggs',
      quantity: 12,
      unit: 'eggs',
      use: 'sale',
      occurredAt: now - 2 * DAY
    });
    await post(page, '/api/animals/health/record', {
      subjectType: 'group',
      subjectId: group.id,
      kind: 'treatment',
      productName: 'Farm store wormer',
      route: 'oral',
      administeredAt: now - 5 * DAY
    });

    const { animal: steer } = await post<{ animal: { id: string } }>(page, '/api/animals', {
      speciesId: 'cattle',
      name: 'Steer',
      sex: 'neutered-male'
    });
    await post(page, '/api/animals/status', {
      subjectType: 'animal',
      subjectId: steer.id,
      status: 'sold-for-meat',
      occurredAt: now - DAY
    });
    await post(page, '/api/animals/health/record', {
      subjectType: 'animal',
      subjectId: steer.id,
      kind: 'treatment',
      productName: 'Penicillin G',
      route: 'injection-im',
      administeredAt: now - 3 * DAY
    });

    await open(page, '/today');
    const alert = page.getByRole('alert', { name: 'Treated food already logged' });
    await expect(alert.getByRole('link', { name: 'Layers' })).toHaveAttribute(
      'href',
      `/animals/${group.id}/log`
    );
    await expect(alert.getByRole('link', { name: 'Steer' })).toHaveAttribute(
      'href',
      `/animals/${steer.id}`
    );

    await alert.getByRole('link', { name: 'Layers' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Inside a hold').first()).toBeVisible();
    await noHorizontalOverflow(page);

    await open(page, '/today');
    await page
      .getByRole('alert', { name: 'Treated food already logged' })
      .getByRole('link', { name: 'Steer' })
      .click();
    await page.waitForLoadState('networkidle');
    const history = page.getByRole('list', { name: 'History' });
    await expect(history.getByText('Inside a hold')).toHaveCount(1);
    await noHorizontalOverflow(page);
  });
});
