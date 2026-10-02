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
    Layers,
    Bell,
    Settings,
    PawPrint,
    Tractor,
    MessageSquare,
    Inbox,
    ChevronDown,
    Zap,
    Warehouse,
    User,
    LogOut
  } from 'lucide-svelte';
  import { identityLabel } from '$lib/identity';
  import IconButton from './IconButton.svelte';
  import Avatar from './Avatar.svelte';
  import OfflineIndicator from './OfflineIndicator.svelte';
  import LanguageToggle from './LanguageToggle.svelte';
  import FeedbackSheet from '$lib/components/feedback/FeedbackSheet.svelte';
  import type { NavAlert } from '$lib/today/navAlerts';
  import { createT } from '$lib/i18n';
  import { animalsTitle } from '$lib/animals/profile';

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
  interface SessionUser {
    email: string | null;
    phone?: string | null;
    name?: string;
    avatarUrl?: string | null;
    role: string;
    isSuperadmin?: boolean;
  }

  interface Props {
    user?: SessionUser | null;
    activeOwner?: ActiveOwner | null;
    availableOwners?: AvailableOwner[];
    online: boolean;
    pendingCount: number | null;
    alerts?: NavAlert[];
    /** "Animals" or "Pets & animals" once the farm keeps any (Phase 32B);
     *  null hides the entry for crop-only growers. */
    animalsLabel?: string | null;
    onSwitchOwner?: (ownerId: string) => void | Promise<void>;
  }

  const {
    user,
    activeOwner,
    availableOwners = [],
    online,
    pendingCount,
    alerts = [],
    animalsLabel = null,
    onSwitchOwner
  }: Props = $props();

  const tr = $derived(createT(page.data?.locale));

  let alertsOpen = $state(false);

  const allAlerts = $derived<NavAlert[]>(
    (pendingCount ?? 0) > 0
      ? [
          {
            id: 'pending',
            tone: 'wheat',
            label: tr('nav.pendingRecords', { count: pendingCount ?? 0 }),
            href: '/records/pending'
          },
          ...alerts
        ]
      : alerts
  );
  const alertsLabel = $derived(
    allAlerts.length === 0
      ? tr('nav.alertsNone')
      : tr('nav.alertsActive', { count: allAlerts.length })
  );

  type NavLink = { href: string; label: string; icon: LucideIcon };
  type NavEntry =
    | ({ kind: 'link' } & NavLink)
    | { kind: 'group'; id: string; label: string; icon: LucideIcon; items: NavLink[] };

  // Five entries at every width, so neither the top row nor the phone bottom
  // bar needs an overflow menu: field work, the farm's animals, stock and gear
  // (Equipment right after Inventory, #474), and records each open a short
  // menu. Map / Calendar live under Plan, Insecticides under Spray, Fertility
  // under Records.
  const entries: NavEntry[] = $derived([
    { kind: 'link', href: '/today', label: tr('nav.today'), icon: Sun },
    { kind: 'link', href: '/plan', label: tr('nav.plan'), icon: Sprout },
    {
      kind: 'group',
      id: 'actions',
      label: tr('nav.actions'),
      icon: Zap,
      items: [
        { href: '/spray', label: tr('nav.spray'), icon: SprayCan },
        { href: '/scout', label: tr('nav.scout'), icon: Eye },
        { href: '/harvest', label: tr('nav.harvest'), icon: Wheat }
      ]
    },
    {
      kind: 'group',
      id: 'farm',
      label: tr('nav.farm'),
      icon: Warehouse,
      items: [
        ...(animalsLabel
          ? [
              {
                href: '/animals',
                label:
                  animalsLabel === animalsTitle('pets')
                    ? tr('nav.petsAndAnimals')
                    : tr('nav.animals'),
                icon: PawPrint
              }
            ]
          : []),
        { href: '/inventory', label: tr('nav.inventory'), icon: Box },
        { href: '/equipment', label: tr('nav.equipment'), icon: Tractor }
      ]
    },
    {
      kind: 'group',
      id: 'records',
      label: tr('nav.records'),
      icon: FileText,
      items: [
        { href: '/records', label: tr('nav.records'), icon: FileText },
        { href: '/cards', label: tr('nav.cards'), icon: Layers }
      ]
    }
  ]);

  function isActive(href: string): boolean {
    const path = page.url.pathname;
    if (href === '/today') return path === '/today' || path === '/';
    // Legacy /stock and /settings/plugins 308 to /inventory; keep the
    // Inventory entry lit while the redirect is in flight.
    if (href === '/inventory') {
      return (
        path === '/inventory' ||
        path.startsWith('/inventory/') ||
        path === '/stock' ||
        path.startsWith('/stock/') ||
        path === '/settings/plugins' ||
        path.startsWith('/settings/plugins/')
      );
    }
    return path === href || path.startsWith(`${href}/`);
  }

  const MENU_WIDTH = 220;
  let openGroup = $state<string | null>(null);
  let menuPos = $state('');
  let accountOpen = $state(false);
  let feedbackOpen = $state(false);

  // The open menu is placed against the viewport: below its button in the
  // top row, above it in the phone bottom bar, and kept on screen.
  function toggleGroup(e: MouseEvent, id: string) {
    e.preventDefault();
    if (openGroup === id) {
      openGroup = null;
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const vw = window.innerWidth;
    const clampLeft = (x: number) => Math.round(Math.min(Math.max(8, x), vw - MENU_WIDTH - 8));
    menuPos =
      vw <= 768
        ? `left: ${clampLeft(r.left + r.width / 2 - MENU_WIDTH / 2)}px; bottom: ${Math.round(window.innerHeight - r.top + 6)}px;`
        : `left: ${clampLeft(r.left)}px; top: ${Math.round(r.bottom + 6)}px;`;
    openGroup = id;
    accountOpen = false;
    alertsOpen = false;
  }

  function closeMenusOnOutsideClick(e: MouseEvent) {
    const target = e.target as Element | null;
    if (!target?.closest) return;
    if (openGroup && !target.closest('.nav-group')) openGroup = null;
    if (accountOpen && !target.closest('.account-menu')) accountOpen = false;
    if (alertsOpen && !target.closest('.alerts-menu')) alertsOpen = false;
  }

  function closeMenusOnEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    openGroup = null;
    accountOpen = false;
    alertsOpen = false;
  }

  function openFeedback() {
    accountOpen = false;
    feedbackOpen = true;
  }

  const avatarName = $derived(user?.name ?? user?.email ?? (user?.phone ? '#' : '?'));
</script>

<svelte:window
  onclick={closeMenusOnOutsideClick}
  onkeydown={closeMenusOnEscape}
  onresize={() => (openGroup = null)}
  onscroll={() => (openGroup = null)}
/>

<header class="topbar">
  <div class="brand-cluster">
    <a href="/" class="brand-link" aria-label={tr('nav.home')}>
      <span class="brand-mark" aria-hidden="true">
        <Leaf size={16} />
      </span>
      <span class="brand serif">CropCard</span>
    </a>
    {#if activeOwner}
      <span class="divider" aria-hidden="true"></span>
      <span class="farm mono" title={activeOwner.name}>{activeOwner.name}</span>
    {/if}
  </div>

  <nav aria-label={tr('nav.primary')} class="primary-nav">
    {#each entries as entry (entry.kind === 'link' ? entry.href : entry.id)}
      {@const Icon = entry.icon}
      {#if entry.kind === 'link'}
        {@const active = isActive(entry.href)}
        <a
          href={entry.href}
          class="nav-link"
          class:active
          aria-current={active ? 'page' : undefined}
        >
          <Icon size={15} strokeWidth={1.75} />
          <span>{entry.label}</span>
        </a>
      {:else}
        <details class="nav-group" data-group={entry.id} open={openGroup === entry.id}>
          <summary
            class="nav-link"
            class:active={entry.items.some((i) => isActive(i.href))}
            onclick={(e) => toggleGroup(e, entry.id)}
          >
            <Icon size={15} strokeWidth={1.75} />
            <span>{entry.label}</span>
            <ChevronDown size={14} strokeWidth={1.75} class="caret" />
          </summary>
          <div class="group-menu" style={menuPos}>
            {#each entry.items as item (item.href)}
              {@const ItemIcon = item.icon}
              <a
                href={item.href}
                class="menu-link"
                aria-current={isActive(item.href) ? 'page' : undefined}
                onclick={() => (openGroup = null)}
              >
                <ItemIcon size={16} strokeWidth={1.75} />
                <span>{item.label}</span>
              </a>
            {/each}
          </div>
        </details>
      {/if}
    {/each}
  </nav>

  <div class="right">
    <LanguageToggle />
    <details class="alerts-menu" bind:open={alertsOpen}>
      <summary class="alerts-trigger" aria-label={alertsLabel} title={alertsLabel}>
        <Bell size={16} strokeWidth={1.75} />
        {#if allAlerts.length > 0}
          <span class="alerts-badge mono" aria-hidden="true">{allAlerts.length}</span>
        {/if}
      </summary>
      <div class="alerts-popover">
        <div class="popover-label">{tr('nav.alerts')}</div>
        {#if allAlerts.length === 0}
          <p class="alerts-empty">{tr('nav.alertsEmpty')}</p>
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
        <a href="/today" class="alerts-today" onclick={() => (alertsOpen = false)}
          >{tr('nav.alertsOpenToday')}</a
        >
      </div>
    </details>
    <IconButton
      href="/settings"
      ariaLabel={tr('nav.settings')}
      aria-current={page.url.pathname.startsWith('/settings') ? 'page' : undefined}
    >
      {#snippet icon()}<Settings size={16} strokeWidth={1.75} />{/snippet}
    </IconButton>
    {#if user}
      <details class="account-menu" bind:open={accountOpen}>
        <summary aria-label={tr('nav.account')} title={user.name}>
          <Avatar name={avatarName} src={user.avatarUrl} />
        </summary>
        <div class="owner-popover">
          <div class="account-id">
            {#if user.name}<span class="account-name">{user.name}</span>{/if}
            <span class="account-handle mono"
              >{identityLabel({ email: user.email, phone: user.phone ?? null })}</span
            >
          </div>
          {#if availableOwners.length > 1 && activeOwner}
            <div class="owner-popover-label">{tr('nav.switchFarm')}</div>
            <div role="menu" aria-label={tr('nav.switchFarm')}>
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
          {/if}
          <div class="account-actions">
            <a href="/settings/account" class="owner-choice" onclick={() => (accountOpen = false)}>
              <span class="with-icon"><User size={15} strokeWidth={1.75} />{tr('nav.account')}</span
              >
            </a>
            {#if user.isSuperadmin}
              <a href="/admin/feedback" class="owner-choice" onclick={() => (accountOpen = false)}>
                <span class="with-icon"
                  ><Inbox size={15} strokeWidth={1.75} />{tr('nav.feedbackInbox')}</span
                >
              </a>
            {/if}
            <button type="button" class="owner-choice" onclick={openFeedback}>
              <span class="with-icon"
                ><MessageSquare size={15} strokeWidth={1.75} />{tr('nav.sendFeedback')}</span
              >
            </button>
            <form method="POST" action="/signout">
              <button type="submit" class="owner-choice">
                <span class="with-icon"
                  ><LogOut size={15} strokeWidth={1.75} />{tr('nav.signOut')}</span
                >
              </button>
            </form>
          </div>
        </div>
      </details>
    {:else}
      <span class="standalone">
        <Avatar name={avatarName} />
      </span>
    {/if}
    <OfflineIndicator {online} {pendingCount} />
  </div>
</header>

<FeedbackSheet
  open={feedbackOpen}
  pathname={page.url.pathname}
  onClose={() => (feedbackOpen = false)}
/>

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
  .brand-link {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    text-decoration: none;
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
  .account-menu {
    position: relative;
  }
  .account-menu > summary {
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
  .account-menu > summary::-webkit-details-marker {
    display: none;
  }
  .standalone {
    display: inline-flex;
  }
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
  .owner-choice:focus-visible {
    outline: 2px solid var(--color-forest);
    outline-offset: -2px;
  }
  a.owner-choice,
  .account-actions .owner-choice {
    min-height: 48px;
    text-decoration: none;
    font: inherit;
  }
  .with-icon {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .account-id {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--color-divider);
    margin-bottom: 4px;
  }
  .account-name {
    color: var(--color-ink);
    font-weight: 600;
  }
  .account-handle {
    font-size: var(--font-size-meta);
    color: var(--color-ink-muted);
    overflow-wrap: anywhere;
  }
  .account-actions {
    border-top: 1px solid var(--color-divider);
    margin-top: 4px;
    padding-top: 4px;
  }
  .account-id + .account-actions {
    border-top: none;
    margin-top: 0;
  }
  .account-actions form {
    margin: 0;
  }
  .owner-role {
    font-size: var(--font-size-meta);
    color: var(--color-ink-muted);
    text-transform: uppercase;
  }

  /* The header row degrades in steps so it never widens the page: the sync
     label collapses to its dot first (text stays in the a11y tree), then the
     farm name. */
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

  /* Narrow laptops and tablets in landscape: the leaf stands in for the
     wordmark and the group arrows go, so the five entries still fit. */
  @media (max-width: 960px) {
    .brand {
      display: none;
    }
    .nav-group :global(.caret) {
      display: none;
    }
  }

  /* Mobile: collapse nav into a bottom strip below 768px so primary-nav row
     stays uncluttered. Bottom nav is one-glove non-negotiable per CLAUDE.md. */
  @media (max-width: 768px) {
    .brand {
      display: inline;
    }
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

  .nav-group {
    display: flex;
  }
  .nav-group > summary {
    list-style: none;
    cursor: pointer;
  }
  .nav-group > summary::-webkit-details-marker {
    display: none;
  }
  .nav-group :global(.caret) {
    transition: transform 0.15s ease;
  }
  .nav-group[open] :global(.caret) {
    transform: rotate(180deg);
  }
  .group-menu {
    position: fixed;
    min-width: 200px;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    box-shadow: 0 6px 18px rgba(26, 31, 26, 0.18);
    padding: 6px;
    display: flex;
    flex-direction: column;
    z-index: 50;
  }
  .menu-link {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    box-sizing: border-box;
    min-height: 48px;
    padding: 0 12px;
    border-radius: 6px;
    color: var(--color-ink);
    text-decoration: none;
    font: inherit;
    font-weight: 600;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
  }
  .menu-link:hover {
    background: var(--color-divider-soft);
  }
  .menu-link[aria-current='page'] {
    background: var(--pill-forest-bg);
    color: var(--pill-forest-fg);
  }
  @media (max-width: 768px) {
    .nav-group {
      flex: 1;
    }
    .nav-group > summary {
      width: 100%;
    }
    .nav-group :global(.caret) {
      display: none;
    }
    .group-menu {
      width: 220px;
      box-sizing: border-box;
    }
  }

  /* 375px phones: tighter chrome; Settings and the account menu keep their
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
