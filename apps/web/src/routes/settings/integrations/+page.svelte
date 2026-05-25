<script lang="ts">
  import { Plug, Bot, CloudOff, Mail } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Integrations · CropCard</title>
</svelte:head>

<a class="back-link" href="/settings">← All settings</a>
<header class="page-head">
  <Kicker>External systems · API surface</Kicker>
  <h1>Integrations</h1>
  <p class="lede">
    Connect CropCard to external Claude agents, webhooks, and data providers. Most integrations
    today route through the Phase 24 Bearer-token surface.
  </p>
</header>

<section class="card">
  <header class="card-head">
    <div class="title-wrap">
      <Bot size={18} strokeWidth={1.75} />
      <h2>External agents (API tokens)</h2>
      <Pill tone="forest">live</Pill>
    </div>
  </header>
  <p class="lede-sm">
    Bearer tokens let external Claude agents (or any HTTP client) drive /api/** non-
    interactively. {data.tokenCount} token{data.tokenCount === 1 ? '' : 's'} active for your
    Owner.
  </p>
  <a class="action-link" href="/settings/api-tokens">Manage API tokens →</a>
</section>

<section class="card">
  <header class="card-head">
    <div class="title-wrap">
      <CloudOff size={18} strokeWidth={1.75} />
      <h2>Weather provider (NEWA)</h2>
      <Pill tone="wheat">Phase 26</Pill>
    </div>
  </header>
  <p class="lede-sm">
    Per-state NOAA / NEWA integration for disease forecast + spray-window risk. Currently using
    NOAA NWS for cutting-window forecasts (FR-22). Full NEWA per-state integration deferred to
    Phase 26.
  </p>
</section>

<section class="card">
  <header class="card-head">
    <div class="title-wrap">
      <Mail size={18} strokeWidth={1.75} />
      <h2>Email provider</h2>
      <Pill tone="wheat">stub</Pill>
    </div>
  </header>
  <p class="lede-sm">
    Helper invite emails currently log to stdout. Provider wire-up (Postmark / Resend / SES) is
    a single-config-swap before launch — tracked as a "known follow-up" in CLAUDE.md.
  </p>
</section>

<section class="card subtle">
  <header class="card-head">
    <div class="title-wrap">
      <Plug size={18} strokeWidth={1.75} />
      <h2>Coming in Phase 26</h2>
    </div>
  </header>
  <ul class="phase-26-list">
    <li>FHB / disease forecast (research-grade)</li>
    <li>Stripe / Lemon Squeezy billing webhooks</li>
    <li>AI photo extract for stock-add method 5</li>
  </ul>
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
    padding: 16px 18px;
    margin-bottom: 12px;
  }
  .card.subtle {
    background: var(--color-cream);
    border-style: dashed;
  }
  .card-head {
    margin-bottom: 8px;
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
  .action-link {
    display: inline-block;
    margin-top: 10px;
    color: var(--color-forest-deep);
    text-decoration: none;
    font-weight: 600;
    font-size: 13.5px;
  }
  .action-link:hover {
    text-decoration: underline;
  }
  .phase-26-list {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
    color: var(--color-ink-soft);
    line-height: 1.6;
  }
</style>
