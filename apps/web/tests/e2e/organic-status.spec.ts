import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

// Phase 33B (cluster B1): owner-entered organic status, the facts beside
// it, the treatment review and a garden household that sees no organic
// chrome at all.

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

test.describe('organic status (33B, B1)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('owner marks a block transitioning, a non-allowed fertilizer shows as a fact, a helper reads it', async ({
    page,
    browser
  }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
      name: 'North Field',
      kind: 'field'
    });
    const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
      name: 'Bed A',
      fieldId: field.id
    });

    await open(page, '/records');
    await page.getByTestId('organic-records-link').click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Organic records.' })).toBeVisible();
    await expect(page.getByTestId('organic-empty')).toBeVisible();

    await page.getByTestId('organic-subject').selectOption(`block:${block.id}`);
    await page.getByTestId('organic-status').selectOption('transitioning');
    await page.getByTestId('organic-effective').fill('2025-03-01');
    await page.getByLabel(/^Certifier/).fill('Valley Organic');
    await page.getByTestId('organic-save').click();
    await expect(page.getByRole('status').filter({ hasText: 'Status saved.' })).toBeVisible();
    await expect(page.getByTestId('organic-block-line')).toContainText(
      'Transitioning (owner-entered, effective Mar 1, 2025, certifier Valley Organic)'
    );

    await post(page, '/api/fertility/applications', {
      blockId: block.id,
      source: 'urea-46-0-0',
      ratePerAcre: 100,
      rateUnit: 'lb',
      occurredAt: Date.now() - 2 * DAY
    });
    await open(page, '/records/organic');
    const facts = page.getByTestId('organic-block-facts');
    await expect(facts.getByTestId('organic-fact')).toContainText(
      'Fertility: Urea (46-0-0) · Library mark: not allowed for organic use'
    );
    await expect(facts).toContainText(
      /By these records, the earliest harvest date under the 3-year rule in 7 CFR 205\.202\(b\) is .+, 36 months after the last input the library marks as not allowed \(.+\)\. Your certifier decides\./
    );
    await expect(facts).not.toContainText(/transition period|certified|eligible/i);
    await expect(page.getByText(/Showing records from \d{4}-\d{2}-\d{2} to/)).toBeVisible();
    await noHorizontalOverflow(page);

    const helper = await provisionHelper(page, browser);
    await helper.setViewportSize(PHONE);
    await open(helper, '/records');
    await expect(helper.getByTestId('organic-records-link')).toBeVisible();
    await open(helper, '/records/organic');
    await expect(helper.getByTestId('organic-block-line')).toContainText(
      'Transitioning (owner-entered'
    );
    await expect(helper.getByTestId('organic-save')).toHaveCount(0);
    await expect(
      helper.getByText('Only the owner enters organic statuses. Ask the owner.')
    ).toBeVisible();
    const refused = await helper.request.post('/api/organic/status', {
      data: {
        subjectType: 'block',
        subjectId: block.id,
        status: 'organic',
        effectiveOn: '2025-01-01'
      },
      headers: { origin: originOf(helper) }
    });
    expect(refused.status()).toBe(403);
    await noHorizontalOverflow(helper);
    await helper.context().close();
  });

  test('a dewormed hen needs review until the owner answers', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    const out = await post<{ group: { id: string }; members: { id: string }[] }>(
      page,
      '/api/animal-groups',
      { name: 'Layers', speciesId: 'chicken', headCount: 3, members: [{ name: 'Clover' }] }
    );
    const henId = out.members[0].id;
    await post(page, '/api/organic/status', {
      subjectType: 'group',
      subjectId: out.group.id,
      status: 'organic',
      effectiveOn: '2025-01-01',
      certifier: 'Valley Organic'
    });
    await post(page, '/api/animals/health/record', {
      subjectType: 'animal',
      subjectId: henId,
      kind: 'deworm',
      productName: 'Farm store wormer',
      route: 'oral',
      administeredAt: Date.now() - DAY
    });

    await open(page, `/animals/${henId}/health`);
    await expect(page.getByTestId('organic-status-line')).toContainText(
      'Organic (owner-entered, effective Jan 1, 2025, certifier Valley Organic) from group Layers'
    );
    await expect(page.getByTestId('organic-welfare-line')).toHaveText(
      'Treat a sick animal. The organic rules forbid withholding treatment to keep status (7 CFR 205.238(c)(7)).'
    );
    await expect(page.getByTestId('organic-outcome')).toContainText('Organic: Needs review');
    await noHorizontalOverflow(page);

    await page.getByRole('link', { name: 'Answer the review' }).click();
    await page.waitForLoadState('networkidle');
    const row = page.getByTestId('organic-treatment');
    await expect(row.getByTestId('organic-treatment-outcome')).toHaveText('Needs review');
    await row.getByLabel('Ends organic status').check();
    await row.getByLabel('Why').fill('Not on the allowed list, per the certifier.');
    await row.getByRole('button', { name: 'Save answer' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Answer saved.' })).toBeVisible();
    await expect(row.getByTestId('organic-treatment-outcome')).toHaveText(
      'Status lost (owner answered: ends organic status)'
    );
    await noHorizontalOverflow(page);

    await open(page, `/animals/${henId}/health`);
    await expect(page.getByTestId('organic-status-line')).toContainText(
      'Status lost after a treatment on'
    );
    await open(page, `/animals/groups/${out.group.id}`);
    await noHorizontalOverflow(page);
  });

  test('shipped library products show their organic-use fact beside the review (34A)', async ({
    page
  }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    const out = await post<{ group: { id: string }; members: { id: string }[] }>(
      page,
      '/api/animal-groups',
      {
        name: 'Herd',
        speciesId: 'cattle',
        headCount: 2,
        members: [{ name: 'Daisy' }, { name: 'Rosie' }]
      }
    );
    await post(page, '/api/organic/status', {
      subjectType: 'group',
      subjectId: out.group.id,
      status: 'organic',
      effectiveOn: '2025-01-01',
      certifier: 'Valley Organic'
    });
    const [daisy, rosie] = out.members.map((m) => m.id);
    await post(page, '/api/animals/health/record', {
      subjectType: 'animal',
      subjectId: daisy,
      kind: 'deworm',
      productPluginId: 'cydectin-pour-on',
      route: 'pour-on',
      labelUse: 'label',
      administeredAt: Date.now() - DAY
    });
    await post(page, '/api/animals/health/record', {
      subjectType: 'animal',
      subjectId: rosie,
      kind: 'deworm',
      productPluginId: 'ivomec-injection',
      route: 'injection-sc',
      labelUse: 'label',
      administeredAt: Date.now() - DAY
    });

    await open(page, '/records/organic');
    const rows = page.getByTestId('organic-treatment');
    const moxidectin = rows.filter({ hasText: 'Cydectin' });
    await expect(moxidectin.getByTestId('organic-treatment-outcome')).toHaveText('Needs review');
    await expect(moxidectin.getByTestId('organic-use-fact')).toContainText(
      'Library entry: allowed for organic use with conditions (7 CFR 205.603(a)(23)(ii)). Conditions: Parasiticides'
    );
    const ivermectin = rows.filter({ hasText: 'Ivomec' });
    await expect(ivermectin.getByTestId('organic-treatment-outcome')).toHaveText('Needs review');
    await expect(ivermectin.getByTestId('organic-use-fact')).toHaveCount(0);
    await noHorizontalOverflow(page);

    await open(page, `/animals/${daisy}/health`);
    await expect(page.getByTestId('organic-outcome')).toContainText('Needs review');

    // The Spanish fact line is covered by routes/records/organic/page.server.test.ts;
    // this server runs English only.
    await noHorizontalOverflow(page);
  });

  test('a garden household with no organic status sees no organic chrome', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signInNewUser(page, 'garden-organic');
    await createOnboardedFarm(page, { growing: ['garden'] });
    await open(page, '/records');
    await expect(page.getByTestId('organic-records-link')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /organic/i })).toHaveCount(0);
    await open(page, '/records/organic');
    await expect(page.getByTestId('organic-empty')).toBeVisible();
    await noHorizontalOverflow(page);
  });
});
