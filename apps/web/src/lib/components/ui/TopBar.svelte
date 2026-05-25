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
    Search,
    Bell,
    Settings
  } from 'lucide-svelte';
  import IconButton from './IconButton.svelte';
  import OfflineIndicator from './OfflineIndicator.svelte';

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
    email: string;
    role: string;
    isSuperadmin?: boolean;
  }

  interface Props {
    user?: User | null;
    activeOwner?: ActiveOwner | null;
    availableOwners?: AvailableOwner[];
    online: boolean;
    pendingCount: number | null;
    onSwitchOwner?: (ownerId: string) => void | Promise<void>;
  }

  const {
    user,
    activeOwner,
    availableOwners = [],
    online,
    pendingCount,
    onSwitchOwner
  }: Props = $props();

  // 7-item nav per design (collapsed from 13). Map / Calendar fold into Plan,
  // Insecticides into Spray, Fertility under Records, Equipment under
  // /settings/sprayers, Hay into archetype renderers.
  const items: Array<{ href: string; label: string; icon: LucideIcon }> = [
    { href: '/today', label: 'Today', icon: Sun },
    { href: '/plan', label: 'Plan', icon: Sprout },
    { href: '/spray', label: 'Spray', icon: SprayCan },
    { href: '/scout', label: 'Scout', icon: Eye },
    { href: '/harvest', label: 'Harvest', icon: Wheat },
    { href: '/stock', label: 'Stock', icon: Box },
    { href: '/records', label: 'Records', icon: FileText }
  ];

  function isActive(href: string): boolean {
    const path = page.url.pathname;
    if (href === '/today') return path === '/today' || path === '/';
    return path === href || path.startsWith(`${href}/`);
  }

  const initial = $derived(user?.email?.[0]?.toUpperCase() ?? '?');
</script>

<header class="topbar">
  <div class="brand-cluster">
    <span class="brand-mark" aria-hidden="true">
      <Leaf size={16} />
    </span>
    <a href="/" class="brand serif" aria-label="CropCard home">CropCard</a>
    {#if activeOwner}
      <span class="divider" aria-hidden="true"></span>
      <span class="farm mono">{activeOwner.name}</span>
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
    <IconButton ariaLabel="Search">
      {#snippet icon()}<Search size={16} strokeWidth={1.75} />{/snippet}
    </IconButton>
    <IconButton ariaLabel="Alerts">
      {#snippet icon()}<Bell size={16} strokeWidth={1.75} />{/snippet}
    </IconButton>
    <IconButton href="/settings" ariaLabel="Settings">
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
  }
  .primary-nav {
    display: flex;
    gap: 2px;
    margin-left: 12px;
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
  .owner-chip {
    position: relative;
  }
  .owner-chip > summary {
    list-style: none;
    cursor: pointer;
    padding: 0;
    border: none;
    background: transparent;
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
    .farm {
      display: none;
    }
  }
</style>
