import type { Locator, Page, Route } from '@playwright/test';
import { test, expect } from './lib/test';
import { openWizardFromPlan, provisionWizardTenant } from './lib/wizardTenant';
import {
  enableFixtureClaude,
  FIXTURE_REFINE_INVALID,
  FIXTURE_REFINE_VALID
} from './lib/fixtureClaude';

// The AllocationWizard's AI paths, driven through the fixture Claude
// (lib/server/aiFixture/claude.ts). Each test saves the fixture's sentinel
// key on its own throwaway Owner, so the guard, budget, call log and
// provenance run as they do with a real key while every other farm on the
// server stays on the no-key path. Each test makes at most 4 calls to the
// allocate endpoints, under the Free plan's daily cap of 5.

const BEAN = 'Bush Bean — Provider';
const BEET = 'Beet — Detroit Dark Red';

function wizard(page: Page): Locator {
  return page.locator('.aw-modal');
}

function body(page: Page): Locator {
  return wizard(page).locator('.aw-body');
}

function footer(page: Page): Locator {
  return wizard(page).locator('.aw-footer');
}

function reviewRows(page: Page): Locator {
  return body(page).locator('table.aw-table tbody tr');
}

function rowFor(page: Page, seed: string): Locator {
  return reviewRows(page).filter({ hasText: seed });
}

async function plantsIn(row: Locator): Promise<number> {
  return Number((await row.locator('td').nth(2).innerText()).replace(/[^\d]/g, ''));
}

async function expectActiveStep(page: Page, label: string): Promise<void> {
  await expect(
    wizard(page).locator('ol[aria-label="Wizard steps"] [aria-current="step"]')
  ).toHaveAttribute('aria-label', label);
}

async function expectRowSources(page: Page, source: 'ai' | 'fallback'): Promise<void> {
  const tags = body(page).locator('table.aw-table tbody td.cell-provenance [data-provenance]');
  await expect(tags.first()).toBeVisible();
  for (const tag of await tags.all()) {
    await expect(tag).toHaveAttribute('data-provenance', source);
  }
}

type AllocateBody = {
  assignments: Array<{ stockItemId: string; blockId: string; plants: number }>;
  meta: {
    fallback?: string;
    provenance?: string;
    rejectedAssignments?: Array<{ stockItemId: string; blockId: string; plants: number }>;
  };
};

/** Seeds → Blocks → Review with the AI plan from the fixture. */
async function goToAiReview(page: Page): Promise<AllocateBody> {
  for (const btn of await body(page)
    .getByRole('button', { name: /^Select all .* seeds$/ })
    .all()) {
    if (await btn.isEnabled()) await btn.click();
  }
  await footer(page)
    .getByRole('button', { name: /^Next: blocks/ })
    .click();
  await expectActiveStep(page, '2. Blocks');
  await body(page).getByRole('button', { name: 'Select all' }).click();
  const allocate = page.waitForResponse((r) => r.url().endsWith('/api/plan/allocate'));
  await footer(page)
    .getByRole('button', { name: /^Generate plan \(2 blocks\)/ })
    .click();
  const res = await allocate;
  expect(res.ok()).toBe(true);
  const allocated = (await res.json()) as AllocateBody;
  expect(allocated.meta.fallback, 'the fixture plan should pass the validator').toBeUndefined();
  await expectActiveStep(page, '3. Review');
  await expect(reviewRows(page).first()).toBeVisible();
  return allocated;
}

async function sendChat(page: Page, text: string): Promise<AllocateBody> {
  const chat = body(page).getByRole('region', { name: 'Refine plan with AI' });
  await chat.getByRole('textbox', { name: 'Refinement request' }).fill(text);
  const refine = page.waitForResponse((r) => r.url().endsWith('/api/plan/allocate/refine'));
  await chat.getByRole('button', { name: 'Send' }).click();
  const res = await refine;
  expect(res.ok()).toBe(true);
  return (await res.json()) as AllocateBody;
}

test.describe('allocation wizard with the fixture Claude', () => {
  test.describe.configure({ timeout: 120_000 });

  test('chat send: a refined plan comes back tagged ai and the spend is counted', async ({
    page
  }) => {
    await provisionWizardTenant(page, { seasonSetup: true });
    await enableFixtureClaude(page);
    await openWizardFromPlan(page);
    await goToAiReview(page);

    await expect(body(page)).not.toContainText('No Anthropic API key configured');
    await expectRowSources(page, 'ai');
    const beanBefore = await plantsIn(rowFor(page, BEAN));
    const beetBefore = await plantsIn(rowFor(page, BEET));
    expect(beanBefore).toBeGreaterThan(1);

    const refined = await sendChat(page, FIXTURE_REFINE_VALID);
    expect(refined.meta.provenance).toBe('ai');
    expect(refined.meta.fallback).toBeUndefined();

    const chat = body(page).getByRole('region', { name: 'Refine plan with AI' });
    await expect(chat.getByRole('log')).toContainText('half as many plants');
    await expect.poll(() => plantsIn(rowFor(page, BEAN))).toBe(Math.floor(beanBefore / 2));
    expect(await plantsIn(rowFor(page, BEET))).toBe(beetBefore);
    await expectRowSources(page, 'ai');

    const usage = (await (await page.request.get('/api/ai/usage')).json()) as {
      usage: { planning: { monthlyUsdSoFar: number; usedToday: number } };
    };
    expect(usage.usage.planning.monthlyUsdSoFar).toBeGreaterThan(0);
    expect(usage.usage.planning.usedToday).toBeGreaterThanOrEqual(2);
  });

  test('Apply anyway: puts the rejected plan in the table tagged ai', async ({ page }) => {
    await provisionWizardTenant(page, { seasonSetup: true });
    await enableFixtureClaude(page);
    await openWizardFromPlan(page);
    const allocated = await goToAiReview(page);
    const beanBefore = await plantsIn(rowFor(page, BEAN));

    const refused = await sendChat(page, FIXTURE_REFINE_INVALID);
    expect(refused.meta.fallback).toBe('engine-only');
    const rejected = refused.meta.rejectedAssignments ?? [];
    expect(rejected).toHaveLength(allocated.assignments.length);

    const chat = body(page).getByRole('region', { name: 'Refine plan with AI' });
    await expect(chat.getByRole('log')).toContainText('Could not apply the change cleanly');
    await expect(chat.getByRole('log')).toContainText('use “Apply anyway” below');
    expect(await plantsIn(rowFor(page, BEAN))).toBe(beanBefore);
    await expectRowSources(page, 'fallback');

    const apply = chat.getByRole('button', {
      name: new RegExp(`Apply anyway \\(${rejected.length} rows\\)`)
    });
    await expect(apply).toBeVisible();
    const box = await apply.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await apply.click();

    const overPacked = rejected[0].plants;
    expect(overPacked).toBeGreaterThan(beanBefore);
    await expect.poll(() => plantsIn(rowFor(page, BEAN))).toBe(overPacked);
    await expectRowSources(page, 'ai');
    await expect(chat.getByRole('log')).toContainText('Applied the AI plan over the validator');
    await expect(apply).toHaveCount(0);
  });

  test('partial-failure commit: names the rows that did not save and retries only those', async ({
    page
  }) => {
    const tenant = await provisionWizardTenant(page, { seasonSetup: true });
    await enableFixtureClaude(page);
    await openWizardFromPlan(page);
    await goToAiReview(page);

    const schedule = page.waitForResponse((r) => r.url().endsWith('/api/plan/schedule'));
    await footer(page).getByRole('button', { name: 'Accept all → schedule' }).click();
    const scheduled = (
      (await (await schedule).json()) as {
        scheduled: Array<{ blockId: string; varietyDisplayName: string }>;
      }
    ).scheduled;
    await expectActiveStep(page, '4. Schedule');
    await footer(page)
      .getByRole('button', { name: /^Accept dates → inputs plan/ })
      .click();
    await expectActiveStep(page, '5. Inputs');

    const [north, south] = tenant.blocks;
    const seen = new Map<string, number>();
    let refused = 0;
    let lost = 0;
    await page.route(/\/api\/blocks\/[^/]+\/plantings$/, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const blockId = route.request().url().split('/').at(-2) ?? '';
      const n = (seen.get(blockId) ?? 0) + 1;
      seen.set(blockId, n);
      if (blockId === north.id && n === 1) {
        refused++;
        return route.fulfill({ status: 500, json: { error: 'injected failure' } });
      }
      if (blockId === south.id && n === 1) {
        lost++;
        await route.fetch();
        return route.abort('connectionreset');
      }
      return route.continue();
    });

    await body(page)
      .getByRole('button', { name: /Accept and commit/ })
      .click();
    const failed = body(page).getByTestId('commit-failed');
    await expect(failed).toBeVisible();
    await expect(failed.getByTestId('commit-failed-row')).toHaveCount(refused + lost);
    await expect(failed).toContainText(north.name);
    await expect(failed).toContainText(south.name);

    await body(page).getByTestId('commit-retry').click();
    await expect(wizard(page)).toHaveCount(0);

    const blocks = (
      (await (await page.request.get('/api/blocks')).json()) as {
        blocks: Array<{ id: string; plantings: unknown[] }>;
      }
    ).blocks;
    for (const b of [north, south]) {
      const expected = scheduled.filter((s) => s.blockId === b.id).length;
      expect(blocks.find((x) => x.id === b.id)?.plantings).toHaveLength(expected);
    }

    for (const seed of tenant.seeds) {
      const detail = (await (await page.request.get(`/api/stock/${seed.id}`)).json()) as {
        lots: Array<{ balance: number }>;
      };
      const left = detail.lots.reduce((s, l) => s + l.balance, 0);
      expect(left, `${seed.displayName} should be drawn exactly once`).toBe(0);
    }
  });
});
