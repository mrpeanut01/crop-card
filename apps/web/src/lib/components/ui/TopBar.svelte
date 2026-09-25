<script lang="ts">
  import { page } from '$app/state';
  import {
    Leaf,
    Sun,
    Sprout,
    SprayCan,
    Eye,
    Wheat,
    Box,
    FileText,
    Bell,
    Settings
  } from 'lucide-svelte';
  import IconButton from './IconButton.svelte';
  import OfflineIndicator from './OfflineIndicator.svelte';
  import type { NavAlert } from '$lib/today/navAlerts';

  // lucide-svelte ships class components that don't match Svelte 5's Component
  // signature; type them loosely so {@const Icon = item.icon} works.
  type LucideIcon = typeof Sun;

  interface ActiveOwner {
    id: string;
    name: string;
  }
  interface AvailableOwner {
    id: string;
    name: string;
    role: string;
  }
  interface User {
    email: string | null;
    phone?: string | null;
    role: string;
    isSuperadmin?: boolean;
  }

  interface Props {
    user?: User | null;
    activeOwner?: ActiveOwner | null;
    availableOwners?: AvailableOwner[];
    online: boolean;
    pendingCount: number | null;
    alerts?: NavAlert[];
    onSwitchOwner?: (ownerId: string) => void | Promise<void>;
  }

  const {
    user,
    activeOwner,
    availableOwners = [],
    online,
    pendingCount,
    alerts = [],
    onSwitchOwner
  }: Props = $props();

  let alertsOpen = $state(false);

  const allAlerts = $derived<NavAlert[]>(
    (pendingCount ?? 0) > 0
      ? [
          {
            id: 'pending',
            tone: 'wheat',
            label: `${pendingCount} offline record${pendingCount === 1 ? '' : 's'} waiting to sync`,
            href: '/records/pending'
          },
          ...alerts
        ]
      : alerts
  );
  const alertsLabel = $derived(
    allAlerts.length === 0 ? 'Alerts, none active' : `Alerts, ${allAlerts.length} active`
  );

  // 7-item nav per design (collapsed from 13). Map / Calendar fold into Plan,
  // Insecticides into Spray, Fertility under Records, Equipment under
  // /inventory?type=sprayer, Hay into archetype renderers.
  // Sprint 9 / Phase 27E: legacy /stock, /settings/plugins, /settings/sprayers
  // now 308-redirect to /inventory; the transitional active-state branch
  // below is kept short-term so a 308 still lights up the Inventory chip.
  const items: Array<{ href: string; label: string; icon: LucideIcon }> = [
    { href: '/today', label: 'Today', icon: Sun },
    { href: '/plan', label: 'Plan', icon: Sprout },
    { href: '/spray', label: 'Spray', icon: SprayCan },
    { href: '/scout', label: 'Scout', icon: Eye },
    { href: '/harvest', label: 'Harvest', icon: Wheat },
    { href: '/inventory', label: 'Inventory', icon: Box },
    { href: '/records', label: 'Records', icon: FileText }
  ];

  function isActive(href: string): boolean {
    const path = page.url.pathname;
    if (href === '/today') return path === '/today' || path === '/';
    // Sprint 7 transitional active-state: /inventory entry also lights
    // up for the legacy /stock + /settings/plugins + /settings/sprayers
    // shells until Sprint 9 redirects them.
    if (href === '/inventory') {
      return (
        path === '/inventory' ||
        path.startsWith('/inventory/') ||
        path === '/stock' ||
        path.startsWith('/stock/') ||
        path === '/settings/plugins' ||
        path.startsWith('/settings/plugins/') ||
        path === '/settings/sprayers' ||
        path.startsWith('/settings/sprayers/')
      );
    }
    return path === href || path.startsWith(`${href}/`);
  }

  const initial = $derived(user?.email?.[0]?.toUpperCase() ?? (user?.phone ? '#' : '?'));
</script>

<header class="topbar">
  <div class="brand-cluster">
    <span class="brand-mark" aria-hidden="true">
      <Leaf size={16} />
    </span>
    <a href="/" class="brand serif" aria-label="CropCard home">CropCard</a>
    {#if activeOwner}
      <span class="divider" aria-hidden="true"></span>
      <span class="farm mono" title={activeOwner.name}>{activeOwner.name}</span>
    {/if}
  </div>

  <nav aria-label="Primary" class="primary-nav">
    {#each items as item (item.href)}
      {@const Icon = item.icon}
      {@const active = isActive(item.href)}
      <a href={item.href} class="nav-link" class:active aria-current={active ? 'page' : undefined}>
        <Icon size={15} strokeWidth={1.75} />
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>

  <div class="right">
    <details class="alerts-menu" bind:open={alertsOpen}>
      <summary class="alerts-trigger" aria-label={alertsLabel} title={alertsLabel}>
        <Bell size={16} strokeWidth={1.75} />
        {#if allAlerts.length > 0}
          <span class="alerts-badge mono" aria-hidden="true">{allAlerts.length}</span>
        {/if}
      </summary>
      <div class="alerts-popover">
        <div class="popover-label">Alerts</div>
        {#if allAlerts.length === 0}
          <p class="alerts-empty">No active alerts.</p>
        {:else}
          <ul class="alerts-list">
            {#each allAlerts as a (a.id)}
              <li>
                <a href={a.href} class="alert-link {a.tone}" onclick={() => (alertsOpen = false)}
                  >{a.label}</a
                >
              </li>
            {/each}
          </ul>
        {/if}
        <a href="/today" class="alerts-today" onclick={() => (alertsOpen = false)}>Open Today →</a>
      </div>
    </details>
    <IconButton
      href="/settings"
      ariaLabel="Settings"
      aria-current={page.url.pathname.startsWith('/settings') ? 'page' : undefined}
    >
      {#snippet icon()}<Settings size={16} strokeWidth={1.75} />{/snippet}
    </IconButton>
    {#if availableOwners.length > 1 && activeOwner}
      <details class="owner-chip">
        <summary aria-label="Switch farm" title={activeOwner.name}>
          <span class="avatar">{initial}</span>
        </summary>
        <div class="owner-popover" role="menu">
          <div class="owner-popover-label">Switch farm</div>
          {#each availableOwners as o (o.id)}
            <button
              type="button"
              class="owner-choice"
              class:active={o.id === activeOwner.id}
              role="menuitemradio"
              aria-checked={o.id === activeOwner.id}
              onclick={() => onSwitchOwner?.(o.id)}
            >
              <span>{o.name}</span>
              <span class="owner-role mono">{o.role}</span>
            </button>
          {/each}
        </div>
      </details>
    {:else}
      <span class="avatar standalone" aria-hidden="true">{initial}</span>
    {/if}
    <OfflineIndicator {online} {pendingCount} />
  </div>
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 22px;
    padding: 14px 28px;
    background: var(--color-paper);
    border-bottom: 1px solid var(--color-divider);
  }
  .brand-cluster {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .brand-mark {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-input);
    background: var(--color-forest);
    color: var(--color-cream);
    display: grid;
    place-items: center;
  }
  .brand {
    font-size: 20px;
    color: var(--color-forest-deep);
    letter-spacing: -0.015em;
  }
  .divider {
    width: 1px;
    height: 18px;
    background: var(--color-divider);
    margin: 0 6px;
  }
  .farm {
    font-size: var(--font-size-caption);
    color: var(--color-ink-muted);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .primary-nav {
    display: flex;
    gap: 2px;
    margin-left: 12px;
    min-width: 0;
    overflow-x: auto;
  }
  .nav-link {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 12px;
    border-radius: var(--radius-input);
    color: var(--color-ink-soft);
    font-weight: 500;
    font-size: 13.5px;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    white-space: nowrap;
  }
  .nav-link.active {
    color: var(--color-forest-deep);
    font-weight: 600;
    border-bottom-color: var(--color-forest);
  }
  .right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .alerts-menu {
    position: relative;
  }
  .alerts-trigger {
    list-style: none;
    cursor: pointer;
    position: relative;
    min-width: 48px;
    min-height: 48px;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink-soft);
  }
  .alerts-trigger::-webkit-details-marker {
    display: none;
  }
  .alerts-trigger:hover {
    background: var(--color-divider-soft);
    color: var(--color-ink);
  }
  .alerts-badge {
    position: absolute;
    top: 4px;
    right: 4px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    box-sizing: border-box;
    border-radius: var(--radius-pill);
    background: var(--color-rust);
    color: var(--color-cream);
    font-size: 10px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
  }
  .alerts-popover {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    width: 300px;
    max-width: calc(100vw - 24px);
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
    padding: 6px;
    z-index: 50;
  }
  .popover-label {
    font-size: var(--font-size-kicker);
    color: var(--color-ink-muted);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 600;
    padding: 8px 10px 4px;
  }
  .alerts-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .alert-link,
  .alerts-today {
    display: flex;
    align-items: center;
    min-height: 48px;
    padding: 6px 10px;
    border-radius: var(--radius-input);
    color: var(--color-ink);
    font-size: 13.5px;
    line-height: 1.3;
  }
  .alert-link {
    border-left: 3px solid var(--color-wheat);
  }
  .alert-link.rust {
    border-left-color: var(--color-rust);
    font-weight: 600;
  }
  .alert-link:hover,
  .alerts-today:hover {
    background: var(--color-divider-soft);
  }
  .alerts-empty {
    margin: 0;
    padding: 8px 10px;
    color: var(--color-ink-muted);
    font-size: 13.5px;
  }
  .alerts-today {
    color: var(--color-forest);
    font-weight: 600;
    border-top: 1px solid var(--color-divider);
    border-radius: 0;
    margin-top: 4px;
  }
  .owner-chip {
    position: relative;
  }
  .owner-chip > summary {
    list-style: none;
    cursor: pointer;
    padding: 0;
    border: none;
    background: transparent;
    min-width: 48px;
    min-height: 48px;
    display: grid;
    place-items: center;
  }
  .owner-chip > summary::-webkit-details-marker {
    display: none;
  }
  .avatar {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-pill);
    background: var(--color-wheat);
    color: var(--color-cream);
    display: grid;
    place-items: center;
    font-weight: 600;
    font-size: 13px;
    flex-shrink: 0;
  }
  /* .standalone is just a marker class; no additional styles needed. */
  .owner-popover {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    min-width: 240px;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
    padding: 6px;
    z-index: 50;
  }
  .owner-popover-label {
    font-size: var(--font-size-kicker);
    color: var(--color-ink-muted);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 600;
    padding: 8px 10px 4px;
  }
  .owner-choice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 8px 10px;
    background: transparent;
    border: none;
    border-radius: var(--radius-input);
    color: var(--color-ink);
    cursor: pointer;
    text-align: left;
  }
  .owner-choice:hover {
    background: var(--color-divider-soft);
  }
  .owner-choice.active {
    color: var(--color-forest-deep);
    font-weight: 600;
  }
  .owner-role {
    font-size: var(--font-size-meta);
    color: var(--color-ink-muted);
    text-transform: uppercase;
  }

  /* The header row degrades in steps so it never widens the page: the sync
     label collapses to its dot first (text stays in the a11y tree), then the
     farm name. Between 769px and ~1030px the primary nav scrolls within
     itself as a fallback. */
  @media (max-width: 1280px) {
    .right :global(.indicator .label) {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  }
  @media (max-width: 1180px) {
    .farm,
    .divider {
      display: none;
    }
    .nav-link {
      padding: 8px 9px;
    }
  }

  /* Mobile: collapse nav into a bottom strip below 768px so primary-nav row
     stays uncluttered. Bottom nav is one-glove non-negotiable per CLAUDE.md. */
  @media (max-width: 768px) {
    .primary-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: var(--color-paper);
      border-top: 1px solid var(--color-divider);
      padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
      gap: 0;
      margin-left: 0;
      justify-content: space-between;
      z-index: 40;
    }
    .nav-link {
      flex: 1;
      flex-direction: column;
      gap: 2px;
      padding: 6px 4px;
      border-radius: 6px;
      border-bottom: none;
      font-size: 10.5px;
      text-align: center;
      min-height: 48px;
    }
    .nav-link.active {
      background: var(--pill-forest-bg);
      color: var(--pill-forest-fg);
    }
  }

  /* 375px phones: tighter chrome; Settings + the owner switcher keep their
     48px targets. */
  @media (max-width: 600px) {
    .topbar {
      gap: 8px;
      padding: 8px 12px;
    }
    .brand-cluster {
      min-width: 0;
    }
    .right {
      gap: 4px;
      flex-shrink: 0;
    }
    .alerts-popover {
      position: fixed;
      left: 12px;
      right: 12px;
      top: 64px;
      width: auto;
      max-width: none;
    }
  }
</style>
