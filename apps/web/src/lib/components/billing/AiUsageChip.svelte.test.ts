import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AiUsageChip from './AiUsageChip.svelte';

function mockUsage(
  usedToday: number,
  extra: Record<string, unknown> = {},
  monthlyExhausted = false
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            usage: {
              monthlyUsdSoFar: 0.5,
              cap: 0.5,
              exhausted: true,
              aiOff: false,
              planning: { perDay: 5, usedToday, monthlyExhausted },
              ...extra
            },
            isOwner: true,
            aiAvailable: true
          })
        )
    )
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('AiUsageChip planning mode (#479)', () => {
  it('shows planning runs left even when the monthly budget is used up', async () => {
    mockUsage(2);
    render(AiUsageChip, { planning: true });
    const el = await screen.findByTestId('ai-planning-left');
    expect(el).toHaveTextContent('AI planning today: 3 of 5 runs left.');
    expect(screen.queryByTestId('ai-usage-meter')).toBeNull();
  });

  it('says when the day is used up', async () => {
    mockUsage(5);
    render(AiUsageChip, { planning: true });
    expect(await screen.findByTestId('ai-planning-left')).toHaveTextContent(
      "Today's 5 AI planning runs are used up."
    );
  });

  it('says when the month of AI planning is used up', async () => {
    mockUsage(0, {}, true);
    render(AiUsageChip, { planning: true });
    const el = await screen.findByTestId('ai-planning-left');
    expect(el).toHaveTextContent("This month's AI planning is used up.");
    expect(el).toHaveAttribute('data-left', '0');
  });
});
