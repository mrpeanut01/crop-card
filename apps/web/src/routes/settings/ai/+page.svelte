<script lang="ts">
  import { enhance } from '$app/forms';
  import { Sparkles, Key, AlertTriangle, CheckCircle2, Lock } from 'lucide-svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Banner from '$lib/components/ui/Banner.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';

  let { data, form } = $props();

  function pct(n: number): string {
    return `${Math.round(n * 100)}%`;
  }
  function usd(n: number): string {
    return `$${n.toFixed(2)}`;
  }
  function timeAgo(ms: number): string {
    const diff = Date.now() - ms;
    const hours = Math.floor(diff / 3_600_000);
    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // Group recent calls by fallback reason for the degradation summary.
  const degradationCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const c of data.recentCalls) {
      if (c.provenance === 'fallback' && c.fallbackReason) {
        counts[c.fallbackReason] = (counts[c.fallbackReason] ?? 0) + 1;
      }
    }
    return counts;
  });
</script>

<svelte:head>
  <title>AI assistant — Settings — CropCard</title>
</svelte:head>

<main class="page">
  <header class="page-head">
    <Kicker>Settings</Kicker>
    <h1 class="serif">AI assistant</h1>
    <p class="lede">
      Bring-your-own Claude key · capped spend · per-endpoint daily quotas. AI assists, never gates
      — every screen works fully without one.
    </p>
  </header>

  {#if form?.error}
    <Banner tone="rust" urgent>{form.error}</Banner>
  {/if}
  {#if form?.success}
    <Banner tone="forest">{form.message}</Banner>
  {/if}

  <section>
    <Card>
      <header class="card-head">
        <div class="card-icon" aria-hidden="true">
          <Key size={16} strokeWidth={1.75} />
        </div>
        <div class="card-title">
          <Kicker>Claude API key</Kicker>
          <h2 class="serif">
            {#if data.key.source === 'none'}
              Not configured
            {:else if data.key.source === 'env'}
              From server env
            {:else}
              From farm settings
            {/if}
          </h2>
        </div>
        {#if data.key.source !== 'none'}
          <Pill tone="forest"><CheckCircle2 size={11} strokeWidth={1.75} /> Active</Pill>
        {:else}
          <Pill tone="neutral">Opt-in</Pill>
        {/if}
      </header>

      {#if data.key.source === 'env'}
        <p class="row-body">
          The key comes from the <code>ANTHROPIC_API_KEY</code> server environment variable
          <span class="masked mono">{data.key.masked}</span>. To override per-farm, paste a new
          key below — it will be stored encrypted-at-rest in this farm's settings and take precedence
          over the env var.
        </p>
      {:else if data.key.source === 'setting'}
        <p class="row-body">
          Current farm key <span class="masked mono">{data.key.masked}</span>. The Owner role can
          clear it below.
        </p>
      {:else}
        <p class="row-body">
          Paste an Anthropic API key from <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noopener">console.anthropic.com</a
          > to enable AI proposals across the wizard, spray, and stock-add flows.
        </p>
      {/if}

      {#if data.isOwner}
        <form method="POST" action="?/saveKey" use:enhance class="key-form">
          <label class="key-input">
            <span class="lbl">{data.key.source === 'none' ? 'New key' : 'Replace key'}</span>
            <input
              type="password"
              name="apiKey"
              placeholder="sk-ant-…"
              required
              autocomplete="off"
              spellcheck="false"
            />
          </label>
          <div class="key-actions">
            <button type="submit" class="cta-primary">
              <Sparkles size={14} strokeWidth={1.75} /> Save key
            </button>
            {#if data.key.source === 'setting'}
              <button
                type="submit"
                formaction="?/clearKey"
                class="cta-ghost"
                onclick={(e) =>
                  !confirm('Clear the saved API key? AI proposals will pause until a new one is saved.') &&
                  e.preventDefault()}
              >
                Clear key
              </button>
            {/if}
          </div>
        </form>
      {:else}
        <p class="role-hint">
          <Lock size={12} strokeWidth={1.75} aria-hidden="true" /> Only the Owner role can edit the
          farm AI key.
        </p>
      {/if}

      <form method="POST" action="?/toggleOptIn" use:enhance class="opt-row">
        <input type="hidden" name="next" value={(!data.userAiEnabled).toString()} />
        <label class="opt-toggle">
          <input type="checkbox" checked={data.userAiEnabled} disabled />
          <span>
            AI proposals for this user
            <Provenance source={data.userAiEnabled ? 'ai' : 'manual'} compact />
          </span>
        </label>
        <button type="submit" class="cta-ghost compact" disabled={data.key.source === 'none'}>
          {data.userAiEnabled ? 'Pause for me' : 'Enable for me'}
        </button>
      </form>
    </Card>
  </section>

  <section>
    <Card>
      <header class="card-head">
        <div class="card-icon" aria-hidden="true">
          {#if data.spend.warnAt80}
            <AlertTriangle size={16} strokeWidth={1.75} />
          {:else}
            <CheckCircle2 size={16} strokeWidth={1.75} />
          {/if}
        </div>
        <div class="card-title">
          <Kicker>Monthly cap</Kicker>
          <h2 class="serif">{usd(data.spend.monthlyUsdSoFar)} of {usd(data.cap)}</h2>
        </div>
        <span class="mono">{pct(data.spend.pctUsed)}</span>
      </header>
      <div class="cap-bar-wrap">
        <div class="cap-bar" class:warn={data.spend.warnAt80} style:width={pct(data.spend.pctUsed)}></div>
      </div>
      {#if data.spend.pctUsed >= 1}
        <Banner tone="rust" urgent>
          Monthly cap reached. AI proposals are paused until next month — deterministic fallbacks
          still run on every screen.
        </Banner>
      {:else if data.spend.warnAt80}
        <Banner tone="wheat">
          80% of the monthly cap used. Watch the recent-calls list below to see where the spend is
          going.
        </Banner>
      {/if}
    </Card>
  </section>

  <section>
    <Card>
      <header class="card-head">
        <div class="card-icon" aria-hidden="true">
          <Sparkles size={16} strokeWidth={1.75} />
        </div>
        <div class="card-title">
          <Kicker>Per-endpoint daily quotas</Kicker>
          <h2 class="serif">{Object.keys(data.dailyQuotas).length} endpoints tracked</h2>
        </div>
      </header>
      <ul class="quota-list">
        {#each Object.entries(data.dailyQuotas) as [endpoint, quota] (endpoint)}
          <li>
            <span class="mono">{endpoint}</span>
            <span class="mono quota-val">{quota}/day</span>
          </li>
        {/each}
      </ul>
    </Card>
  </section>

  {#if Object.keys(degradationCounts).length > 0}
    <section>
      <Card>
        <header class="card-head">
          <div class="card-icon" aria-hidden="true">
            <AlertTriangle size={16} strokeWidth={1.75} />
          </div>
          <div class="card-title">
            <Kicker>Recent fallbacks (last 50 calls)</Kicker>
            <h2 class="serif">{Object.values(degradationCounts).reduce((a, b) => a + b, 0)} degraded</h2>
          </div>
        </header>
        <ul class="degradation-list">
          {#each Object.entries(degradationCounts) as [reason, count] (reason)}
            <li>
              <Provenance source="fallback" detail={reason} compact />
              <span class="mono">{count}× in last 50</span>
            </li>
          {/each}
        </ul>
        <p class="hint">
          Phase 26 will add a <code>/api/audit/re-ask-ai</code> bulk re-run for fallback rows once
          the key is configured.
        </p>
      </Card>
    </section>
  {/if}

  <section>
    <Card>
      <header class="card-head">
        <div class="card-title">
          <Kicker>Recent calls</Kicker>
          <h2 class="serif">{data.recentCalls.length} in audit log</h2>
        </div>
      </header>
      {#if data.recentCalls.length === 0}
        <p class="hint">No AI calls yet. Visit /plan or /spray with AI enabled to start populating the log.</p>
      {:else}
        <ul class="calls-list">
          {#each data.recentCalls.slice(0, 20) as c, i (i)}
            <li>
              <span class="mono call-endpoint">{c.endpoint}</span>
              {#if c.provenance}
                <Provenance source={c.provenance} detail={c.fallbackReason ?? undefined} compact />
              {/if}
              <span class="mono call-usd">{usd(c.usdEstimate)}</span>
              <span class="call-time">{timeAgo(c.createdAt.getTime())}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </Card>
  </section>

  <footer class="page-foot">
    <Lock size={11} strokeWidth={1.75} aria-hidden="true" />
    <span>
      Key stored per-farm in the tenant-scoped settings table. Never shared between owners, never
      logged. Cleared with the "Clear key" action above; survives backup/restore via Litestream.
    </span>
  </footer>
</main>

<style>
  .page {
    max-width: 56rem;
    margin: 2rem auto;
    padding: var(--page-padding);
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .page-head h1 {
    margin: 6px 0 0;
    color: var(--color-forest-deep);
  }
  .page-head .lede {
    color: var(--color-ink-soft);
    margin: 8px 0 0;
    line-height: 1.55;
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .card-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: var(--color-forest);
    color: var(--color-cream);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .card-title {
    flex: 1;
  }
  .card-title h2 {
    margin: 4px 0 0;
    font-size: var(--font-size-card-title);
    color: var(--color-forest-deep);
    font-weight: 500;
  }
  .row-body {
    margin: 0 0 12px;
    color: var(--color-ink-soft);
    font-size: var(--font-size-body);
    line-height: 1.55;
  }
  .row-body code {
    font-size: 0.9em;
    background: var(--color-cream);
    padding: 1px 5px;
    border-radius: 3px;
  }
  .masked {
    color: var(--color-ink);
    font-weight: 600;
  }
  .key-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0 0 12px;
  }
  .key-input {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .key-input .lbl {
    font-size: 12px;
    color: var(--color-ink-soft);
    font-weight: 600;
  }
  .key-input input {
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 13px;
    min-height: 44px;
  }
  .key-input input:focus-visible {
    outline: 2px solid var(--color-forest);
    outline-offset: 2px;
  }
  .key-actions {
    display: flex;
    gap: 8px;
  }
  .cta-primary,
  .cta-ghost {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 10px 16px;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-weight: 600;
    font-size: 13.5px;
    border: 1px solid transparent;
    cursor: pointer;
  }
  .cta-primary {
    background: var(--color-forest);
    color: var(--color-cream);
  }
  .cta-primary:hover {
    filter: brightness(1.1);
  }
  .cta-ghost {
    background: var(--color-paper);
    color: var(--color-forest-deep);
    border-color: var(--color-divider);
  }
  .cta-ghost:hover:not(:disabled) {
    background: var(--color-divider-soft);
  }
  .cta-ghost:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .cta-ghost.compact {
    min-height: 36px;
    padding: 6px 12px;
    font-size: 12.5px;
  }
  .role-hint {
    margin: 0 0 12px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    color: var(--color-ink-muted);
    font-style: italic;
  }
  .opt-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft);
    border-radius: var(--radius-input, 6px);
    margin-top: 8px;
  }
  .opt-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--color-ink);
  }
  .opt-toggle input[type='checkbox'] {
    width: 16px;
    height: 16px;
    accent-color: var(--color-forest);
  }
  .cap-bar-wrap {
    margin: 4px 0 12px;
    height: 10px;
    background: var(--color-divider-soft);
    border-radius: 99px;
    overflow: hidden;
  }
  .cap-bar {
    height: 100%;
    background: var(--color-forest);
    transition: width 0.25s ease;
  }
  .cap-bar.warn {
    background: var(--color-wheat);
  }
  .quota-list,
  .calls-list,
  .degradation-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .quota-list li,
  .degradation-list li,
  .calls-list li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft);
    border-radius: 5px;
    font-size: 13px;
  }
  .quota-val {
    margin-left: auto;
    color: var(--color-ink-muted);
  }
  .call-endpoint {
    flex: 1;
    min-width: 0;
    color: var(--color-ink);
  }
  .call-usd {
    color: var(--color-ink-soft);
    font-weight: 600;
  }
  .call-time {
    font-size: 11.5px;
    color: var(--color-ink-muted);
    font-style: italic;
  }
  .hint {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--color-ink-muted);
    font-style: italic;
  }
  .hint code {
    font-style: normal;
    background: var(--color-cream);
    padding: 1px 4px;
    border-radius: 3px;
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.9em;
  }
  .page-foot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 0 0;
    border-top: 1px solid var(--color-divider);
    font-size: 12px;
    color: var(--color-ink-muted);
    line-height: 1.5;
  }
</style>
