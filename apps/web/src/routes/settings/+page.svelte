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
    Heart,
    Wallet,
    FolderOpen
  } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import { createT, type MessageKey } from '$lib/i18n';

  /**
   * Phase 25c (#88) — /settings index.
   *
   * Canonical mockup at
   * `docs/design/almanac/direction-almanac-pages.jsx` ASettingsScreen.
   * Hero identity card + 2-column section grid + cream
   * advanced-diagnostics footer. The Claude key lives under Integrations.
   */

  let { data } = $props();

  const tr = $derived(createT(data.locale));
  const ROLE_KEYS: Record<string, MessageKey> = {
    owner: 'settings.role.owner',
    helper: 'settings.role.helper',
    inspector: 'settings.role.inspector'
  };

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
      label: tr('account.title'),
      sub: tr('settings.index.account.sub')
    },
    {
      href: '/settings/notifications',
      icon: Bell,
      label: tr('settings.index.notifications.label'),
      sub: tr('settings.index.notifications.sub')
    },
    {
      href: '/settings/season',
      icon: Sprout,
      label: tr('settings.index.season.label'),
      sub: tr('settings.index.season.sub'),
      badge: { tone: 'neutral', text: tr('settings.index.season.badge') },
      ownerOnly: true
    },
    {
      href: '/settings/farm',
      icon: LayoutGrid,
      label: tr('settings.index.farm.label'),
      sub: tr('settings.index.farm.sub', { count: data.counts.blocks }),
      ownerOnly: true
    },
    {
      href: '/settings/helpers',
      icon: Users,
      label: tr('settings.index.helpers.label'),
      sub: [
        tr('settings.index.owners', { count: data.counts.owners }),
        tr('settings.index.helpers', { count: data.counts.helpers }),
        tr('settings.index.invites', { count: data.counts.pendingInvites })
      ].join(' · '),
      badge:
        data.counts.pendingInvites > 0
          ? {
              tone: 'wheat',
              text: tr('settings.index.pendingBadge', { count: data.counts.pendingInvites })
            }
          : undefined,
      ownerOnly: true
    },
    {
      href: '/settings/equipment',
      icon: Tractor,
      label: tr('settings.index.equipment.label'),
      sub: [
        tr('settings.index.pieces', { count: data.counts.equipment }),
        tr('settings.index.sprayers', { count: data.counts.sprayers }),
        ...(data.counts.dirtySprayers > 0 ? [`${data.counts.dirtySprayers} needs decon`] : [])
      ].join(' · '),
      badge: data.counts.dirtySprayers > 0 ? { tone: 'rust', text: 'Decon needed' } : undefined,
      ownerOnly: true
    },
    {
      href: '/inventory?type=crop&mode=catalog',
      icon: Box,
      label: tr('settings.index.plugins.label'),
      sub: tr('settings.index.plugins.sub', {
        loaded: data.counts.plugins,
        failed: data.advanced.pluginFailures
      })
    },
    {
      href: '/settings/records',
      icon: FileText,
      label: tr('settings.index.records.label'),
      sub: tr('settings.index.records.sub'),
      ownerOnly: true
    },
    {
      href: '/settings/documents',
      icon: FolderOpen,
      label: tr('settings.index.documents.label'),
      sub: tr('settings.index.documents.sub'),
      ownerOnly: true
    },
    {
      href: '/finance',
      icon: Wallet,
      label: tr('settings.index.money.label'),
      sub: tr('settings.index.money.sub'),
      ownerOnly: true
    },
    {
      href: '/settings/integrations',
      icon: Plug,
      label: tr('settings.index.integrations.label'),
      sub: tr('settings.index.tokens', { count: data.counts.apiTokens }),
      badge: data.aiEnabled
        ? { tone: 'forest', text: tr('settings.index.aiOn') }
        : { tone: 'neutral', text: tr('settings.index.aiOff') },
      ownerOnly: true
    },
    {
      href: '/settings/billing',
      icon: CreditCard,
      label: tr('settings.index.billing.label'),
      sub: tr('settings.index.billing.sub', { plan: data.owner?.planName ?? 'Free' }),
      ownerOnly: true
    },
    {
      href: '/settings/about',
      icon: Heart,
      label: tr('settings.index.about.label'),
      sub: tr('settings.index.about.sub')
    },
    {
      href: '/settings/advanced',
      icon: AlertTriangle,
      label: data.isOwner
        ? tr('settings.index.advanced.ownerLabel')
        : tr('settings.index.advanced.appInfo'),
      sub: data.isOwner
        ? tr('settings.index.advanced.ownerSub')
        : tr('settings.index.advanced.helperSub'),
      danger: data.isOwner
    }
  ]);

  const visibleSections = $derived(sections.filter((s) => !s.ownerOnly || data.isOwner));
</script>

<svelte:head>
  <title>{tr('settings.index.title')}</title>
</svelte:head>

<header class="page-head">
  <div>
    <Kicker>{tr('settings.index.kicker')}</Kicker>
    <h1>{tr('settings.index.h1')}</h1>
  </div>
  <div class="header-actions">
    {#if data.isOwner}
      <form method="POST" action="/today?/showSetup">
        <button class="ghost-btn" type="submit">{tr('settings.index.reshowSetup')}</button>
      </form>
      <a class="ghost-btn" href="/settings/advanced">
        <FileDown size={14} />
        {tr('settings.index.exportAccount')}
      </a>
    {/if}
  </div>
</header>

<!-- ─── Identity hero card ─────────────────────────────────────── -->
<section class="card identity">
  <Avatar name={data.user.name} src={data.user.avatarUrl} size={52} />
  <div class="identity-body">
    <div class="name">{data.user.name}</div>
    <div class="email">{identityLabel(data.user)}</div>
    <div class="pills">
      <Pill tone="forest"
        >{ROLE_KEYS[data.user.role] ? tr(ROLE_KEYS[data.user.role]) : data.user.role}</Pill
      >
      <Pill tone="neutral">{tr('settings.index.memberSince', { date: data.user.since })}</Pill>
    </div>
  </div>
  <div class="identity-meta">
    <div class="meta-label">{tr('settings.index.lastSignIn')}</div>
    <div class="meta-value mono">{data.user.lastLogin}</div>
    <div class="meta-sub">
      {tr('settings.index.sessions', { count: data.user.sessions })}
    </div>
  </div>
</section>

<!-- ─── 2-column section grid ──────────────────────────────────── -->
<ul class="section-grid" aria-label={tr('settings.index.sectionsAria')}>
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
  <Kicker>{tr('settings.index.diag.kicker')}</Kicker>
  <dl class="diag-grid">
    <div>
      <dt>{tr('settings.index.diag.build')}</dt>
      <dd class="mono">{data.advanced.buildVersion}</dd>
    </div>
    <div>
      <dt>{tr('settings.index.diag.rules')}</dt>
      <dd class="mono">{data.advanced.rulesVersion}</dd>
    </div>
    <div>
      <dt>{tr('settings.index.diag.pluginFailures')}</dt>
      <dd class="mono">{data.advanced.pluginFailures}</dd>
    </div>
    <div>
      <dt>{tr('settings.index.diag.tenant')}</dt>
      <dd class="mono">{data.advanced.tenantId}</dd>
    </div>
    <div>
      <dt>{tr('settings.index.diag.backup')}</dt>
      <dd class="mono">{data.advanced.lastBackup}</dd>
    </div>
    <div>
      <dt>{tr('settings.index.diag.storage')}</dt>
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
