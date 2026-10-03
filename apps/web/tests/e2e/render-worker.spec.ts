import type { APIResponse, Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';

// Phase 36 (render-worker): compliance PDFs and the account export are made
// in the render worker. The e2e server runs the production build, so these
// go through thread mode.

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

function renderTiming(res: APIResponse): string | undefined {
  return res
    .headersArray()
    .filter((h) => h.name.toLowerCase() === 'server-timing')
    .map((h) => h.value)
    .join(', ')
    .split(/,\s*/)
    .find((part) => part.startsWith('render;'));
}

test.describe('exports rendered off the request path (36)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('an owner downloads the spray PDF and the year in review from /records', async ({
    page
  }) => {
    await provisionEmptyFarm(page);
    await open(page, '/records');

    const pdfLink = page.locator('a[href^="/api/spray/records/export.pdf"]').first();
    await expect(pdfLink).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), pdfLink.click()]);
    const path = await download.path();
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(path!).subarray(0, 5).toString()).toBe('%PDF-');

    const yearLink = page.locator('a[href^="/api/records/year-summary.pdf"]').first();
    if (await yearLink.isVisible()) {
      const [yearDownload] = await Promise.all([page.waitForEvent('download'), yearLink.click()]);
      expect(
        readFileSync((await yearDownload.path())!)
          .subarray(0, 5)
          .toString()
      ).toBe('%PDF-');
    }
  });

  test('PDFs come from the render worker and the VDACS hash is stable', async ({ page }) => {
    await provisionEmptyFarm(page);
    const first = await page.request.get('/api/records/export.vdacs.pdf');
    expect(first.status()).toBe(200);
    expect((await first.body()).subarray(0, 5).toString()).toBe('%PDF-');
    expect(renderTiming(first)).toMatch(/^render;dur=[\d.]+;desc="thread"$/);
    const second = await page.request.get('/api/records/export.vdacs.pdf');
    expect(second.headers()['x-cropcard-integrity-hash']).toMatch(/^[0-9a-f]{64}$/);
    expect(second.headers()['x-cropcard-integrity-hash']).toBe(
      first.headers()['x-cropcard-integrity-hash']
    );

    for (const url of ['/api/spray/records/export.pdf', '/api/records/year-summary.pdf']) {
      const res = await page.request.get(url);
      expect(res.status(), url).toBe(200);
      expect(renderTiming(res), url).toMatch(/desc="thread"/);
    }
  });

  test('the account export JSON is built in the worker and still parses', async ({ page }) => {
    await provisionEmptyFarm(page);
    const res = await page.request.get('/api/account/export.json');
    expect(res.status()).toBe(200);
    expect(renderTiming(res)).toMatch(/desc="thread"/);
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(typeof body).toBe('object');
    expect(text).toBe(JSON.stringify(body, null, 2));
  });

  test('a burst of exports from one farm is either rendered or told to retry', async ({ page }) => {
    await provisionEmptyFarm(page);
    const burst = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        page.request.get('/api/records/export.vdacs.pdf', {
          headers: {
            accept: i % 2 ? 'text/html,application/xhtml+xml' : 'application/json'
          }
        })
      )
    );
    const statuses = burst.map((r) => r.status());
    expect(
      statuses.every((s) => s === 200 || s === 429),
      statuses.join(',')
    ).toBe(true);
    expect(statuses).toContain(200);
    for (const [i, res] of burst.entries()) {
      if (res.status() !== 429) continue;
      expect(res.headers()['retry-after']).toBe('15');
      if (i % 2) {
        const html = await res.text();
        expect(html).toContain('Another export is being made right now.');
        expect(html).toContain('Go back');
      } else {
        expect(await res.json()).toEqual({
          error: 'Another export is being made right now. Try again in a minute.',
          code: 'RENDER_BUSY'
        });
      }
    }
    const after = await page.request.get('/api/records/export.vdacs.pdf');
    expect(after.status()).toBe(200);
  });
  test('a busy export link click shows the retry page instead of a cancelled download', async ({
    page
  }) => {
    await provisionEmptyFarm(page);
    await open(page, '/records');
    // The queue rarely refuses on an idle test server, so the export answers
    // with the server's own refusal page for this click.
    await page.route('**/api/spray/records/export.pdf**', (route) =>
      route.fulfill({
        status: 429,
        headers: { 'retry-after': '15', 'content-type': 'text/html; charset=utf-8' },
        body: '<!doctype html><html lang="en"><p>Another export is being made right now. Try again in a minute.</p><p><a href="javascript:history.back()">Go back</a></p></html>'
      })
    );
    const pdfLink = page.locator('a[href^="/api/spray/records/export.pdf"]').first();
    await expect(pdfLink).not.toHaveAttribute('download');
    let downloaded = false;
    page.on('download', () => (downloaded = true));
    await pdfLink.click();
    await expect(page.getByText('Another export is being made right now.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go back' })).toBeVisible();
    expect(downloaded).toBe(false);

    await page.unroute('**/api/spray/records/export.pdf**');
    await open(page, '/records');
    for (const sel of [
      'a[href^="/api/records/export.vdacs.pdf"]',
      'a[href^="/api/records/year-summary.pdf"]'
    ]) {
      for (const link of await page.locator(sel).all()) {
        await expect(link).not.toHaveAttribute('download');
      }
    }
    await open(page, '/settings/account');
    await expect(page.locator('a[href="/api/account/export.json"]')).not.toHaveAttribute(
      'download'
    );
  });
});
