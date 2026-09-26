import { describe, expect, it } from 'vitest';
import { usageSurchargeUsd, WEB_SEARCH_USD_PER_REQUEST } from './aiCost';
import { estimateUsd, selectModel } from './aiPlanning';
import { scanCallUsage } from './scanResult';

const SONNET = selectModel('allocate');
const HAIKU = selectModel('suggest');

describe('usageSurchargeUsd', () => {
  it('is zero without usage, cache writes or searches', () => {
    expect(usageSurchargeUsd(undefined, 3)).toBe(0);
    expect(usageSurchargeUsd({}, 3)).toBe(0);
  });

  it('bills each web search at $0.01', () => {
    expect(WEB_SEARCH_USD_PER_REQUEST).toBe(0.01);
    expect(usageSurchargeUsd({ server_tool_use: { web_search_requests: 4 } }, 3)).toBeCloseTo(
      0.04,
      10
    );
  });

  it('adds the 0.25x cache-write premium on top of the base input rate', () => {
    expect(usageSurchargeUsd({ cache_creation_input_tokens: 1_000_000 }, 3)).toBeCloseTo(0.75, 10);
  });
});

describe('estimateUsd', () => {
  const meta = { model: 'x', inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 };

  it('keeps the token-only estimate when no usage block is passed', () => {
    expect(estimateUsd(meta, SONNET)).toBeCloseTo(3, 10);
  });

  it('bills cache writes at 1.25x the input rate', () => {
    expect(estimateUsd(meta, SONNET, { cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(
      3.75,
      10
    );
    expect(estimateUsd(meta, HAIKU, { cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(
      1.25,
      10
    );
  });

  it('adds web search requests', () => {
    const noTokens = { model: 'x', inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    expect(
      estimateUsd(noTokens, SONNET, { server_tool_use: { web_search_requests: 5 } })
    ).toBeCloseTo(0.05, 10);
  });
});

describe('scanCallUsage (the scan price table)', () => {
  it('counts cache writes as input, bills the premium and adds web searches', () => {
    const u = scanCallUsage('claude-sonnet-4-6', {
      input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      output_tokens: 0,
      server_tool_use: { web_search_requests: 2 }
    });
    expect(u.inputTokens).toBe(2_000_000);
    expect(u.usdEstimate).toBeCloseTo(3 + 3.75 + 0.02, 10);
  });

  it('prices Haiku scans on the Haiku rate', () => {
    const u = scanCallUsage('claude-haiku-4-5-20251001', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000
    });
    expect(u.usdEstimate).toBeCloseTo(6, 10);
  });
});
