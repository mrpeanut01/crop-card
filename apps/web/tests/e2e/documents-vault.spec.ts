import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionHelper } from './lib/freshFarm';
import { provisionWizardTenant } from './lib/wizardTenant';

// Phase 33A (A3): the owner attaches last spring's lab report to a soil
// test, opens it, finds it on the soil test Card, deletes it and sees the
// "Deleted" line; the GDPR ZIP carries every stored file; a helper cannot
// open an owner-only file; /settings/documents shows the usage meter.

function pdf(marker: string): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${marker}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`
  );
}

function origin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('document vault', () => {
  test.describe.configure({ timeout: 150_000 });

  test('an owner attaches a lab report to a soil test, opens it and deletes it', async ({
    page
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const farm = await provisionWizardTenant(page, {
      seasonSetup: true,
      seeds: [],
      blocks: [{ name: 'North Field', acres: 1 }]
    });
    const blockId = farm.blocks[0].id;

    await page.goto(`/fertility?block=${blockId}`);
    await page.waitForLoadState('networkidle');
    const form = page.getByTestId('setup-soil-test');
    await expect(async () => {
      await page.getByRole('button', { name: 'Add a soil test' }).click({ timeout: 2000 });
      await expect(form).toBeVisible({ timeout: 1000 });
    }).toPass();
    await form.getByLabel('Soil pH').fill('6.4');
    await form.getByTestId('document-attach-input').setInputFiles({
      name: 'VT soil report spring 2026.pdf',
      mimeType: 'application/pdf',
      buffer: pdf('E2E-LAB-REPORT')
    });
    await expect(form.getByText('VT soil report spring 2026')).toBeVisible({ timeout: 20_000 });
    await form.getByRole('button', { name: 'Save soil test' }).click();

    const history = page.getByTestId('soil-test-lab-report').first();
    await expect(history.getByText('VT soil report spring 2026')).toBeVisible({ timeout: 20_000 });
    await noHorizontalOverflow(page);

    const href = await history.getByRole('link', { name: 'Open' }).getAttribute('href');
    expect(href).toMatch(/^\/api\/documents\/[0-9a-f-]{36}\/file$/);
    const file = await page.request.get(href!);
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toBe('application/pdf');
    expect(file.headers()['x-content-type-options']).toBe('nosniff');
    expect(file.headers()['content-security-policy']).toBe(
      "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"
    );
    expect(file.headers()['cache-control']).toBe('private, no-store');
    expect(file.headers()['content-disposition']).toMatch(/^attachment;/);
    expect((await file.body()).toString()).toContain('E2E-LAB-REPORT');

    const snapshot = await page.request.get('/api/cards/snapshot');
    expect(snapshot.ok()).toBe(true);
    const snap = (await snapshot.json()) as {
      soilTests: { labReport: { title: string; deletedAt: number | null } | null }[];
    };
    expect(snap.soilTests[0].labReport).toMatchObject({
      title: 'VT soil report spring 2026',
      deletedAt: null
    });

    const zip = await page.request.get('/api/account/export.zip');
    expect(zip.status()).toBe(200);
    expect(zip.headers()['content-type']).toBe('application/zip');
    const zipBytes = await zip.body();
    expect(zipBytes.includes(Buffer.from('E2E-LAB-REPORT'))).toBe(true);
    expect(zipBytes.includes(Buffer.from('export.json'))).toBe(true);
    expect(zipBytes.includes(Buffer.from('vt-soil-report-spring-2026.pdf'))).toBe(true);

    await history.getByRole('button', { name: 'Delete file' }).click();
    await history.getByTestId('document-delete-confirm').click();
    await expect(history.getByTestId('document-deleted-line')).toContainText('Deleted on', {
      timeout: 20_000
    });
    expect((await page.request.get(href!)).status()).toBe(404);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByTestId('soil-test-lab-report').first().getByTestId('document-deleted-line')
    ).toContainText('Deleted on', { timeout: 20_000 });
  });

  test('settings shows usage, uploads a file, and a helper cannot open it', async ({
    page,
    browser
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await provisionWizardTenant(page, { seeds: [], blocks: [{ name: 'North Field', acres: 1 }] });

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: /Documents/ }).click();
    await expect(page).toHaveURL(/\/settings\/documents$/);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('documents-usage')).toContainText('0 KB of 100 MB used');
    await expect(page.getByText(/backup copies are removed within 30 days/)).toBeVisible();

    await page.getByLabel('What is it?').selectOption('certificate');
    await page.getByLabel(/Title/).fill('Organic certificate 2026');
    await page.getByTestId('documents-upload-input').setInputFiles({
      name: 'cert.pdf',
      mimeType: 'application/pdf',
      buffer: pdf('E2E-CERTIFICATE')
    });
    const row = page.getByTestId('document-row').filter({ hasText: 'Organic certificate 2026' });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText('Not attached to anything');
    await expect(page.getByTestId('documents-usage')).toContainText('of 100 MB used');
    await noHorizontalOverflow(page);

    const refused = await page.request.post('/api/documents?kind=label&name=page.pdf', {
      data: Buffer.from('<html><body>not a pdf</body></html>'),
      headers: { 'content-type': 'application/pdf', origin: origin(page) }
    });
    expect(refused.status()).toBe(415);
    expect(((await refused.json()) as { code: string }).code).toBe('UNSUPPORTED_TYPE');

    const href = await row.getByRole('link', { name: 'Open' }).getAttribute('href');
    expect((await page.request.get(href!)).status()).toBe(200);

    const helper = await provisionHelper(page, browser);
    const helperFile = await helper.request.get(href!);
    expect(helperFile.status()).toBe(404);
    const helperUpload = await helper.request.post('/api/documents?kind=label', {
      data: pdf('HELPER'),
      headers: { origin: origin(page) }
    });
    expect(helperUpload.status()).toBe(403);
    await helper.goto('/settings/documents');
    await helper.waitForLoadState('networkidle');
    await expect(helper.getByText('Only the farm owner can manage documents.')).toBeVisible();
    await helper.context().close();

    await row.getByRole('button', { name: 'Delete' }).click();
    await row.getByRole('button', { name: 'Delete file' }).click();
    await expect(page.getByText('Deleted "Organic certificate 2026".')).toBeVisible({
      timeout: 20_000
    });
    await expect(page.getByTestId('document-row')).toHaveCount(0);
  });
});
