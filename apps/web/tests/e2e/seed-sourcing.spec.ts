import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionHelper } from './lib/freshFarm';
import { provisionWizardTenant } from './lib/wizardTenant';

// Phase 33B (B3, B-37 to B-39): on a farm with an owner-entered organic
// status, a seed lot shows "Seed status not recorded" until the owner says
// what the seed is. Untreated seed with no supplier check reads "No search
// on file"; adding a check and a search evidence file clears the flag. A
// helper sees the same facts with no way to change them.

function origin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

function pdf(marker: string): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${marker}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`
  );
}

async function openSeed(page: Page, itemId: string): Promise<void> {
  await page.goto(`/inventory/seed/${itemId}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Organic seed sourcing' })).toBeVisible();
}

test.describe('organic seed sourcing', () => {
  test.describe.configure({ timeout: 180_000 });

  test('an owner records seed status, a supplier check and evidence; a helper reads it', async ({
    page,
    browser
  }) => {
    const farm = await provisionWizardTenant(page, {
      seeds: [{ displayName: 'Bush Bean Provider', pluginId: 'bush-bean-provider', quantity: 200 }],
      blocks: [{ name: 'Bean Bed', acres: 0.05 }]
    });
    const itemId = farm.seeds[0].id;

    await page.goto(`/inventory/seed/${itemId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Organic seed sourcing' })).toHaveCount(0);

    const status = await page.request.post('/api/organic/status', {
      data: {
        subjectType: 'block',
        subjectId: farm.blocks[0].id,
        status: 'organic',
        effectiveOn: '2024-01-01'
      },
      headers: { origin: origin(page) }
    });
    expect(status.status(), await status.text()).toBe(201);

    await openSeed(page, itemId);
    const lot = page.getByTestId('seed-sourcing').first();
    await expect(lot.getByTestId('seed-status')).toHaveText('Not recorded');
    await expect(lot.getByTestId('seed-search-flag')).toHaveText('Seed status not recorded');

    const edit = lot.getByRole('button', { name: 'Edit seed sourcing' });
    await expect(async () => {
      await edit.click({ timeout: 2000 });
      await expect(lot.getByLabel('Seed status')).toBeVisible({ timeout: 1000 });
    }).toPass();
    await lot.getByLabel('Seed status').selectOption('untreated');
    await lot.getByRole('button', { name: 'Save seed sourcing' }).click();
    await expect(lot.getByTestId('seed-status')).toHaveText('Untreated, not organic');
    await expect(lot.getByTestId('seed-search-flag')).toHaveText('No search on file');

    await lot.getByRole('button', { name: 'Edit seed sourcing' }).click();
    await lot.getByRole('button', { name: 'Add a supplier check' }).click();
    await lot.getByLabel('Supplier').fill('Johnny Seeds');
    await lot.getByLabel('Date checked').fill('2026-01-15');
    await lot.getByLabel('What you found').fill('No organic seed of this variety');
    await lot.getByLabel(/Why organic seed was not used/).fill('Only untreated seed was offered.');
    const saveBox = await lot.getByRole('button', { name: 'Save seed sourcing' }).boundingBox();
    expect(saveBox!.height).toBeGreaterThanOrEqual(48);
    await lot.getByRole('button', { name: 'Save seed sourcing' }).click();
    await expect(lot.getByTestId('seed-search-flag')).toHaveCount(0);
    await expect(lot.getByTestId('seed-checks')).toContainText('Johnny Seeds');
    await expect(lot.getByTestId('seed-checks')).toContainText('No organic seed of this variety');
    await expect(lot).toContainText('Only untreated seed was offered.');

    await lot.getByTestId('document-attach-input').setInputFiles({
      name: 'Seed search emails.pdf',
      mimeType: 'application/pdf',
      buffer: pdf('E2E-SEED-SEARCH')
    });
    await expect(lot.getByRole('link', { name: 'Seed search emails' })).toBeVisible({
      timeout: 20_000
    });

    await page.reload();
    await page.waitForLoadState('networkidle');
    const again = page.getByTestId('seed-sourcing').first();
    await expect(again.getByTestId('seed-status')).toHaveText('Untreated, not organic');
    await expect(again.getByTestId('seed-checks')).toContainText('Johnny Seeds');
    await expect(again.getByRole('link', { name: 'Seed search emails' })).toBeVisible();

    await page.setViewportSize({ width: 375, height: 800 });
    await page.reload();
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const helper = await provisionHelper(page, browser);
    await openSeed(helper, itemId);
    const helperLot = helper.getByTestId('seed-sourcing').first();
    await expect(helperLot.getByTestId('seed-status')).toHaveText('Untreated, not organic');
    await expect(helper.getByTestId('seed-sourcing-rule')).toHaveText(
      'The organic rules require organically grown seeds, annual seedlings and planting stock, except as 7 CFR 205.204(a) allows. Your certifier decides whether a search was enough.'
    );
    await expect(helperLot.getByTestId('seed-checks')).toContainText('Johnny Seeds');
    await expect(helperLot.getByRole('link', { name: 'Seed search emails' })).toBeVisible();
    await expect(helperLot.getByRole('button', { name: 'Edit seed sourcing' })).toHaveCount(0);
    await expect(helperLot.getByTestId('document-attach-input')).toHaveCount(0);
    const lotId = await helperLot.getAttribute('data-lot-id');
    expect(lotId).toBeTruthy();
    const refused = await helper.request.patch(`/api/stock/${itemId}/lots/${lotId}/seed-sourcing`, {
      data: { status: 'organic', sourcesChecked: [], unavailabilityNote: null },
      headers: { origin: origin(helper) }
    });
    expect(refused.status()).toBe(403);
    await helper.context().close();
  });
});
