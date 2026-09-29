import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

// Phase 32D (D1): the garden household persona. The dog's rabies booster
// shows on /today two weeks ahead; the owner closes it with the shot and the
// next due date rolls forward to what the vet said.

const PHONE = { width: 375, height: 800 };
const ZONE = 'America/New_York';

function ymd(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

function addYmd(base: string, days: number): string {
  return new Date(Date.parse(`${base}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
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

test.describe('animal care plans', () => {
  test.describe.configure({ timeout: 180_000 });

  test("the dog's rabies booster shows ahead on Today and rolls forward when closed", async ({
    page
  }) => {
    await page.setViewportSize(PHONE);
    await signInNewUser(page, 'care');
    await createOnboardedFarm(page, { growing: ['garden'] });
    const res = await page.request.post('/api/animals', {
      data: { speciesId: 'dog', name: 'Biscuit', purpose: 'pet' },
      headers: { origin: originOf(page) }
    });
    expect(res.ok(), await res.text()).toBe(true);
    const { animal } = (await res.json()) as { animal: { id: string } };

    await open(page, `/animals/${animal.id}`);
    const care = page.getByTestId('care-plans');
    const rabies = care.getByTestId('care-plan').filter({ hasText: 'Rabies vaccine' });
    await expect(rabies).toContainText('Due date not set, ask your vet');
    await expect(rabies).toContainText("When was Biscuit's last rabies vaccine?");
    await noHorizontalOverflow(page);

    await rabies.getByRole('button', { name: 'Set the date' }).click();
    const form = care.getByRole('form', { name: 'Care plan' });
    await form.getByLabel(/Every how many days/).fill('365');
    await form.getByLabel(/Last done/).fill(ymd(-355));
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Care plan saved.' })).toBeVisible();
    await expect(rabies).toContainText('Every year');
    await expect(rabies).toContainText('Next due');

    await open(page, '/today');
    const section = page.getByTestId('today-animal-care');
    const card = section.getByTestId('care-card').filter({ hasText: 'Rabies vaccine: Biscuit' });
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Due \w{3} \d{1,2}/);
    await noHorizontalOverflow(page);

    await card.getByRole('button', { name: 'Skip' }).click();
    await expect(card.getByRole('button', { name: 'Skip this one' })).toBeVisible();
    await expect(card.getByRole('button', { name: '3 days' })).toBeVisible();
    await card.getByRole('button', { name: 'Back' }).click();

    await card.getByRole('button', { name: 'Done', exact: true }).click();
    const next = card.getByLabel('Next due');
    await expect(next).toHaveValue(addYmd(ymd(0), 365));
    const threeYears = addYmd(ymd(0), 3 * 365);
    await next.fill(threeYears);
    const health = card.getByRole('form', { name: 'Record health' });
    await health.getByRole('textbox', { name: /^Product/ }).fill('Rabies shot, 3 year');
    await health.getByRole('button', { name: 'Save' }).click();
    await expect(section.getByRole('status')).toContainText('Recorded vaccine.');
    await expect(card).toHaveCount(0);

    await open(page, `/animals/${animal.id}`);
    const year = threeYears.slice(0, 4);
    await expect(rabies).toContainText(new RegExp(`Next due .*${year}`));
    await noHorizontalOverflow(page);

    await open(page, `/animals/${animal.id}/health`);
    await expect(page.getByText('Rabies shot, 3 year').first()).toBeVisible();
  });
});
