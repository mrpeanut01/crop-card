import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';
import { enableFixtureClaude } from './lib/fixtureClaude';
import { FIXTURE_BRIEF_REPLY } from '../../src/lib/server/aiFixture/gardenBrief';

// #870, the Phase 37 follow-ups: undo a waterer skip on /today (FU870-2),
// the gallons split and typed shares plus "running since" on the equipment
// page (FU870-1, FU870-4), and the garden brief's stored conversation for a
// returning owner (FU870-3).

const DAY = 86_400_000;
/** Lynchburg (KLYH) is the only weather station, about 25 miles away. */
const FAR_FROM_STATION: [number, number] = [37.6, -79.5];
const TIMER = 'Drip timer';

async function send<T>(page: Page, method: 'post' | 'put', url: string, data: unknown): Promise<T> {
  const res = await page.request[method](url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

/** An herb Area with two beds and basil in the first, on a daily drip timer. */
async function herbGardenWithTimer(
  page: Page,
  schedule: Record<string, unknown>,
  targets: (ids: { field: string; bed1: string; bed2: string }) => Record<string, unknown>
) {
  await signInNewUser(page, 'fu870');
  await createOnboardedFarm(page, { growing: ['garden'], latLon: FAR_FROM_STATION });
  const { field } = await send<{ field: { id: string } }>(page, 'post', '/api/fields', {
    name: 'Herb beds',
    kind: 'garden',
    widthFt: 10,
    lengthFt: 10
  });
  const bed = async (name: string, lengthFt: number) =>
    (
      await send<{ block: { id: string } }>(page, 'post', '/api/blocks', {
        name,
        kind: 'bed',
        widthFt: 4,
        lengthFt,
        fieldId: field.id
      })
    ).block.id;
  const bed1 = await bed('Bed 1', 8);
  const bed2 = await bed('Bed 2', 4);
  await send(page, 'post', `/api/blocks/${bed1}/plantings`, {
    cropPluginId: 'basil-genovese',
    plantingDate: Date.now() - 10 * DAY
  });
  const { equipment } = await send<{ equipment: { id: string } }>(page, 'post', '/api/equipment', {
    type: 'irrigation',
    label: TIMER,
    spec: {
      templateId: 'irrigation-drip-timer',
      schedule: {
        days: [0, 1, 2, 3, 4, 5, 6],
        start: '06:00',
        minutes: 20,
        method: 'drip',
        ...schedule
      }
    }
  });
  await send(
    page,
    'put',
    `/api/equipment/${equipment.id}/water-targets`,
    targets({ field: field.id, bed1, bed2 })
  );
  return { timerId: equipment.id };
}

test.describe('Phase 37 follow-ups (#870)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a skipped run shows on /today with an Undo that puts it back', async ({ page }) => {
    await herbGardenWithTimer(page, { inchesPerRun: 0.4 }, ({ field }) => ({
      areaIds: [field],
      blockIds: []
    }));

    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    const card = page.locator('[data-testid="advice-card"][data-kind="watering"]');
    await expect(card).toHaveCount(1);
    const gives = card.locator('p.line', { hasText: `${TIMER} gives 0.4 in` });
    await expect(gives).toHaveCount(1);
    const before = (await gives.textContent()) ?? '';
    await expect(card.getByTestId('advice-skip')).toHaveCount(0);

    await card
      .getByTestId('advice-skip-run')
      .filter({ hasText: `Skip ${TIMER}` })
      .click();
    await expect(page.getByText("Skipped. That run won't count as water.")).toBeVisible();
    const skipLine = card.getByTestId('advice-skip');
    await expect(skipLine).toHaveCount(1);
    await expect(skipLine).toContainText(`${TIMER} skipped`);
    await expect(skipLine).toContainText('another reason');
    await expect(gives).not.toHaveText(before);

    const undo = skipLine.getByTestId('advice-skip-undo');
    const box = await undo.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    await undo.click();
    await expect(page.getByText('Skip undone. That run counts as water again.')).toBeVisible();
    await expect(card.getByTestId('advice-skip')).toHaveCount(0);
    await expect(card.locator('p.line', { hasText: `${TIMER} gives 0.4 in` })).toHaveText(before);
  });

  test('the equipment page splits gallons by size, takes typed shares and a running-since day', async ({
    page
  }) => {
    const { timerId } = await herbGardenWithTimer(
      page,
      { gallonsPerMinute: 2 },
      ({ bed1, bed2 }) => ({ areaIds: [], blockIds: [bed1, bed2] })
    );
    await page.goto(`/equipment/${timerId}`);
    await page.waitForLoadState('networkidle');
    const editor = page.getByTestId('waterer-editor');
    const split = editor.getByTestId('waterer-split');
    await expect(split).toContainText('Herb beds · Bed 1: 67% of the gallons, by size');
    await expect(split).toContainText('Herb beds · Bed 2: 33% of the gallons, by size');

    await editor.getByTestId('waterer-type-shares').check();
    await editor.getByLabel('Share for Herb beds · Bed 1 (%)').fill('70');
    await editor.getByLabel('Share for Herb beds · Bed 2 (%)').fill('20');
    await expect(editor.getByTestId('waterer-shares-total')).toHaveText('Total: 90%');
    await editor.getByTestId('waterer-targets-save').click();
    await expect(editor.getByRole('alert')).toHaveText('The shares must add up to 100%.');
    await editor.getByLabel('Share for Herb beds · Bed 2 (%)').fill('30');
    await editor.getByTestId('waterer-targets-save').click();
    await expect(split).toContainText('Herb beds · Bed 1: 70% of the gallons');
    await expect(split).not.toContainText('by size');

    const since = new Date(Date.now() - 3 * DAY).toISOString().slice(0, 10);
    await editor.getByTestId('waterer-edit').click();
    await editor.getByTestId('waterer-running-since-input').fill(since);
    await editor.getByTestId('waterer-save').click();
    await expect(editor.getByTestId('waterer-running-since')).toContainText('Running since');
    const saved = (await (await page.request.get(`/api/equipment/${timerId}`)).json()) as {
      equipment: { spec: { schedule: { runningSince?: string } } };
    };
    expect(saved.equipment.spec.schedule.runningSince).toBe(since);
  });

  test('a returning owner sees the brief conversation, and starting over clears it', async ({
    page
  }) => {
    await signInNewUser(page, 'fu870-brief');
    await createOnboardedFarm(page);
    await enableFixtureClaude(page);
    await page.goto('/plan/brief');
    await expect(page.getByTestId('garden-brief')).toHaveAttribute('data-ready', 'true');

    const chat = page.getByTestId('brief-chat');
    await chat.getByLabel('Your message').fill('I cook a lot of pasta.');
    const turn = page.waitForResponse((r) => r.url().endsWith('/api/garden/brief/chat'));
    await chat.getByRole('button', { name: 'Send' }).click();
    await turn;
    await expect(chat).toContainText(FIXTURE_BRIEF_REPLY);

    await page.reload();
    await expect(page.getByTestId('garden-brief')).toHaveAttribute('data-ready', 'true');
    await expect(chat).toContainText('I cook a lot of pasta.');
    await expect(chat).toContainText(FIXTURE_BRIEF_REPLY);
    await expect(page.getByTestId('brief-turns')).toHaveText('7 turns left');
    const stored = (await (await page.request.get('/api/garden/brief')).json()) as {
      brief: { transcript: Array<{ question: string; reply: string; provenance: string }> };
    };
    expect(stored.brief.transcript).toEqual([
      expect.objectContaining({
        question: 'I cook a lot of pasta.',
        reply: FIXTURE_BRIEF_REPLY,
        provenance: 'ai'
      })
    ]);

    await page.getByRole('button', { name: 'Start over' }).click();
    await page.getByRole('button', { name: 'Yes, clear the brief' }).click();
    await expect(page.getByText('The brief is cleared.')).toBeVisible();
    await expect(chat).not.toContainText('I cook a lot of pasta.');
    await page.reload();
    await expect(page.getByTestId('garden-brief')).toHaveAttribute('data-ready', 'true');
    await expect(chat).not.toContainText('I cook a lot of pasta.');
    await expect(page.getByTestId('brief-turns')).toHaveText('8 turns left');
  });
});
