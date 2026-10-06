import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from '../e2e/lib/test';
import { provisionWizardTenant } from '../e2e/lib/wizardTenant';

// Device sweep (#572): how each engine shows a vault file under the sandbox
// CSP. Images are served inline, PDFs and CSVs as attachments.
const FIX = new URL('./fixtures/', import.meta.url);
const file = (name: string) => readFileSync(new URL(name, FIX));

function origin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5390'
  );
}

async function upload(page: Page, name: string, kind: string): Promise<string> {
  const res = await page.request.post(`/api/documents?kind=${kind}&name=${name}`, {
    data: file(name),
    headers: { origin: origin(page) }
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const body = (await res.json()) as { document: { id: string } };
  return body.document.id;
}

test('vault files open and embed under the sandbox CSP', async ({ page }, info) => {
  test.setTimeout(120_000);
  await provisionWizardTenant(page, { seeds: [], blocks: [{ name: 'North Field', acres: 1 }] });
  const ids = {
    png: await upload(page, 'small.png', 'other'),
    jpeg: await upload(page, 'small.jpg', 'other'),
    pdf: await upload(page, 'report.pdf', 'other')
  };
  const results: Record<string, unknown> = { project: info.project.name };

  for (const [k, id] of Object.entries(ids)) {
    const res = await page.request.get(`/api/documents/${id}/file`);
    results[`${k}.disposition`] = res.headers()['content-disposition']?.split(';')[0];
  }

  await page.goto('/settings/documents');
  await page.waitForLoadState('networkidle');
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  for (const k of ['png', 'jpeg'] as const) {
    const w = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      try {
        await img.decode();
      } catch {
        return 0;
      }
      return img.naturalWidth;
    }, `/api/documents/${ids[k]}/file`);
    results[`${k}.imgEmbedWidth`] = w;
    expect(w).toBeGreaterThan(0);

    const row = page.getByTestId('document-row').nth(k === 'png' ? 0 : 1);
    void row;
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.evaluate(
        (href) => window.open(href, '_blank', 'noopener') && undefined,
        `/api/documents/${ids[k]}/file`
      )
    ]).catch(() => [null]);
    if (popup) {
      await popup.waitForLoadState().catch(() => undefined);
      const shot = await popup.screenshot().catch(() => null);
      results[`${k}.tabScreenshotBytes`] = shot?.length ?? 0;
      results[`${k}.tabImgWidth`] = await popup
        .evaluate(() => (document.images[0] as HTMLImageElement | undefined)?.naturalWidth ?? -1)
        .catch((e: Error) => `eval-blocked: ${e.message.split('\n')[0]}`);
      await popup.close();
    } else {
      results[`${k}.tab`] = 'no popup';
    }
  }

  // The "Open" link on a PDF: an attachment, so a download, not a viewer.
  const link = page.getByRole('link', { name: 'Open' });
  const count = await link.count();
  results.openLinks = count;
  const pdfHref = `/api/documents/${ids.pdf}/file`;
  const pdfLink = page.locator(`a[href="${pdfHref}"]`);
  const download = page.waitForEvent('download', { timeout: 10_000 }).catch(() => null);
  const popup = page.waitForEvent('popup', { timeout: 10_000 }).catch(() => null);
  await pdfLink.click();
  const [d, p] = await Promise.all([download, popup]);
  let dl = d;
  if (!dl && p) dl = await p.waitForEvent('download', { timeout: 5_000 }).catch(() => null);
  results['pdf.open'] = dl
    ? `download ${dl.suggestedFilename()}`
    : p
      ? `popup ${p.url()}`
      : 'nothing';
  if (dl) {
    const path = await dl.path().catch(() => null);
    results['pdf.downloadBytes'] = path ? readFileSync(path).length : 'n/a';
  }

  // An <iframe> of the attachment PDF from the app page.
  await page.evaluate((src) => {
    const f = document.createElement('iframe');
    f.src = src;
    f.id = 'pdf-frame';
    f.width = '400';
    f.height = '300';
    document.body.append(f);
  }, pdfHref);
  await page.waitForTimeout(1500);
  results['pdf.iframe'] = await page
    .frameLocator('#pdf-frame')
    .locator('body')
    .innerHTML({ timeout: 2000 })
    .then((h) => (h.length ? `body ${h.length} chars` : 'empty body'))
    .catch((e: Error) => `unreadable (${e.message.split('\n')[0].slice(0, 60)})`);
  results.consoleErrors = errors;
  console.log('RESULT ' + JSON.stringify(results));
});
