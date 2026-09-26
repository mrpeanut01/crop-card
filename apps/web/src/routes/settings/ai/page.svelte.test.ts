/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import Page from './+page.svelte';

function data(source: 'env' | 'setting' | 'none', isOwner = true) {
  return {
    key: { source, masked: source === 'setting' ? 'sk-ant…abcd' : '' },
    spend: {
      monthlyUsdSoFar: 0.1,
      cap: 0.5,
      planBudget: 0.5,
      pctUsed: 0.2,
      warnAt80: false,
      exhausted: false,
      quickOnly: false,
      aiOff: false,
      plan: 'free',
      planName: 'Free',
      planSource: 'free',
      starterBoost: false,
      boostEndsAt: null,
      graceEndsAt: null,
      upgrade: 'grower'
    },
    cap: 0.5,
    ownerCapSetting: null,
    dailyQuotas: {},
    userAiEnabled: true,
    recentCalls: [],
    usedToday: {},
    callsThisMonth: 0,
    isOwner
  };
}

describe('/settings/ai', () => {
  it('on a hosted key shows no key field and no page-wide Save button', () => {
    const { container, getByTestId, queryByRole } = render(Page, {
      data: data('env') as never,
      form: null
    });
    expect(getByTestId('ai-included')).toHaveTextContent('AI help is included with your plan.');
    expect(container.querySelector('input[name="apiKey"]')).toBeNull();
    expect(queryByRole('button', { name: /Save changes/ })).toBeNull();
    expect(container.textContent).not.toContain('Stored locally');
  });

  it('on a self-hosted farm the owner gets a key form with its own Save button', () => {
    const { container, getByRole } = render(Page, { data: data('none') as never, form: null });
    expect(container.querySelector('input[name="apiKey"]')).not.toBeNull();
    expect(getByRole('button', { name: 'Save key' })).toBeInTheDocument();
  });

  it('a helper never sees the key form', () => {
    const { container } = render(Page, { data: data('setting', false) as never, form: null });
    expect(container.querySelector('input[name="apiKey"]')).toBeNull();
  });
});
