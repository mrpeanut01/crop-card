import { expect, type Page } from '@playwright/test';

/**
 * Allocation-wizard specs mutate plan state (stock, season setup,
 * plantings), so each spec provisions its own throwaway Owner instead of
 * touching the shared demo tenant other specs + visual baselines read.
 * Flow: sign in with a fresh email → /onboarding creates the Owner →
 * owner-scoped APIs seed blocks, seed stock, and (optionally) Season Setup.
 * No Anthropic key is configured in e2e, so every wizard step runs the
 * deterministic no-key path.
 */

export type WizardTenant = {
  blocks: Array<{ id: string; name: string }>;
  seeds: Array<{ id: string; displayName: string }>;
  year: number;
};

export type WizardTenantOptions = {
  seasonSetup?: boolean;
  seeds?: Array<{ displayName: string; pluginId: string; quantity: number }>;
  blocks?: Array<{ name: string; acres: number }>;
  /** Plant one crop on the first block so the wizard gates on plan-state. */
  existingPlanting?: boolean;
  /** Plant one crop on the first block dated last year (carry-forward history). */
  priorPlanting?: boolean;
};

const DEFAULT_SEEDS = [
  { displayName: 'Bush Bean — Provider', pluginId: 'bush-bean-provider', quantity: 200 },
  { displayName: 'Beet — Detroit Dark Red', pluginId: 'beet-detroit-dark-red', quantity: 300 }
];

const DEFAULT_BLOCKS = [
  { name: 'Wizard Bed North', acres: 0.05 },
  { name: 'Wizard Bed South', acres: 0.05 }
];

function originHeader(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function postJson<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, {
    data: data as Record<string, unknown>,
    headers: { origin: originHeader(page) }
  });
  if (!res.ok()) throw new Error(`${url} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function provisionWizardTenant(
  page: Page,
  opts: WizardTenantOptions = {}
): Promise<WizardTenant> {
  const origin = originHeader(page);
  const email = `wizard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;

  const signin = await page.request.post('/?/signin', {
    form: { email },
    headers: { 'x-sveltekit-action': 'true', origin },
    maxRedirects: 0
  });
  const signinBody = (await signin.json()) as { type?: string; location?: string };
  expect(signinBody.location, 'fresh user should land on onboarding').toBe('/onboarding');

  const onboard = await page.request.post('/onboarding', {
    form: { farmName: `Wizard Farm ${Date.now()}` },
    headers: { 'x-sveltekit-action': 'true', origin },
    maxRedirects: 0
  });
  const onboardBody = (await onboard.json()) as { type?: string; location?: string };
  expect(onboardBody.type, JSON.stringify(onboardBody)).toBe('redirect');

  const year = new Date().getFullYear();
  if (opts.seasonSetup) {
    await postJson(page, '/api/season/setup', {
      year,
      philosophy: 'conventional',
      weedStrategy: 'cultivate-first',
      pestStrategy: 'ipm',
      fertilityApproach: 'synthetic',
      coverCropIntent: 'none',
      sprayCapacity: 'backpack-4gal'
    });
  }

  const blocks: WizardTenant['blocks'] = [];
  for (const b of opts.blocks ?? DEFAULT_BLOCKS) {
    const { block } = await postJson<{ block: { id: string; name: string } }>(
      page,
      '/api/blocks',
      b
    );
    blocks.push({ id: block.id, name: block.name });
  }

  const seeds: WizardTenant['seeds'] = [];
  for (const s of opts.seeds ?? DEFAULT_SEEDS) {
    const { item } = await postJson<{ item: { id: string } }>(page, '/api/stock', {
      category: 'seed',
      displayName: s.displayName,
      defaultUnit: 'seeds',
      pluginId: s.pluginId
    });
    await postJson(page, `/api/stock/${item.id}/set-quantity`, { quantity: s.quantity });
    seeds.push({ id: item.id, displayName: s.displayName });
  }

  if (opts.existingPlanting) {
    await postJson(page, `/api/blocks/${blocks[0].id}/plantings`, {
      cropPluginId: 'beet-detroit-dark-red',
      varietyDisplayName: 'Existing Beet Row'
    });
  }

  if (opts.priorPlanting) {
    await postJson(page, `/api/blocks/${blocks[0].id}/plantings`, {
      cropPluginId: 'bush-bean-provider',
      varietyDisplayName: 'Last Year Beans',
      plantingDate: new Date(year - 1, 4, 15).getTime()
    });
  }

  return { blocks, seeds, year };
}

function wizardDialog(page: Page) {
  return page.locator('.aw-modal');
}

/** Loads /plan and waits for the page to settle. An empty season opens the
 *  wizard on its own, so callers that want the bare page close it here. */
export async function gotoPlanWithoutWizard(page: Page): Promise<void> {
  await page.goto('/plan');
  await page.waitForLoadState('networkidle');
  if (await wizardDialog(page).isVisible()) {
    await page.keyboard.press('Escape');
    await expect(wizardDialog(page)).toHaveCount(0);
  }
}

/** Opens the wizard from the /plan workflow strip CTA and waits for the modal. */
export async function openWizardFromPlan(page: Page): Promise<void> {
  await gotoPlanWithoutWizard(page);
  await page
    .getByRole('button', { name: /^Open wizard/ })
    .first()
    .click();
  await expect(page.getByRole('dialog').first()).toBeVisible();
}
