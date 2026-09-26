/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { AiUsageSnapshot } from '$lib/billing/plans';
import AiBudgetMeter from './AiBudgetMeter.svelte';
import PlanCards from './PlanCards.svelte';

function usage(over: Partial<AiUsageSnapshot> = {}): AiUsageSnapshot {
  return {
    monthlyUsdSoFar: 0.1,
    cap: 0.5,
    planBudget: 0.5,
    pctUsed: 0.2,
    warnAt80: false,
    exhausted: false,
    aiOff: false,
    plan: 'free',
    planName: 'Free',
    planSource: 'free',
    starterBoost: false,
    boostEndsAt: null,
    graceEndsAt: null,
    upgrade: 'grower',
    ...over
  };
}

describe('AiBudgetMeter', () => {
  it('shows spend against the budget and no upsell while there is budget left', () => {
    render(AiBudgetMeter, { usage: usage(), isOwner: true });
    expect(screen.getByText('$0.10 of $0.50')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '20');
    expect(screen.queryByTestId('ai-upsell')).toBeNull();
  });

  it('offers the owner the next plan once the month is used up', () => {
    render(AiBudgetMeter, {
      usage: usage({ monthlyUsdSoFar: 0.6, pctUsed: 1, exhausted: true, warnAt80: true }),
      isOwner: true
    });
    expect(screen.getByTestId('ai-limit-note')).toHaveTextContent(
      "You've used this month's AI help"
    );
    const link = screen.getByTestId('ai-upsell');
    expect(link).toHaveTextContent('More AI on Grower');
    expect(link).toHaveAttribute('href', '/settings/billing');
  });

  it('points a helper at the owner instead of the billing page', () => {
    render(AiBudgetMeter, { usage: usage({ exhausted: true, pctUsed: 1 }), isOwner: false });
    expect(screen.queryByTestId('ai-upsell')).toBeNull();
    expect(screen.getByText(/Ask the farm owner about more AI on Grower/)).toBeInTheDocument();
  });

  it('has no upsell on the top plan', () => {
    render(AiBudgetMeter, {
      usage: usage({ plan: 'farm', planName: 'Farm', exhausted: true, upgrade: null }),
      isOwner: true
    });
    expect(screen.queryByTestId('ai-upsell')).toBeNull();
  });

  it('says AI is off when the owner turned it off', () => {
    render(AiBudgetMeter, { usage: usage({ aiOff: true, exhausted: true }), isOwner: true });
    expect(screen.getByText(/AI help is off for this farm/)).toBeInTheDocument();
    expect(screen.queryByRole('meter')).toBeNull();
  });
});

describe('PlanCards', () => {
  it('defaults to yearly prices and renders each plan call to action', () => {
    render(PlanCards, {
      interval: 'year',
      current: 'free',
      cta: (plan) => ({ label: `Pick ${plan}` })
    });
    expect(screen.getByTestId('plan-card-grower')).toHaveTextContent('$8');
    expect(screen.getByTestId('plan-card-farm')).toHaveTextContent('billed $192 a year');
    expect(screen.getByTestId('plan-card-free')).toHaveTextContent('Your plan');
    expect(screen.getByTestId('plan-cta-grower')).toHaveTextContent('Pick grower');
  });

  it('shows monthly prices for the monthly period', () => {
    render(PlanCards, { interval: 'month', cta: () => null });
    expect(screen.getByTestId('plan-card-grower')).toHaveTextContent('$10');
    expect(screen.getByTestId('plan-card-farm')).toHaveTextContent('$20');
    expect(screen.queryByTestId('plan-cta-grower')).toBeNull();
  });
});
