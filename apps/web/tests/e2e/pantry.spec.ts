import Database from 'better-sqlite3';
import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

// Phase 37C: a kept harvest records how it was kept, and /plan/pantry lists
// it against the garden brief's goals. No AI; the no-key path.

const PORT = Number(process.env.E2E_PORT ?? 5173);
const DB_PATH = PORT === 5173 ? './.playwright-data/test.db' : `./.playwright-data/test-${PORT}.db`;

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

/** 37A owns the brief's form; this stores a saved brief the way its
 *  setting holds one. */
function saveBrief(blockId: string, brief: unknown) {
  const db = new Database(DB_PATH);
  try {
    db.pragma('busy_timeout = 5000');
    const row = db.prepare('SELECT owner_id FROM blocks WHERE id = ?').get(blockId) as {
      owner_id: string;
    };
    db.prepare(
      `INSERT INTO app_settings (owner_id, key, value, updated_at) VALUES (?, 'garden_brief', ?, ?)
       ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value`
    ).run(row.owner_id, JSON.stringify(brief), Date.now());
  } finally {
    db.close();
  }
}

test.describe('pantry (37C)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a kept, dried harvest shows on the pantry with a not known goal', async ({ page }) => {
    await provisionEmptyFarm(page);
    const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
      name: 'Herb bed'
    });
    await post(page, `/api/blocks/${block.id}/plantings`, {
      cropPluginId: 'oregano-greek',
      plantingDate: Date.now() - 120 * 86_400_000
    });
    const { event } = await post<{ event: { id: string } }>(page, '/api/harvest/record', {
      blockId: block.id,
      cropPluginId: 'oregano-greek',
      quantity: '3 bunch'
    });
    saveBrief(block.id, {
      storageGoals: [
        { goal: 'can-or-jelly', provenance: 'manual' },
        { goal: 'dry', target: 'enough for the year', provenance: 'manual' }
      ]
    });

    await page.goto('/harvest');
    await page.waitForLoadState('networkidle');
    await page.getByTestId(`where-it-went-${event.id}`).click();
    const sheet = page.getByRole('dialog', { name: 'Where did it go?' });
    await expect(sheet.getByText('Nothing recorded yet')).toBeVisible();
    await sheet.getByRole('button', { name: 'Kept', exact: true }).click();
    const methods = sheet.getByRole('group', { name: 'How was it kept?' });
    await methods.getByRole('button', { name: 'Dried', exact: true }).click();
    await expect(methods.getByRole('button', { name: 'Dried', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await sheet.getByLabel('How much').fill('2');
    await sheet.getByLabel('Unit').fill('bunch');
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet.getByTestId('disposition-row')).toContainText(/Kept 2 bunch on .*, dried/);

    await page.goto('/plan/pantry');
    await page.waitForLoadState('networkidle');
    const kept = page.getByTestId('pantry-kept-row');
    await expect(kept).toHaveCount(1);
    await expect(kept).toContainText('Dried');
    await expect(kept).toContainText('2 bunch');
    await expect(page.getByTestId('pantry-crop')).toContainText('Oregano');

    const goals = page.getByTestId('pantry-goals').getByTestId('goal-line');
    await expect(goals).toHaveCount(2);
    const canning = goals.filter({ hasText: 'Canning and jelly' });
    await expect(canning).toHaveAttribute('data-status', 'not-known');
    await expect(canning).toContainText('Not known');
    await expect(canning).toContainText('use a tested recipe');
    await expect(goals.filter({ hasText: 'Drying' })).toContainText(
      'Your aim: enough for the year'
    );

    await expect(page.getByTestId('harvest-schedule-panel')).toBeVisible();
    await expect(page.getByTestId('pantry-herb')).toContainText('Oregano');
  });

  test('a drying goal shows the sourced cutting stage, only on herbs with a source (#867)', async ({
    page
  }) => {
    await signInNewUser(page, 'drying-hint');
    await createOnboardedFarm(page, { growing: ['garden'] });
    const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
      name: 'Herb bed'
    });
    const plantingDate = Date.now() - 120 * 86_400_000;
    const planted: Record<string, string> = {};
    for (const cropPluginId of ['rosemary-tuscan-blue', 'mint-spearmint', 'thyme-german-winter']) {
      const { planting } = await post<{ planting: { id: string } }>(
        page,
        `/api/blocks/${block.id}/plantings`,
        { cropPluginId, plantingDate }
      );
      planted[cropPluginId] = planting.id;
    }
    saveBrief(block.id, { storageGoals: [{ goal: 'dry', provenance: 'manual' }] });

    await page.goto('/plan/pantry');
    await page.waitForLoadState('networkidle');
    const herb = (name: string) => page.getByTestId('pantry-herb').filter({ hasText: name });
    const rosemary = herb('Rosemary').getByTestId('harvest-timing');
    await expect(rosemary).toHaveCount(1);
    await expect(rosemary).toContainText('For drying');
    await expect(rosemary).toContainText('Cut just before it flowers.');
    await expect(rosemary).toHaveAttribute('data-stage', 'before-bloom');
    await expect(herb('Mint').getByTestId('harvest-timing')).toContainText(
      'Cut just as it starts to flower.'
    );
    await expect(herb('Thyme').getByTestId('harvest-timing')).toHaveCount(0);
    await expect(
      page.getByTestId('harvest-schedule-panel').getByTestId('harvest-timing')
    ).toHaveCount(0);

    const cut = await post<{ task: { id: string } }>(page, '/api/tasks', {
      kind: 'primary',
      title: 'Cut rosemary',
      cropId: planted['rosemary-tuscan-blue'],
      scheduledFor: Date.now(),
      pluginTemplateKey: `derived:pantry-cut:${planted['rosemary-tuscan-blue']}:e2e`
    });
    const prune = await post<{ task: { id: string } }>(page, '/api/tasks', {
      kind: 'primary',
      title: 'Trim the thyme',
      cropId: planted['thyme-german-winter'],
      scheduledFor: Date.now()
    });
    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    const deck = page.getByTestId('today-deck');
    const cutCard = deck.locator(`.deck-card[data-task-id="${cut.task.id}"]`);
    await expect(cutCard).toContainText('For drying');
    await expect(cutCard).toContainText('Cut just before it flowers.');
    await expect(deck.locator(`.deck-card[data-task-id="${prune.task.id}"]`)).not.toContainText(
      'For drying'
    );
  });

  test('an infuse goal shows the safety line of each medium, on track or not (CO-4, CO-10)', async ({
    page
  }) => {
    await signInNewUser(page, 'infuse-media');
    await createOnboardedFarm(page, { growing: ['garden'] });
    const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
      name: 'Herb bed'
    });
    const plantingDate = Date.now() - 30 * 86_400_000;
    for (const cropPluginId of ['basil-genovese', 'rosemary-tuscan-blue']) {
      await post(page, `/api/blocks/${block.id}/plantings`, { cropPluginId, plantingDate });
    }
    saveBrief(block.id, { storageGoals: [{ goal: 'infuse', provenance: 'manual' }] });

    await page.goto('/plan/pantry');
    await page.waitForLoadState('networkidle');
    const goal = page.getByTestId('pantry-goals').getByTestId('goal-line');
    await expect(goal).toHaveCount(1);
    await expect(goal).toContainText('Vinegars and oils');
    await expect(goal.getByTestId('infuse-safety').first()).toBeVisible();

    const herb = (name: string) => page.getByTestId('pantry-herb').filter({ hasText: name });
    const basil = herb('Basil');
    await expect(basil).toContainText('Infused in oil');
    await expect(basil).toContainText('Infused in vinegar');
    await expect(basil.locator('[data-testid="infuse-safety"][data-medium="oil"]')).toContainText(
      'Herb oil can cause botulism. Keep it in the refrigerator and throw it out 4 days after you make it.'
    );
    await expect(
      basil.locator('[data-testid="infuse-safety"][data-medium="vinegar"]')
    ).toContainText('Use only store-bought vinegar.');
    const rosemary = herb('Rosemary');
    await expect(rosemary.getByTestId('infuse-safety')).toHaveCount(1);
    await expect(rosemary.getByTestId('infuse-safety')).toHaveAttribute('data-medium', 'oil');
  });

  test('a farm with no herbs gets the empty state', async ({ page }) => {
    await provisionEmptyFarm(page);
    await page.goto('/plan/pantry');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('pantry-no-herbs')).toBeVisible();
    await expect(page.getByText('No garden brief yet')).toBeVisible();
  });
});
