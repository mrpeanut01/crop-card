import { expect, type Page } from '@playwright/test';
import {
  E2E_FIXTURE_API_KEY,
  FIXTURE_REFINE_INVALID,
  FIXTURE_REFINE_VALID
} from '../../../src/lib/aiFixturePhrases';

export { FIXTURE_REFINE_INVALID, FIXTURE_REFINE_VALID };

/** Saves the fixture's sentinel Claude key for the signed-in Owner, so the
 *  e2e preview server (started with E2E_CLAUDE_FIXTURE=1) answers that farm
 *  from the canned fixture. Other farms on the server keep the no-key path. */
export async function enableFixtureClaude(page: Page): Promise<void> {
  const origin =
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173';
  const res = await page.request.post('/api/settings', {
    data: { key: 'anthropic_api_key', value: E2E_FIXTURE_API_KEY },
    headers: { origin }
  });
  expect(res.ok(), await res.text()).toBe(true);
  const usage = await page.request.get('/api/ai/usage');
  expect(((await usage.json()) as { aiAvailable: boolean }).aiAvailable).toBe(true);
}
