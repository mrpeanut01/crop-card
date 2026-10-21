import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';
import { enableFixtureClaude } from './lib/fixtureClaude';
import {
  FIXTURE_BRIEF_BECAUSE,
  FIXTURE_BRIEF_REPLY,
  FIXTURE_BRIEF_SPRAY_LINE
} from '../../src/lib/server/aiFixture/gardenBrief';

// Phase 37A: the garden brief. The first test runs the no-key path a new
// herb gardener sees from the onboarding tile to the planning wizard; the
// second sends one turn through the fixture Claude on its own Owner.

async function newHerbOwner(page: Page): Promise<void> {
  await signInNewUser(page, 'herbs');
  await createOnboardedFarm(page);
  const thisYear = new Date().getFullYear();
  for (const year of [thisYear, thisYear + 1]) {
    const res = await page.request.post('/api/season/setup', {
      data: {
        year,
        philosophy: 'conventional',
        weedStrategy: 'cultivate-first',
        pestStrategy: 'ipm',
        fertilityApproach: 'synthetic',
        coverCropIntent: 'none'
      },
      headers: { origin: originOf(page) }
    });
    expect(res.ok(), await res.text()).toBe(true);
  }
}

async function openBrief(page: Page): Promise<void> {
  await expect(page.getByTestId('garden-brief')).toHaveAttribute('data-ready', 'true');
}

test.describe('garden brief', () => {
  test('a new herb gardener goes from the tile to a shortlist and the wizard, no key', async ({
    page
  }) => {
    await newHerbOwner(page);

    await page.goto('/onboarding');
    await page.getByText('A few herbs by the kitchen', { exact: true }).click();
    await page.getByRole('button', { name: /Start my garden brief/ }).click();
    await expect(page).toHaveURL(/\/plan\/brief$/, { timeout: 15_000 });

    const fields = (await (await page.request.get('/api/fields')).json()) as
      { fields?: Array<{ name: string; kind: string }> } | Array<{ name: string; kind: string }>;
    const areas = Array.isArray(fields) ? fields : (fields.fields ?? []);
    expect(areas.map((a) => [a.name, a.kind])).toEqual([['Herb garden', 'garden']]);

    await openBrief(page);
    await expect(page.getByTestId('brief-chat')).toHaveCount(0);
    const form = page.getByTestId('brief-form');
    await form.locator('#q-cuisines').getByLabel('Italian').check();
    await form.locator('#q-sun').getByLabel('Mostly shade').check();
    await form.locator('#q-time').getByLabel("I'm not sure").check();
    await form.locator('#q-storage').getByLabel('Dry it', { exact: true }).check();
    await form
      .locator('#q-storage')
      .getByLabel('Rough target (optional)')
      .fill('oregano for the year');
    await page.getByRole('button', { name: 'Save and suggest herbs' }).click();

    const rows = page.getByTestId('brief-row');
    await expect(rows.first()).toBeVisible();
    const basil = rows.filter({ hasText: 'Basil' });
    await expect(basil).toContainText('Picked for Italian cooking.');
    await expect(basil.locator('[data-provenance="fallback"]').first()).toBeVisible();
    await expect(basil.getByTestId('lifecycle-line')).toContainText(
      'Annual or perennial here: not yet known'
    );
    await expect(page.getByTestId('brief-sun-warning')).toBeVisible();
    const basilSun = basil.getByTestId('sun-line');
    await expect(basilSun).toContainText('Wants full sun, more than this spot gets.');
    await expect(basilSun).toHaveAttribute('data-fit', 'mismatch');
    await expect(basilSun.locator('[data-provenance="plugin"]')).toBeVisible();
    await expect(rows.filter({ hasText: 'Parsley' }).getByTestId('sun-line')).toContainText(
      'Takes part shade, but not mostly shade.'
    );
    await expect(page.getByTestId('brief-sun-unknown')).toHaveCount(0);
    await expect(page.getByTestId('brief-buy')).toContainText('Basil');

    const saved = (await (await page.request.get('/api/garden/brief')).json()) as {
      brief: {
        answers: { storage: { value: Array<{ goal: string; target?: string }> } };
        shortlist: Array<{ cropPluginId: string; provenance: string }>;
      };
    };
    expect(saved.brief.answers.storage.value).toEqual([
      { goal: 'dry', target: 'oregano for the year' }
    ]);
    expect(saved.brief.shortlist.map((r) => r.cropPluginId)).toContain('basil-genovese');

    await page.goto('/today');
    await expect(page.getByTestId('getting-started').locator('[data-item="brief"]')).toHaveCount(0);

    await page.goto('/plan/brief');
    await openBrief(page);
    await page.getByTestId('brief-plan').click();
    await expect(page).toHaveURL(/\/plan\?brief=1/, { timeout: 15_000 });
    const wizard = page.locator('.aw-modal');
    await expect(wizard).toBeVisible();
    await expect(wizard.getByRole('checkbox', { name: /^Select Basil/ })).toBeChecked();
    await expect(wizard.getByRole('checkbox', { name: /^Select Oregano/ })).toBeChecked();
  });

  test('one turn with the fixture Claude, checked by the server', async ({ page }) => {
    await newHerbOwner(page);
    await enableFixtureClaude(page);
    await page.goto('/plan/brief');
    await openBrief(page);

    const chat = page.getByTestId('brief-chat');
    await expect(chat).toBeVisible();
    await expect(page.getByTestId('brief-turns')).toHaveText('8 turns left');
    await chat.getByLabel('Your message').fill('I cook a lot of pasta.');
    const turn = page.waitForResponse((r) => r.url().endsWith('/api/garden/brief/chat'));
    await chat.getByRole('button', { name: 'Send' }).click();
    const body = (await (await turn).json()) as {
      provenance: string;
      shortlist: Array<{ cropPluginId: string; because: string; provenance: string }>;
    };
    expect(body.provenance).toBe('ai');
    expect(body.shortlist).toHaveLength(3);
    expect(body.shortlist.every((r) => r.provenance === 'ai')).toBe(true);
    expect(body.shortlist.map((r) => r.because)).not.toContain(FIXTURE_BRIEF_SPRAY_LINE);

    await expect(chat).toContainText(FIXTURE_BRIEF_REPLY);
    await expect(page.getByTestId('brief-turns')).toHaveText('7 turns left');
    const rows = page.getByTestId('brief-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText(FIXTURE_BRIEF_BECAUSE);
    await expect(rows.first().locator('[data-provenance="ai"]').first()).toBeVisible();
    await expect(page.getByText(FIXTURE_BRIEF_SPRAY_LINE)).toHaveCount(0);
    await expect(rows.nth(2)).toContainText('Suggested for your garden.');
  });
});
