<script lang="ts">
  import {
    User,
    Sprout,
    Wrench,
    Users,
    SprayCan,
    Box,
    FileText,
    Leaf,
    Plug,
    CreditCard,
    AlertTriangle,
    ChevronRight,
    Check,
    Lock,
    LayoutGrid,
    FileDown
  } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';

  /**
   * Phase 25c (#88) — /settings index.
   *
   * Canonical mockup at
   * `docs/design/almanac/direction-almanac-pages.jsx` ASettingsScreen.
   * Hero identity card + featured AI assistant card + 2-column section
   * grid + cream advanced-diagnostics footer.
   */

  let { data } = $props();

  type LucideIcon = typeof User;
  interface Section {
    href: string;
    icon: LucideIcon;
    label: string;
    sub: string;
    badge?: { tone: 'forest' | 'wheat' | 'rust' | 'neutral'; text: string };
    danger?: boolean;
    ownerOnly?: boolean;
  }

  const sections: Section[] = $derived([
    {
      href: '/settings/account',
      icon: User,
      label: 'Account & sign-in',
      sub: 'Email · password · 2FA · active sessions'
    },
    {
      href: '/settings/season',
      icon: Sprout,
      label: 'Season setup',
      sub: 'Philosophy · tillage · fertility · irrigation · re-walk the 6-step wizard',
      badge: { tone: 'neutral', text: 'Synced from wizard' },
      ownerOnly: true
    },
    {
      href: '/settings/farm',
      icon: LayoutGrid,
      label: 'Farm & blocks',
      sub: `${data.counts.blocks} block${data.counts.blocks === 1 ? '' : 's'} · acreage · soil zones · field map`,
      ownerOnly: true
    },
    {
      href: '/settings/helpers',
      icon: Users,
      label: 'Helpers & invites',
      sub: `${data.counts.helpers} active helper${data.counts.helpers === 1 ? '' : 's'} · ${data.counts.pendingInvites} pending invite${data.counts.pendingInvites === 1 ? '' : 's'}`,
      badge:
        data.counts.pendingInvites > 0
          ? { tone: 'wheat', text: `${data.counts.pendingInvites} pending` }
          : undefined,
      ownerOnly: true
    },
    {
      href: '/inventory?type=sprayer',
      icon: SprayCan,
      label: 'Sprayers & calibration',
      sub: `${data.counts.equipment} registered${data.counts.dirtySprayers > 0 ? ` · ${data.counts.dirtySprayers} needs decon` : ''}`,
      badge: data.counts.dirtySprayers > 0 ? { tone: 'rust', text: 'Decon needed' } : undefined,
      ownerOnly: true
    },
    {
      href: '/inventory?type=crop&mode=catalog',
      icon: Box,
      label: 'Plugins & crop library',
      sub: `${data.counts.plugins} loaded · ${data.advanced.pluginFailures} failed`
    },
    {
      href: '/settings/records',
      icon: FileText,
      label: 'Records & retention',
      sub: 'VDACS audit tier · 2-year hold · bulk exports',
      ownerOnly: true
    },
    {
      href: '/settings/integrations',
      icon: Plug,
      label: 'Integrations',
      sub: `${data.counts.apiTokens} API token${data.counts.apiTokens === 1 ? '' : 's'} · weather · USDA (planned)`,
      ownerOnly: true
    },
    {
      href: '/settings/billing',
      icon: CreditCard,
      label: 'Plan & billing',
      sub: `Solo plan · single-replica · ${data.owner?.billingStatus ?? 'unknown'}`,
      ownerOnly: true
    },
    {
      href: '/settings/advanced',
      icon: AlertTriangle,
      label: 'Advanced & export-all',
      sub: 'Bulk export · transfer ownership · delete account',
      danger: true,
      ownerOnly: true
    }
  ]);

  const visibleSections = $derived(sections.filter((s) => !s.ownerOnly || data.isOwner));
</script>

<svelte:head>
  <title>Settings · CropCard</title>
</svelte:head>

<header class="page-head">
  <div>
    <Kicker>Settings</Kicker>
    <h1>Configure CropCard.</h1>
  </div>
  <div class="header-actions">
    <a class="ghost-btn" href="/onboarding"> Re-walk setup tour → </a>
    <a class="ghost-btn" href="/settings/advanced">
      <FileDown size={14} />
      Export account data
    </a>
  </div>
</header>

<!-- ─── Identity hero card ─────────────────────────────────────── -->
<section class="card identity">
  <div class="avatar" aria-hidden="true">
    {data.user.name.charAt(0).toUpperCase()}
  </div>
  <div class="identity-body">
    <div class="name">{data.user.name}</div>
    <div class="email">{data.user.email}</div>
    <div class="pills">
      <Pill tone="forest">{data.user.role}</Pill>
      <Pill tone="neutral">Member since {data.user.since}</Pill>
    </div>
  </div>
  <div class="identity-meta">
    <div class="meta-label">Last sign-in</div>
    <div class="meta-value mono">{data.user.lastLogin}</div>
    <div class="meta-sub">
      {data.user.sessions} active session{data.user.sessions === 1 ? '' : 's'}
    </div>
  </div>
</section>

<!-- ─── AI assistant featured card ─────────────────────────────── -->
{#if data.ai && data.isOwner}
  <section class="card ai-feature">
    <header class="ai-head">
      <div class="ai-icon" class:on={data.ai.enabled}>
        <Leaf size={20} strokeWidth={1.75} />
      </div>
      <div class="ai-title">
        <div class="ai-title-row">
          <h2>AI planning assistant</h2>
          {#if data.ai.enabled}
            <Pill tone="forest"><Check size={10} /> Active</Pill>
          {:else}
            <Pill tone="rust">Off · no key</Pill>
          {/if}
        </div>
        <div class="ai-meta">
          Claude {data.ai.model} · monthly cap ${data.ai.monthlyCapUSD.toFixed(0)} · ${data.ai.spendThisMonth.toFixed(
            2
          )}
          spent this month · {data.ai.callsThisMonth} call{data.ai.callsThisMonth === 1 ? '' : 's'}
        </div>
      </div>
    </header>

    <div class="ai-body">
      <div class="ai-key-col">
        <div class="key-label">Claude API key</div>
        <form method="POST" action="/settings/ai?/saveKey" class="key-row">
          <input
            type="password"
            name="apiKey"
            placeholder="sk-ant-…"
            value={data.ai.keyMasked ?? ''}
            class="key-input mono"
          />
          <button type="submit" class="primary-btn">
            {data.ai.enabled ? 'Update' : 'Save & enable'}
          </button>
        </form>
        <div class="key-hint">
          <Lock size={11} strokeWidth={1.75} />
          Stored locally · never sent to the CropCard server. Get a key at
          <a href="https://console.anthropic.com" target="_blank" rel="noreferrer noopener">
            console.anthropic.com
          </a>.
        </div>

        <div class="cap-section">
          <div class="cap-head">
            <span class="cap-label">Monthly cap</span>
            <span class="cap-value mono">${data.ai.monthlyCapUSD.toFixed(2)}</span>
          </div>
          <div
            class="cap-bar"
            role="meter"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round(data.ai.pctUsed * 100)}
          >
            <div
              class="cap-fill"
              class:warn={data.ai.warnAt80}
              class:over={data.ai.pctUsed >= 1}
              style:width="{Math.min(100, Math.round(data.ai.pctUsed * 100))}%"
            ></div>
          </div>
          <div class="cap-ticks mono">
            <span>$0</span>
            <span>${data.ai.spendThisMonth.toFixed(2)} spent</span>
            <span>${data.ai.monthlyCapUSD.toFixed(0)} cap</span>
          </div>
        </div>
      </div>

      <div class="ai-gated-col">
        <div class="kicker-row">
          Gated by AI ({data.ai.enabled ? 'available' : 'currently hidden'})
        </div>
        <ul class="gated-list" class:dim={!data.ai.enabled}>
          {#each data.ai.gatedFeatures as f, i (i)}
            <li>{f}</li>
          {/each}
        </ul>

        <div class="kicker-row alt">
          Always works ({data.ai.keepWorking.length})
        </div>
        <ul class="works-list">
          {#each data.ai.keepWorking as k, i (i)}
            <li>
              <Check size={11} strokeWidth={2} />
              {k}
            </li>
          {/each}
        </ul>
      </div>
    </div>
  </section>
{/if}

<!-- ─── 2-column section grid ──────────────────────────────────── -->
<ul class="section-grid" aria-label="Settings sections">
  {#each visibleSections as s (s.href)}
    {@const Icon = s.icon}
    <li>
      <a class="section-card" class:danger={s.danger} href={s.href}>
        <div class="sect-icon" class:danger={s.danger} aria-hidden="true">
          <Icon size={17} strokeWidth={1.75} />
        </div>
        <div class="sect-body">
          <div class="sect-title-row">
            <span class="sect-label">{s.label}</span>
            {#if s.badge}
              <Pill tone={s.badge.tone}>{s.badge.text}</Pill>
            {/if}
          </div>
          <div class="sect-sub">{s.sub}</div>
        </div>
        <ChevronRight size={14} strokeWidth={1.75} class="chevron" />
      </a>
    </li>
  {/each}
</ul>

<!-- ─── Advanced diagnostics footer ────────────────────────────── -->
<section class="card advanced-footer">
  <Kicker>Advanced · diagnostics</Kicker>
  <dl class="diag-grid">
    <div>
      <dt>Build version</dt>
      <dd class="mono">{data.advanced.buildVersion}</dd>
    </div>
    <div>
      <dt>Rules version</dt>
      <dd class="mono">{data.advanced.rulesVersion}</dd>
    </div>
    <div>
      <dt>Plugin failures</dt>
      <dd class="mono">{data.advanced.pluginFailures}</dd>
    </div>
    <div>
      <dt>Tenant ID</dt>
      <dd class="mono">{data.advanced.tenantId}</dd>
    </div>
    <div>
      <dt>Last backup</dt>
      <dd class="mono">{data.advanced.lastBackup}</dd>
    </div>
    <div>
      <dt>Storage tier</dt>
      <dd class="mono">SQLite · Litestream → Azure Blob</dd>
    </div>
  </dl>
</section>

<style>
  .page-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 22px;
  }
  .header-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .page-head h1 {
    margin: 6px 0 0;
    font-family: var(--font-serif, serif);
    font-size: 34px;
    color: var(--color-forest-deep);
    letter-spacing: -0.02em;
    line-height: 1.05;
  }
  .ghost-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    color: var(--color-ink);
    font-size: 13px;
    font-weight: 600;
    min-height: 36px;
  }
  .ghost-btn:hover {
    border-color: var(--color-forest-deep);
  }

  .card {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    margin-bottom: 14px;
  }

  /* ── Identity hero ── */
  .identity {
    padding: 18px 22px;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 16px;
    align-items: center;
  }
  .avatar {
    width: 52px;
    height: 52px;
    border-radius: 999px;
    background: var(--color-wheat, #d4a75c);
    color: var(--color-cream, #f8f3e8);
    display: grid;
    place-items: center;
    font-size: 22px;
    font-weight: 700;
    font-family: var(--font-serif, serif);
  }
  .identity-body .name {
    font-family: var(--font-serif, serif);
    font-size: 19px;
    color: var(--color-ink);
    letter-spacing: -0.01em;
  }
  .identity-body .email {
    font-size: 13px;
    color: var(--color-ink-muted);
    margin-top: 2px;
  }
  .identity-body .pills {
    margin-top: 6px;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .identity-meta {
    text-align: right;
    min-width: 140px;
  }
  .meta-label {
    font-size: 11.5px;
    color: var(--color-ink-muted);
    font-weight: 600;
  }
  .meta-value {
    font-size: 12.5px;
    color: var(--color-ink);
    margin-top: 2px;
  }
  .meta-sub {
    font-size: 11px;
    color: var(--color-ink-muted);
    margin-top: 4px;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  /* ── AI feature ── */
  .ai-feature {
    padding: 0;
  }
  .ai-head {
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--color-divider-soft, var(--color-divider));
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .ai-icon {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    background: var(--color-divider-soft, var(--color-divider));
    color: var(--color-ink-muted);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .ai-icon.on {
    background: var(--color-forest-deep);
    color: var(--color-cream, #f8f3e8);
  }
  .ai-title {
    flex: 1;
  }
  .ai-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ai-title-row h2 {
    margin: 0;
    font-family: var(--font-serif, serif);
    font-size: 17px;
    color: var(--color-forest-deep);
    letter-spacing: -0.01em;
  }
  .ai-meta {
    font-size: 12.5px;
    color: var(--color-ink-muted);
    margin-top: 3px;
  }
  .ai-body {
    padding: 16px 20px;
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 24px;
  }

  .key-label {
    font-size: 11px;
    color: var(--color-ink-muted);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 5px;
  }
  .key-row {
    display: flex;
    gap: 8px;
  }
  .key-input {
    flex: 1;
    padding: 10px 12px;
    font-size: 13px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    color: var(--color-ink);
    outline: none;
  }
  .key-input:focus {
    border-color: var(--color-forest-deep);
    outline: 2px solid var(--color-forest-deep);
    outline-offset: 1px;
  }
  .primary-btn {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: 0;
    padding: 8px 14px;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    min-height: 38px;
  }
  .key-hint {
    margin-top: 6px;
    font-size: 11px;
    color: var(--color-ink-muted);
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .key-hint a {
    color: var(--color-forest-deep);
    font-weight: 600;
    text-decoration: none;
  }
  .key-hint a:hover {
    text-decoration: underline;
  }

  .cap-section {
    margin-top: 16px;
  }
  .cap-head {
    display: flex;
    justify-content: space-between;
    margin-bottom: 5px;
  }
  .cap-label {
    font-size: 11px;
    color: var(--color-ink-muted);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .cap-value {
    font-size: 12px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .cap-bar {
    height: 8px;
    background: var(--color-cream);
    border-radius: 999px;
    overflow: hidden;
    border: 1px solid var(--color-divider);
  }
  .cap-fill {
    height: 100%;
    background: var(--color-forest-deep);
    transition: width 0.3s ease;
  }
  .cap-fill.warn {
    background: var(--color-wheat, #d4a75c);
  }
  .cap-fill.over {
    background: var(--color-rust, #ba4b38);
  }
  .cap-ticks {
    margin-top: 4px;
    display: flex;
    justify-content: space-between;
    font-size: 10.5px;
    color: var(--color-ink-muted);
  }

  .ai-gated-col {
    padding-left: 18px;
    border-left: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  .kicker-row {
    font-size: 11px;
    color: var(--color-ink-muted);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .kicker-row.alt {
    margin-top: 12px;
  }
  .gated-list,
  .works-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .gated-list li {
    font-size: 12px;
    color: var(--color-ink);
    line-height: 1.5;
    padding-left: 14px;
    position: relative;
  }
  .gated-list li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 7px;
    width: 5px;
    height: 5px;
    border-radius: 999px;
    background: var(--color-forest-deep);
  }
  .gated-list.dim li {
    color: var(--color-ink-muted);
  }
  .gated-list.dim li::before {
    background: var(--color-divider);
  }
  .works-list li {
    font-size: 12px;
    color: var(--color-ink);
    line-height: 1.5;
    padding-left: 18px;
    position: relative;
    margin-top: 4px;
  }
  .works-list li :global(svg) {
    position: absolute;
    left: 0;
    top: 4px;
    color: var(--color-forest-deep);
  }

  /* ── Section grid ── */
  .section-grid {
    list-style: none;
    margin: 0 0 18px;
    padding: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .section-card {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 12px;
    align-items: center;
    padding: 16px 18px;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    text-decoration: none;
    color: inherit;
    font-family: inherit;
  }
  .section-card:hover {
    border-color: var(--color-forest-deep);
  }
  .section-card.danger {
    border-color: rgba(186, 75, 56, 0.4);
  }
  .section-card.danger:hover {
    border-color: var(--color-rust, #ba4b38);
  }
  .sect-icon {
    width: 38px;
    height: 38px;
    border-radius: 8px;
    background: rgba(44, 82, 55, 0.08);
    color: var(--color-forest-deep);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .sect-icon.danger {
    background: rgba(186, 75, 56, 0.1);
    color: var(--color-rust, #ba4b38);
  }
  .sect-body {
    min-width: 0;
  }
  .sect-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .sect-label {
    font-family: var(--font-serif, serif);
    font-size: 15px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .sect-sub {
    font-size: 12px;
    color: var(--color-ink-muted);
    margin-top: 3px;
    line-height: 1.4;
  }
  .section-card :global(.chevron) {
    color: var(--color-ink-muted);
  }

  /* ── Advanced footer ── */
  .advanced-footer {
    background: var(--color-cream);
    padding: 16px 20px;
  }
  .diag-grid {
    margin: 10px 0 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    font-size: 12px;
  }
  .diag-grid > div {
    min-width: 0;
  }
  .diag-grid dt {
    font-size: 10.5px;
    color: var(--color-ink-muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 700;
  }
  .diag-grid dd {
    margin: 3px 0 0;
    font-size: 12px;
    color: var(--color-ink);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (max-width: 760px) {
    .identity {
      grid-template-columns: auto 1fr;
    }
    .identity-meta {
      grid-column: 1 / -1;
      text-align: left;
    }
    .ai-body {
      grid-template-columns: 1fr;
    }
    .ai-gated-col {
      padding-left: 0;
      border-left: 0;
      border-top: 1px solid var(--color-divider-soft, var(--color-divider));
      padding-top: 14px;
    }
    .section-grid {
      grid-template-columns: 1fr;
    }
    .diag-grid {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
