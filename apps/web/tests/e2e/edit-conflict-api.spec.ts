import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';

// Phase 36 (E-01 to E-07): an owner and a helper edit the same planting and
// task. A stale edit that carries `base` answers 409 EDIT_CONFLICT and saves
// nothing, a queued replay can be sent again once rebased, and closing a
// task is never refused.

const DAY = 86_400_000;
const CLIENT_RECORD_HEADER = 'x-cropcard-client-record-id';

function originOf(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function send(
  page: Page,
  method: 'POST' | 'PATCH' | 'GET',
  url: string,
  data?: unknown,
  headers: Record<string, string> = {}
) {
  const res = await page.request.fetch(url, {
    method,
    data,
    headers: { origin: originOf(page), ...headers }
  });
  return {
    status: res.status(),
    body: (await res.json()) as Record<string, ReturnType<typeof JSON.parse>>
  };
}

async function seed(page: Page) {
  await provisionEmptyFarm(page);
  const field = await send(page, 'POST', '/api/fields', {
    name: 'North field',
    kind: 'field',
    widthFt: 100,
    lengthFt: 200
  });
  expect(field.status, JSON.stringify(field.body)).toBeLessThan(300);
  const block = await send(page, 'POST', '/api/blocks', {
    name: 'Block 1',
    widthFt: 20,
    lengthFt: 50,
    fieldId: field.body.field.id
  });
  expect(block.status, JSON.stringify(block.body)).toBeLessThan(300);
  const planting = await send(page, 'POST', `/api/blocks/${block.body.block.id}/plantings`, {
    cropPluginId: 'tomato-cherokee-purple',
    plantingDate: Date.now() - 5 * DAY
  });
  expect(planting.status, JSON.stringify(planting.body)).toBeLessThan(300);
  const cropId = (planting.body.planting?.id ?? planting.body.id) as string;
  const task = await send(page, 'POST', '/api/tasks', {
    title: 'Stake the tomatoes',
    kind: 'primary',
    scheduledFor: Date.now() + DAY
  });
  expect(task.status, JSON.stringify(task.body)).toBeLessThan(300);
  return { cropId, taskId: task.body.task.id as string };
}

test.describe('edit conflicts between two devices (API)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a stale planting edit is refused, then saves once rebased and replays as a duplicate', async ({
    page,
    browser
  }) => {
    const { cropId } = await seed(page);
    const helper = await provisionHelper(page, browser);

    const seen = await send(page, 'GET', `/api/crops/${cropId}`);
    const original = seen.body.crop.varietyDisplayName as string;

    const helperSave = await send(helper, 'PATCH', `/api/crops/${cropId}`, {
      action: 'edit-details',
      varietyDisplayName: 'Helper pick',
      base: { varietyDisplayName: original }
    });
    expect(helperSave.status).toBe(200);

    const clientRecordId = `ce_${Date.now()}_e2e`;
    const stale = await send(
      page,
      'PATCH',
      `/api/crops/${cropId}`,
      {
        action: 'edit-details',
        varietyDisplayName: 'Owner pick',
        quantityPlanted: 6,
        base: { varietyDisplayName: original, quantityPlanted: null }
      },
      { [CLIENT_RECORD_HEADER]: clientRecordId }
    );
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      code: 'EDIT_CONFLICT',
      target: 'planting',
      id: cropId,
      action: 'edit-details',
      error: 'Someone else changed this while you were editing. Nothing was saved.',
      fields: [
        { field: 'varietyDisplayName', base: original, mine: 'Owner pick', theirs: 'Helper pick' }
      ]
    });
    expect(stale.body.current.varietyDisplayName).toBe('Helper pick');

    const after = await send(page, 'GET', `/api/crops/${cropId}`);
    expect(after.body.crop.varietyDisplayName).toBe('Helper pick');
    expect(after.body.crop.quantityPlanted).toBeUndefined();

    const rebased = {
      action: 'edit-details',
      varietyDisplayName: 'Owner pick',
      quantityPlanted: 6,
      base: { varietyDisplayName: 'Helper pick', quantityPlanted: null }
    };
    const resend = await send(page, 'PATCH', `/api/crops/${cropId}`, rebased, {
      [CLIENT_RECORD_HEADER]: clientRecordId
    });
    expect(resend.status).toBe(200);
    expect(resend.body.crop).toMatchObject({
      varietyDisplayName: 'Owner pick',
      quantityPlanted: 6
    });

    const replay = await send(page, 'PATCH', `/api/crops/${cropId}`, rebased, {
      [CLIENT_RECORD_HEADER]: clientRecordId
    });
    expect(replay).toEqual({ status: 200, body: { ok: true, duplicate: true } });
    await helper.context().close();
  });

  test('a stale task move is refused, and closing the task never is', async ({ page, browser }) => {
    const { taskId } = await seed(page);
    const helper = await provisionHelper(page, browser);
    const seen = await send(page, 'GET', `/api/tasks/${taskId}`);
    const due = seen.body.primary.scheduledFor as number;

    const moved = await send(helper, 'PATCH', `/api/tasks/${taskId}`, {
      action: 'reschedule',
      scheduledFor: due + DAY,
      base: { scheduledFor: due }
    });
    expect(moved.status).toBe(200);

    const stale = await send(page, 'PATCH', `/api/tasks/${taskId}`, {
      action: 'reschedule',
      scheduledFor: due + 2 * DAY,
      base: { scheduledFor: due }
    });
    expect(stale.status).toBe(409);
    expect(stale.body.fields).toEqual([
      { field: 'scheduledFor', base: due, mine: due + 2 * DAY, theirs: due + DAY }
    ]);
    expect(stale.body.current).toMatchObject({
      title: 'Stake the tomatoes',
      scheduledFor: due + DAY
    });

    const done = await send(helper, 'PATCH', `/api/tasks/${taskId}`, {
      action: 'complete',
      base: { title: 'something old' }
    });
    expect(done.status).toBe(200);
    expect(done.body.task.completedAt).toBeTruthy();
    await helper.context().close();
  });
});
