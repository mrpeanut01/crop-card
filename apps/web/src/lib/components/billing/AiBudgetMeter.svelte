<script lang="ts">
  import { PLANS, formatUsd, type AiUsageSnapshot } from '$lib/billing/plans';

  interface Props {
    usage: AiUsageSnapshot;
    isOwner: boolean;
    compact?: boolean;
    showUpsell?: boolean;
  }

  const { usage, isOwner, compact = false, showUpsell = true }: Props = $props();

  const pct = $derived(Math.round(Math.min(1, usage.pctUsed) * 100));
  const level = $derived(
    usage.aiOff ? 'off' : usage.exhausted ? 'out' : usage.warnAt80 || usage.quickOnly ? 'low' : 'ok'
  );
  const upgradeName = $derived(usage.upgrade ? PLANS[usage.upgrade].name : null);
  const money = (n: number) => (n < 10 ? `$${n.toFixed(2)}` : formatUsd(n));
</script>

<div class="meter" class:compact data-state={level} data-testid="ai-usage-meter">
  <div class="head">
    <span class="label">AI help this month</span>
    <span class="amount mono">
      {#if usage.aiOff}
        Off
      {:else}
        {money(usage.monthlyUsdSoFar)} of {money(usage.cap)}
      {/if}
    </span>
  </div>
  {#if !usage.aiOff}
    <div
      class="bar"
      role="meter"
      aria-label="AI help used this month"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={pct}
    >
      <div class="fill" style:width="{pct}%"></div>
    </div>
  {/if}

  {#if level === 'off'}
    <p class="note">
      AI help is off for this farm. Everything works without it.
      {#if isOwner}<a href="/settings/ai">Turn it back on</a>{/if}
    </p>
  {:else if level === 'out'}
    <p class="note" data-testid="ai-limit-note">
      You've used this month's AI help. CropCard keeps working without it and it resets on the 1st.
    </p>
    {#if upgradeName && showUpsell}
      {#if isOwner}
        <a class="upsell" href="/settings/billing" data-testid="ai-upsell">
          More AI on {upgradeName}
        </a>
      {:else}
        <p class="note">Ask the farm owner about more AI on {upgradeName}.</p>
      {/if}
    {/if}
  {:else if usage.quickOnly}
    <p class="note" data-testid="ai-low-note">
      Enough left for quick help, not a full AI plan. Plans work without AI until the 1st.
    </p>
    {#if upgradeName && showUpsell && !compact}
      {#if isOwner}
        <a class="upsell" href="/settings/billing" data-testid="ai-upsell">
          More AI on {upgradeName}
        </a>
      {:else}
        <p class="note">Ask the farm owner about more AI on {upgradeName}.</p>
      {/if}
    {/if}
  {:else if !compact}
    <p class="note">
      {usage.planName} plan{#if usage.starterBoost}, with a first-month boost{/if}. When it runs
      out, CropCard works it out without AI.
    </p>
  {/if}
</div>

<style>
  .meter {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: var(--radius-card, 8px);
    background: var(--color-paper);
    font-size: 13px;
    color: var(--color-ink-soft);
    min-width: 0;
  }
  .meter.compact {
    padding: 8px 10px;
    font-size: 12.5px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .label {
    font-weight: 600;
    color: var(--color-ink);
  }
  .amount {
    color: var(--color-ink-soft);
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .bar {
    height: 6px;
    border-radius: 999px;
    background: var(--color-divider-soft, var(--color-divider));
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--color-forest);
  }
  [data-state='low'] .fill {
    background: var(--color-wheat);
  }
  [data-state='out'] .fill {
    background: var(--color-rust);
  }
  .note {
    margin: 0;
    line-height: 1.45;
  }
  .note a {
    color: var(--color-forest-deep);
    font-weight: 600;
  }
  .upsell {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: flex-start;
    min-height: 48px;
    padding: 0 16px;
    border-radius: var(--radius-input, 6px);
    background: var(--color-forest-deep);
    color: var(--color-cream, #f8f3e8);
    font-weight: 600;
    text-decoration: none;
  }
  .upsell:hover {
    filter: brightness(1.08);
  }
</style>
