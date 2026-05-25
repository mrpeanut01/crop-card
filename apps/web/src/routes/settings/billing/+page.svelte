<script lang="ts">
  import { CreditCard, TrendingUp } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';

  let { data } = $props();

  function statusTone(s: string): 'forest' | 'wheat' | 'rust' | 'neutral' {
    if (s === 'active') return 'forest';
    if (s === 'trial' || s === 'past_due') return 'wheat';
    if (s === 'canceled' || s === 'suspended') return 'rust';
    return 'neutral';
  }
</script>

<svelte:head>
  <title>Plan & billing · CropCard</title>
</svelte:head>

<a class="back-link" href="/settings">← All settings</a>
<header class="page-head">
  <Kicker>Subscription · usage</Kicker>
  <h1>Plan & billing</h1>
  <p class="lede">
    CropCard is single-tenant + self-hostable. The only ongoing cost is your Anthropic AI usage
    against the daily quota you set in /settings/ai.
  </p>
</header>

<section class="card">
  <header class="card-head">
    <div class="title-wrap">
      <CreditCard size={18} strokeWidth={1.75} />
      <h2>Subscription</h2>
      <Pill tone={statusTone(data.billingStatus)}>{data.billingStatus}</Pill>
    </div>
  </header>
  <p class="lede-sm">
    Stripe / Lemon Squeezy webhook wire-up lands in Phase 26. Today the billing-status field is
    set manually via superadmin tools.
  </p>
</section>

<section class="card">
  <header class="card-head">
    <div class="title-wrap">
      <TrendingUp size={18} strokeWidth={1.75} />
      <h2>This month's AI usage</h2>
    </div>
  </header>
  <div class="usage">
    <div class="usage-row">
      <span class="usage-label">Spent</span>
      <span class="usage-value mono">${data.ai.monthlyUsdSoFar.toFixed(2)}</span>
    </div>
    <div class="usage-row">
      <span class="usage-label">Cap</span>
      <span class="usage-value mono">${data.ai.cap.toFixed(2)}</span>
    </div>
    <div class="usage-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(data.ai.pctUsed * 100)}>
      <div
        class="usage-fill"
        class:warn={data.ai.warnAt80}
        class:cap={data.ai.pctUsed >= 1}
        style:width="{Math.min(100, Math.round(data.ai.pctUsed * 100))}%"
      ></div>
    </div>
    <p class="usage-sub">
      {Math.round(data.ai.pctUsed * 100)}% of monthly cap used.
      {#if data.ai.warnAt80 && data.ai.pctUsed < 1}
        Within 20% of cap — AI features will start degrading to deterministic fallback once the
        cap is hit.
      {:else if data.ai.pctUsed >= 1}
        Cap reached. AI calls now degrade to deterministic fallback through the aiTry() helper.
      {/if}
    </p>
  </div>
  <a class="action-link" href="/settings/ai">Adjust monthly cap →</a>
</section>

<style>
  .back-link {
    display: inline-block;
    margin-bottom: 12px;
    font-size: 13px;
    color: var(--color-forest-deep);
    text-decoration: none;
  }
  .back-link:hover {
    text-decoration: underline;
  }
  .page-head h1 {
    margin: 4px 0 8px;
    font-family: var(--font-serif, serif);
    font-size: 26px;
    color: var(--color-forest-deep);
  }
  .lede {
    margin: 0 0 18px;
    font-size: 13.5px;
    color: var(--color-ink-soft);
    line-height: 1.5;
    max-width: 60ch;
  }
  .card {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    padding: 18px;
    margin-bottom: 16px;
  }
  .card-head {
    margin-bottom: 12px;
  }
  .title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .title-wrap h2 {
    margin: 0;
    font-size: 15px;
    color: var(--color-ink);
  }
  .title-wrap :global(svg) {
    color: var(--color-forest-deep);
  }
  .lede-sm {
    margin: 0;
    font-size: 13px;
    color: var(--color-ink-soft);
    line-height: 1.45;
  }
  .usage {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .usage-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 13px;
  }
  .usage-label {
    color: var(--color-ink-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 700;
    font-size: 11px;
  }
  .usage-value {
    font-size: 16px;
    color: var(--color-ink);
    font-weight: 700;
  }
  .mono {
    font-family: var(--font-mono, monospace);
  }
  .usage-bar {
    height: 8px;
    background: var(--color-cream);
    border-radius: 999px;
    overflow: hidden;
    margin: 4px 0;
  }
  .usage-fill {
    height: 100%;
    background: var(--color-forest-deep);
    transition: width 0.3s ease;
  }
  .usage-fill.warn {
    background: var(--color-wheat, #d4a75c);
  }
  .usage-fill.cap {
    background: var(--color-rust, #ba4b38);
  }
  .usage-sub {
    margin: 4px 0 0;
    font-size: 12.5px;
    color: var(--color-ink-soft);
    line-height: 1.4;
  }
  .action-link {
    display: inline-block;
    margin-top: 12px;
    color: var(--color-forest-deep);
    text-decoration: none;
    font-weight: 600;
    font-size: 13.5px;
  }
  .action-link:hover {
    text-decoration: underline;
  }
</style>
