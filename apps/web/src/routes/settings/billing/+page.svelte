<script lang="ts">
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';

  let { data } = $props();

  // Usage counters · this month. Spray + harvest counts pulled from
  // the snapshot via the loader's spendSnapshot proxy; AI counts come
  // from the same source. Caps are illustrative (no enforcement yet).
  const counters = $derived([
    { k: 'Spray events', v: 0, cap: 200, tone: 'forest' as const },
    { k: 'Harvest events', v: 0, cap: 200, tone: 'forest' as const },
    {
      k: 'AI calls (this month)',
      v: 0,
      cap: 60,
      tone: 'sky' as const
    },
    {
      k: 'AI $ spent',
      v: Math.round(data.ai.monthlyUsdSoFar * 100) / 100,
      cap: data.ai.cap,
      tone: 'sky' as const,
      currency: true
    }
  ]);

  // Upgrade paths from the design.
  const UPGRADES = [
    {
      name: 'Co-op',
      price: '$36/mo',
      who: '2-5 farms sharing curators · separate tenant DBs · still single-writer per farm'
    },
    {
      name: 'Hosted',
      price: '$120/mo',
      who: 'We host + back up · multi-writer scale, Postgres + Litestream replacement · contact us'
    }
  ];
</script>

<svelte:head><title>Plan & billing · CropCard</title></svelte:head>

<SettingsShell title="Plan & billing" kicker="Subscription">
  <SettingsSection title="Current plan" sub="Single-tenant. SQLite + Litestream to Azure Blob.">
    <div class="plan-grid">
      <div class="plan-card">
        <div class="plan-head">
          <span class="serif plan-name">Solo</span>
          <Pill tone="forest">Current</Pill>
        </div>
        <div class="plan-price mono">$12/mo · 1 owner · unlimited helpers</div>
        <ul class="plan-features">
          <li>Full safety kernel + plugin engine</li>
          <li>Offline-first PWA</li>
          <li>VDACS audit pack export</li>
          <li>BYO Claude key (no AI fees from us)</li>
        </ul>
      </div>
      <div class="plan-meta">
        <div class="kicker-row">Storage</div>
        <div class="meta-val mono">~$1.10/mo · Azure Blob</div>
        <div class="kicker-row mt">Bandwidth</div>
        <div class="meta-val mono">~$0.80/mo · scale-to-zero</div>
        <div class="kicker-row mt">Status</div>
        <div class="meta-val mono">{data.billingStatus}</div>
      </div>
    </div>
  </SettingsSection>

  <SettingsSection
    title="Usage counters · this month"
    sub="Tracked per-owner under owner_usage_counters table (Phase 18g)."
  >
    <div class="counter-grid">
      {#each counters as c (c.k)}
        {@const pct = Math.min(1, c.cap > 0 ? c.v / c.cap : 0)}
        <div class="counter-card">
          <div class="kicker-row">{c.k}</div>
          <div class="counter-row">
            <span class="counter-v serif" data-tone={c.tone}>
              {#if 'currency' in c && c.currency}${c.v.toFixed(2)}{:else}{c.v}{/if}
            </span>
            <span class="counter-cap mono">
              / {#if 'currency' in c && c.currency}${c.cap.toFixed(0)}{:else}{c.cap}{/if}
            </span>
          </div>
          <div class="counter-bar">
            <div
              class="counter-fill"
              data-tone={c.tone}
              style:width="{Math.round(pct * 100)}%"
            ></div>
          </div>
        </div>
      {/each}
    </div>
  </SettingsSection>

  <SettingsSection title="Payment method">
    <div class="payment-row">
      <div class="card-chip mono">VISA</div>
      <div class="payment-text">
        <div class="payment-num mono">•••• ••••</div>
        <div class="payment-sub">Stripe webhook wire-up · Phase 26</div>
      </div>
      <button type="button" class="ghost-sm" disabled>Update</button>
    </div>
  </SettingsSection>

  <SettingsSection
    title="Upgrade paths"
    sub="If you outgrow Solo. We don't push them — single-replica is the right shape for one farm."
  >
    <div class="upgrade-grid">
      {#each UPGRADES as p (p.name)}
        <div class="upgrade-card">
          <div class="upgrade-head">
            <span class="serif upgrade-name">{p.name}</span>
            <span class="upgrade-price mono">{p.price}</span>
          </div>
          <p class="upgrade-blurb">{p.who}</p>
        </div>
      {/each}
    </div>
  </SettingsSection>
</SettingsShell>

<style>
  .plan-grid {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 18px;
  }
  .plan-card {
    padding: 16px 18px;
    background: rgba(141, 174, 138, 0.18);
    border: 1.5px solid var(--color-forest-deep);
    border-radius: 10px;
  }
  .plan-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .plan-name {
    font-family: var(--font-serif, serif);
    font-size: 20px;
    color: var(--color-forest-deep);
    letter-spacing: -0.015em;
  }
  .plan-price {
    margin-top: 6px;
    font-size: 13px;
    color: var(--color-forest-deep);
    font-weight: 600;
  }
  .plan-features {
    margin: 10px 0 0;
    padding-left: 18px;
    color: var(--color-ink-soft);
    font-size: 12.5px;
    line-height: 1.7;
  }

  .plan-meta {
    display: flex;
    flex-direction: column;
  }
  .meta-val {
    font-size: 13px;
    color: var(--color-ink);
    margin-top: 4px;
  }
  .kicker-row {
    font-size: 11px;
    font-weight: 700;
    color: var(--color-ink-muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .mt {
    margin-top: 12px;
  }

  .counter-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  .counter-card {
    padding: 10px 12px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: 8px;
  }
  .counter-row {
    margin-top: 4px;
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .counter-v {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
    font-family: var(--font-serif, serif);
  }
  .counter-v[data-tone='forest'] {
    color: var(--color-forest-deep);
  }
  .counter-v[data-tone='sky'] {
    color: #6f8fa8;
  }
  .counter-cap {
    font-size: 11.5px;
    color: var(--color-ink-muted);
  }
  .counter-bar {
    margin-top: 6px;
    height: 5px;
    background: var(--color-divider-soft, var(--color-divider));
    border-radius: 999px;
    overflow: hidden;
  }
  .counter-fill {
    height: 100%;
  }
  .counter-fill[data-tone='forest'] {
    background: var(--color-forest-deep);
  }
  .counter-fill[data-tone='sky'] {
    background: #6f8fa8;
  }

  .payment-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 14px;
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: 8px;
  }
  .card-chip {
    width: 40px;
    height: 28px;
    border-radius: 4px;
    background: var(--color-forest-deep);
    color: var(--color-cream, #f8f3e8);
    display: grid;
    place-items: center;
    font-size: 10px;
    font-weight: 700;
  }
  .payment-text {
    flex: 1;
  }
  .payment-num {
    font-size: 12.5px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .payment-sub {
    font-size: 11.5px;
    color: var(--color-ink-muted);
    margin-top: 2px;
  }
  .ghost-sm {
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
    padding: 5px 10px;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .ghost-sm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ghost-sm:hover:not(:disabled) {
    border-color: var(--color-forest-deep);
  }

  .upgrade-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .upgrade-card {
    padding: 12px 14px;
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: 8px;
  }
  .upgrade-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .upgrade-name {
    font-family: var(--font-serif, serif);
    font-size: 16px;
    color: var(--color-forest-deep);
  }
  .upgrade-price {
    font-size: 12.5px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .upgrade-blurb {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--color-ink-soft);
    line-height: 1.5;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  @media (max-width: 760px) {
    .plan-grid,
    .upgrade-grid {
      grid-template-columns: 1fr;
    }
    .counter-grid {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
