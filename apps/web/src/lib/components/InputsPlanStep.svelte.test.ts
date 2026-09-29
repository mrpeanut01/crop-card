import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import InputsPlanStep from './InputsPlanStep.svelte';
import type { InputsPlan, InputsPlanApplication } from '$lib/plan/inputsPlan';

function application(over: Partial<InputsPlanApplication> = {}): InputsPlanApplication {
  return {
    id: 'p1::pre-plant-fertility::0',
    plantingId: 'p1',
    blockId: 'b1',
    cropPluginId: 'tomato',
    slot: 'pre-plant-fertility',
    productPluginId: 'mystery',
    productDisplayName: 'Mystery product',
    productCategory: 'fertilizer',
    windowStartMs: Date.UTC(2027, 3, 1),
    windowEndMs: Date.UTC(2027, 3, 15),
    applicationDateMs: Date.UTC(2027, 3, 1),
    rateAmount: null,
    rateUnit: null,
    acres: 0.001,
    totalAmount: null,
    rationale: 'Pre-plant fertility budget.',
    productSource: 'plugin',
    options: [],
    ...over
  };
}

function mockPlan(applications: InputsPlanApplication[]) {
  const plan: InputsPlan = {
    applications,
    scoutTasks: [],
    shoppingList: [],
    stockOnHand: {},
    warnings: [],
    meta: {
      year: 2027,
      philosophy: 'conventional',
      weedStrategy: 'post-emergence-ok',
      pestStrategy: 'ipm',
      fertilityApproach: 'synthetic',
      generatedAtMs: 0
    }
  } as unknown as InputsPlan;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ plan, meta: { fallback: true } })))
  );
}

afterEach(() => vi.unstubAllGlobals());

const props = {
  plantings: [
    {
      id: 'p1',
      blockId: 'b1',
      cropPluginId: 'tomato',
      varietyDisplayName: 'Tomato',
      plantingDate: 0
    }
  ],
  year: 2027,
  onCommit: () => {},
  onBack: () => {}
};

describe('InputsPlanStep shopping list copy', () => {
  it('never says stock covers a product that has no amount', async () => {
    mockPlan([application()]);
    render(InputsPlanStep, props);
    expect(await screen.findByTestId('shopping-unsized')).toHaveTextContent(
      '1 chosen product has no rate here'
    );
    expect(screen.queryByText(/stock you have covers/)).toBeNull();
    expect(screen.getByTestId('rate-missing')).toBeInTheDocument();
  });
});
