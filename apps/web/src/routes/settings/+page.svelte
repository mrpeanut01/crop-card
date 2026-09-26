<script lang="ts">
  import { identityLabel } from '$lib/identity';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import {
    User,
    Sprout,
    Users,
    Tractor,
    Box,
    FileText,
    Plug,
    CreditCard,
    AlertTriangle,
    ChevronRight,
    LayoutGrid,
    FileDown,
    Bell,
    Heart
  } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';

  /**
   * Phase 25c (#88) — /settings index.
   *
   * Canonical mockup at
   * `docs/design/almanac/direction-almanac-pages.jsx` ASettingsScreen.
   * Hero identity card + 2-column section grid + cream
   * advanced-diagnostics footer. The Claude key lives under Integrations.
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
      href: '/settings/notifications',
      icon: Bell,
      label: 'Notifications',
      sub: 'Push alerts · decon due · record lock closing · spring calibration'
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
      sub: [
        `${data.counts.owners} owner${data.counts.owners === 1 ? '' : 's'}`,
        `${data.counts.helpers} helper${data.counts.helpers === 1 ? '' : 's'}`,
        `${data.counts.pendingInvites} pending invite${data.counts.pendingInvites === 1 ? '' : 's'}`
      ].join(' · '),
      badge:
        data.counts.pendingInvites > 0
          ? { tone: 'wheat', text: `${data.counts.pendingInvites} pending` }
          : undefined,
      ownerOnly: true
    },
    {
      href: '/settings/equipment',
      icon: Tractor,
      label: 'Equipment',
      sub: [
        `${data.counts.equipment} piece${data.counts.equipment === 1 ? '' : 's'}`,
        `${data.counts.sprayers} sprayer${data.counts.sprayers === 1 ? '' : 's'} & calibration`,
        ...(data.counts.dirtySprayers > 0 ? [`${data.counts.dirtySprayers} needs decon`] : [])
      ].join(' · '),
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
      sub: `Claude API key · ${data.counts.apiTokens} API token${data.counts.apiTokens === 1 ? '' : 's'} · weather · USDA`,
      badge: data.aiEnabled
        ? { tone: 'forest', text: 'AI on' }
        : { tone: 'neutral', text: 'AI off' },
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
      href: '/settings/about',
      icon: Heart,
      label: 'About CropCard',
      sub: 'Why this exists · open source (MIT) · help build it'
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
    {#if data.isOwner}
      <form method="POST" action="/today?/showSetup">
        <button class="ghost-btn" type="submit">Re-show setup checklist</button>
      </form>
    {/if}
    <a class="ghost-btn" href="/settings/advanced">
      <FileDown size={14} />
      Export account data
    </a>
  </div>
</header>

<!-- ─── Identity hero card ─────────────────────────────────────── -->
<section class="card identity">
  <Avatar name={data.user.name} src={data.user.avatarUrl} size={52} />
  <div class="identity-body">
    <div class="name">{data.user.name}</div>
    <div class="email">{identityLabel(data.user)}</div>
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
    font-family: inherit;
    font-weight: 600;
    min-height: 48px;
    cursor: pointer;
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
    .section-grid {
      grid-template-columns: 1fr;
    }
    .diag-grid {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
