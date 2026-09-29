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
      planning: {
        perDay: 5,
        usedToday: 0,
        monthlyUsd: 1.5,
        monthlyUsdSoFar: 0,
        monthlyExhausted: false
      },
      ownerLimited: false,
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

  it('says only a lower limit caps planning, so the full-plan value keeps both budgets (r6)', () => {
    const { getByTestId, getByText } = render(Page, { data: data('env') as never, form: null });
    const note = getByTestId('ai-cap-planning-note').textContent!.replace(/\s+/g, ' ');
    expect(note).toContain('up to $1.50 a month of its own');
    expect(note).toContain('Leave this at $0.50 to keep both.');
    expect(note).toContain('A lower limit caps everything together, planning included.');
    expect(note).not.toContain('If you save a limit here');
    expect(getByText('Lower your monthly AI limit (optional)')).toBeInTheDocument();
  });
});
