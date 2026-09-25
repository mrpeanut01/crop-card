/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import AllocationWizard from './AllocationWizard.svelte';
import type { SeasonSetup } from '$lib/season/setup';

// The e2e suite (tests/e2e/allocation-wizard.spec.ts) drives every step on
// the no-key path. The refine chat only renders its input when an Anthropic
// key is configured, which e2e can't provision hermetically, so the AI-on
// chat paths are covered here against a stubbed fetch.

const BEAN = '11111111-1111-4111-8111-111111111111';
const BEET = '22222222-2222-4222-8222-222222222222';
const NORTH = '33333333-3333-4333-8333-333333333333';
const SOUTH = '44444444-4444-4444-8444-444444444444';

const setup: SeasonSetup = {
  philosophy: 'conventional',
  weedStrategy: 'cultivate-first',
  pestStrategy: 'ipm',
  fertilityApproach: 'synthetic',
  coverCropIntent: 'none',
  sprayCapacity: 'backpack-4gal',
  transitioningStartedYear: null,
  year: 2026,
  setAt: 0
};

const seedStock = [
  {
    stockItemId: BEAN,
    displayName: 'Bush Bean — Provider',
    onHand: 200,
    defaultUnit: 'seeds',
    cropPluginId: 'bush-bean-provider',
    cropFamily: 'legume'
  },
  {
    stockItemId: BEET,
    displayName: 'Beet — Detroit Dark Red',
    onHand: 300,
    defaultUnit: 'seeds',
    cropPluginId: 'beet-detroit-dark-red',
    cropFamily: 'root'
  }
];

const blocks = [
  { id: NORTH, name: 'North Bed', acres: 0.05, plantings: [] },
  { id: SOUTH, name: 'South Bed', acres: 0.05, plantings: [] }
];

function assignment(stockItemId: string, blockId: string, plants: number) {
  return {
    stockItemId,
    cropPluginId: stockItemId === BEAN ? 'bush-bean-provider' : 'beet-detroit-dark-red',
    varietyDisplayName: stockItemId === BEAN ? 'Bush Bean — Provider' : 'Beet — Detroit Dark Red',
    blockId,
    plants
  };
}

const allocateResponse = {
  assignments: [assignment(BEAN, NORTH, 170), assignment(BEET, SOUTH, 255)],
  unplaced: [],
  sufficiency: {},
  rationale: 'Initial AI plan.',
  perRowRationale: {},
  advisories: [],
  meta: { model: 'claude-haiku-4-5', usdEstimate: 0 }
};

type Route = (body: unknown) => { status?: number; json: unknown };
let routes: Record<string, Route>;
let calls: Array<{ key: string; body: unknown }>;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

beforeEach(() => {
  calls = [];
  routes = {
    'GET /api/plan/wizard/draft': () => ({ json: { draft: null } }),
    'POST /api/plan/allocate': () => ({ json: allocateResponse }),
    'POST /api/wizard/chat': () => ({ json: { ok: true } })
  };
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const key = `${init?.method ?? 'GET'} ${url}`;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ key, body });
      const route = routes[key];
      if (!route) return jsonResponse(404, { error: `unrouted ${key}` });
      const r = route(body);
      return jsonResponse(r.status ?? 200, r.json);
    })
  );
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderWizard(extra: Record<string, unknown> = {}) {
  return render(AllocationWizard, {
    seedStock,
    blocks,
    plantingGuides: {},
    cropCatalog: [],
    seasonSetup: setup,
    currentYear: 2026,
    aiEnabled: true,
    wizardPlanId: 'season-2026',
    onClose: vi.fn(),
    onCommitted: vi.fn(),
    ...extra
  });
}

async function driveToReview() {
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bush Bean — Provider' }));
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Beet — Detroit Dark Red' }));
  await fireEvent.click(screen.getByRole('button', { name: /^Next: blocks/ }));
  await fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
  await fireEvent.click(screen.getByRole('button', { name: /^Generate plan \(2 blocks\)/ }));
  await screen.findByText('Initial AI plan.', { exact: false });
}

function reviewRows(): string[] {
  const table = screen.getAllByRole('table')[0];
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((r) =>
      within(r)
        .getAllByRole('cell')
        .slice(0, 3)
        .map((c) => c.textContent?.trim())
        .join('|')
    );
}

async function sendChat(text: string) {
  const box = screen.getByRole('textbox', { name: 'Refinement request' });
  await fireEvent.input(box, { target: { value: text } });
  await fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('AllocationWizard refine chat (AI on)', () => {
  it('seeds the allocation chat, sends a refine turn, and applies the new plan', async () => {
    routes['POST /api/plan/allocate/refine'] = () => ({
      json: {
        ...allocateResponse,
        assignments: [assignment(BEAN, SOUTH, 170), assignment(BEET, SOUTH, 255)],
        rationale: 'Moved beans south.',
        reply: 'Moved the beans onto South Bed.'
      }
    });
    renderWizard();
    await driveToReview();

    expect(screen.getByRole('heading', { name: /Refine with AI/ })).toBeInTheDocument();
    const log = screen.getByRole('log');
    expect(log.textContent).toMatch(/Plan looks clean/);
    expect(reviewRows()).toEqual([
      'Bush Bean — Provider|North Bed|170',
      'Beet — Detroit Dark Red|South Bed|255'
    ]);

    await sendChat('move the beans south');
    await screen.findByText('Moved the beans onto South Bed.');
    expect(reviewRows()).toEqual([
      'Bush Bean — Provider|South Bed|170',
      'Beet — Detroit Dark Red|South Bed|255'
    ]);

    const refine = calls.find((c) => c.key === 'POST /api/plan/allocate/refine');
    const refineBody = refine?.body as {
      blockIds: string[];
      transcript: Array<{ role: string; content: string }>;
      previousPlan: { assignments: unknown[] };
    };
    expect(refineBody.blockIds.sort()).toEqual([NORTH, SOUTH].sort());
    expect(refineBody.transcript).toEqual([{ role: 'user', content: 'move the beans south' }]);
    expect(refineBody.previousPlan.assignments).toHaveLength(2);

    const persisted = calls
      .filter((c) => c.key === 'POST /api/wizard/chat')
      .map((c) => c.body as { step: string; role: string });
    expect(persisted).toEqual([
      expect.objectContaining({ step: 'allocation', role: 'user', planId: 'season-2026' }),
      expect.objectContaining({ step: 'allocation', role: 'assistant' })
    ]);
  });

  it('keeps the plan on a validator fallback and offers "Apply anyway"', async () => {
    routes['POST /api/plan/allocate/refine'] = () => ({
      json: {
        ...allocateResponse,
        reply: 'Packed everything north.',
        meta: {
          model: 'claude-haiku-4-5',
          usdEstimate: 0,
          fallback: 'engine-only',
          violationsOnFirstAttempt: [
            `assignment[0] (${BEAN} → ${NORTH}) is not in the candidacy matrix`
          ],
          rejectedAssignments: [assignment(BEAN, NORTH, 170), assignment(BEET, NORTH, 255)],
          rejectedRationale: 'All north.'
        }
      }
    });
    renderWizard();
    await driveToReview();
    await sendChat('pack everything north');

    await screen.findByText(/Could not apply the change cleanly/);
    expect(screen.getByRole('log').textContent).toContain(
      'The AI proposed planting “Bush Bean — Provider” on “North Bed”'
    );
    expect(reviewRows()[1]).toBe('Beet — Detroit Dark Red|South Bed|255');

    await fireEvent.click(screen.getByRole('button', { name: /Apply anyway \(2 rows\)/ }));
    expect(reviewRows()).toEqual([
      'Bush Bean — Provider|North Bed|170',
      'Beet — Detroit Dark Red|North Bed|255'
    ]);
    expect(screen.queryByRole('button', { name: /Apply anyway/ })).not.toBeInTheDocument();
    expect(screen.getByRole('log').textContent).toContain('Applied the AI plan over the validator');
  });

  it('rolls back the optimistic user turn when refine errors', async () => {
    routes['POST /api/plan/allocate/refine'] = () => ({ status: 500, json: { error: 'boom' } });
    renderWizard();
    await driveToReview();
    await sendChat('break it');

    await screen.findByText('boom');
    expect(screen.getByRole('log').textContent).not.toContain('break it');
    expect(screen.getByRole('textbox', { name: 'Refinement request' })).toHaveValue('break it');
  });

  it('runs a separate schedule transcript that refines dates', async () => {
    const day = Date.UTC(2026, 4, 1);
    const scheduled = [
      {
        stockItemId: BEAN,
        blockId: NORTH,
        cropPluginId: 'bush-bean-provider',
        varietyDisplayName: 'Bush Bean — Provider',
        plantingDateMs: day,
        plants: 170,
        rationale: 'Earliest window.'
      }
    ];
    routes['POST /api/plan/schedule'] = () => ({
      json: {
        scheduled,
        rationale: 'AI dates.',
        advisories: [],
        meta: { model: 'claude-haiku-4-5', usdEstimate: 0 }
      }
    });
    routes['POST /api/plan/schedule/refine'] = () => ({
      json: {
        scheduled: [{ ...scheduled[0], plantingDateMs: day + 14 * 86_400_000 }],
        rationale: 'Pushed two weeks.',
        advisories: [],
        reply: 'Pushed the beans two weeks later.',
        meta: { model: 'claude-haiku-4-5', usdEstimate: 0 }
      }
    });
    renderWizard();
    await driveToReview();
    await fireEvent.click(screen.getByRole('button', { name: 'Accept all → schedule' }));
    await screen.findByText(/Planting dates proposed above/);
    expect(screen.getByRole('log').textContent).not.toMatch(/Plan looks clean/);

    await sendChat('push beans two weeks');
    await screen.findByText('Pushed the beans two weeks later.');
    expect(screen.getByText('Pushed two weeks.', { exact: false })).toBeInTheDocument();
    const refine = calls.find((c) => c.key === 'POST /api/plan/schedule/refine')?.body as {
      previousScheduled: unknown[];
      transcript: unknown[];
    };
    expect(refine.previousScheduled).toHaveLength(1);
    expect(refine.transcript).toEqual([{ role: 'user', content: 'push beans two weeks' }]);

    await fireEvent.click(screen.getByRole('button', { name: 'Back to allocation' }));
    await waitFor(() => expect(screen.getByRole('log').textContent).toMatch(/Plan looks clean/));
  });

  it('hydrates resumed transcripts instead of re-seeding', async () => {
    renderWizard({
      initialChatMessages: [
        { step: 'allocation', role: 'user', content: 'earlier question' },
        { step: 'allocation', role: 'assistant', content: 'earlier answer' },
        { step: 'allocation', role: 'system', content: 'hidden' }
      ]
    });
    await driveToReview();
    const log = screen.getByRole('log');
    expect(log.textContent).toContain('earlier question');
    expect(log.textContent).toContain('earlier answer');
    expect(log.textContent).not.toContain('hidden');
    expect(log.textContent).not.toMatch(/Plan looks clean/);
  });
});

describe('AllocationWizard seeds step recovery', () => {
  it('links a plugin-less seed lot inline and refreshes the parent', async () => {
    const onRefreshParent = vi.fn();
    routes['POST /api/plugins/search-by-name'] = () => ({
      json: {
        candidates: [
          { pluginId: 'bush-bean-provider', displayName: 'Bush Bean — Provider', score: 0.92 }
        ]
      }
    });
    routes['PATCH /api/stock/stock-unlinked'] = () => ({ json: { ok: true } });
    renderWizard({
      onRefreshParent,
      seedStock: [
        ...seedStock,
        {
          stockItemId: 'stock-unlinked',
          displayName: 'Mystery Bean',
          onHand: 50,
          defaultUnit: 'seeds',
          cropPluginId: null,
          cropFamily: null
        }
      ]
    });

    expect(screen.getByText('1 seed need a crop plugin')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Link to crop plugin →' }));
    const search = screen.getByRole('searchbox', { name: 'Search crop plugin library' });
    await fireEvent.input(search, { target: { value: 'bean' } });
    const result = await screen.findByRole('button', { name: /Bush Bean — Provider\s*92% match/ });
    expect(calls.find((c) => c.key === 'POST /api/plugins/search-by-name')?.body).toEqual({
      query: 'bean',
      hintType: 'crop',
      skipWebSearch: true
    });

    await fireEvent.click(result);
    await waitFor(() => expect(onRefreshParent).toHaveBeenCalledTimes(1));
    expect(calls.find((c) => c.key === 'PATCH /api/stock/stock-unlinked')?.body).toEqual({
      pluginId: 'bush-bean-provider'
    });
    expect(screen.queryByRole('dialog', { name: 'Pick a crop plugin' })).not.toBeInTheDocument();
  });

  it('keeps search text and seed choices across a Back/Next round trip', async () => {
    renderWizard();
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Beet — Detroit Dark Red' }));
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search seed lots' }), {
      target: { value: 'beet' }
    });
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /^Next: blocks/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('searchbox', { name: 'Search seed lots' })).toHaveValue('beet');
    expect(screen.getByRole('checkbox', { name: 'Select Beet — Detroit Dark Red' })).toBeChecked();
  });
});
