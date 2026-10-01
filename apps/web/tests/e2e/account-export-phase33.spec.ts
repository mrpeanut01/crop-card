import { readFile } from 'node:fs/promises';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';

// Phase 33A (A1, A-14): the account export gains the document vault and the
// organic and amendment sections. Document metadata is in the owner's export
// only, so a helper's export never names an owner-only file.

test.describe('account export, Phase 33 sections', () => {
  test.describe.configure({ timeout: 120_000 });

  test("the owner's download carries the new sections; a helper's leaves documents out", async ({
    page,
    browser
  }) => {
    await provisionEmptyFarm(page);
    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');
    const link = page.getByRole('link', { name: 'Download account data (JSON)' });
    await expect(link).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    const json = JSON.parse(await readFile((await download.path())!, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(json.schemaVersion).toBe('1.4.0');
    expect(json.documents).toEqual([]);
    expect(json.organic).toEqual({
      statusEvents: [],
      treatmentReviews: [],
      harvestDispositions: []
    });
    expect(json.amendments).toEqual({
      batches: [],
      batchInputs: [],
      bioassays: [],
      dismissals: [],
      forageTests: []
    });

    const helper = await provisionHelper(page, browser);
    const res = await helper.request.get('/api/account/export.json');
    expect(res.status()).toBe(200);
    const helperJson = (await res.json()) as Record<string, unknown>;
    expect(helperJson.schemaVersion).toBe('1.4.0');
    expect(helperJson).not.toHaveProperty('documents');
    expect(helperJson).toHaveProperty('organic');
    await helper.context().close();
  });
});
