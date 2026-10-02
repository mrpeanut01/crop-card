<script lang="ts">
  import { page } from '$app/state';
  import { tick } from 'svelte';
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
    Ellipsis,
    PawPrint,
    Tractor,
    MessageSquare,
    Inbox,
    ChevronDown,
    Zap
  } from 'lucide-svelte';
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
  interface User {
    email: string | null;
    phone?: string | null;
    name?: string;
    avatarUrl?: string | null;
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

  // 7-item nav per design (collapsed from 13) plus Equipment (#474:
  // sprayers and other gear are equipment, not inventory) and Cards
  // (Phase 30F, the offline deck). Map / Calendar fold into Plan,
  // Insecticides into Spray, Fertility under Records, Hay into archetype
  // renderers.
  // Sprint 9 / Phase 27E: legacy /stock, /settings/plugins, /settings/sprayers
  // now 308-redirect to /inventory; the transitional active-state branch
  // below is kept short-term so a 308 still lights up the Inventory chip.
  const items: Array<{ href: string; label: string; icon: LucideIcon }> = $derived([
    { href: '/today', label: tr('nav.today'), icon: Sun },
    { href: '/plan', label: tr('nav.plan'), icon: Sprout },
    { href: '/spray', label: tr('nav.spray'), icon: SprayCan },
    { href: '/scout', label: tr('nav.scout'), icon: Eye },
    { href: '/harvest', label: tr('nav.harvest'), icon: Wheat },
    ...(animalsLabel
      ? [
          {
            href: '/animals',
            label:
              animalsLabel === animalsTitle('pets') ? tr('nav.petsAndAnimals') : tr('nav.animals'),
            icon: PawPrint
          }
        ]
      : []),
    { href: '/inventory', label: tr('nav.inventory'), icon: Box },
    { href: '/equipment', label: tr('nav.equipment'), icon: Tractor },
    { href: '/records', label: tr('nav.records'), icon: FileText },
    { href: '/cards', label: tr('nav.cards'), icon: Layers }
  ]);

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
        path.startsWith('/settings/plugins/')
      );
    }
    return path === href || path.startsWith(`${href}/`);
  }

  // Above 768px the three field actions share one Actions dropdown so the
  // top row fits; the bottom bar keeps them as their own tabs for one-handed
  // use. desktopSlot[i] is item i's position among the top-row entries.
  const ACTION_HREFS = new Set(['/spray', '/scout', '/harvest']);
  const actionItems = $derived(items.filter((i) => ACTION_HREFS.has(i.href)));
  const firstActionHref = $derived(actionItems[0]?.href);
  const actionsActive = $derived(actionItems.some((i) => isActive(i.href)));
  const desktopSlot = $derived.by(() => {
    const slots: number[] = [];
    let n = -1;
    let grouped = false;
    for (const it of items) {
      if (!ACTION_HREFS.has(it.href) || !grouped) n += 1;
      if (ACTION_HREFS.has(it.href)) grouped = true;
      slots.push(n);
    }
    return slots;
  });
  const actionsSlot = $derived(desktopSlot[items.findIndex((i) => ACTION_HREFS.has(i.href))]);
  let actionsOpen = $state(false);
  let actionsEl = $state<HTMLDetailsElement | null>(null);
  let moreEl = $state<HTMLElement | null>(null);
  let actionsMenuPos = $state('');

  // The nav can scroll as a last resort, which would clip an absolute
  // dropdown, so the open menu is placed against the viewport.
  function placeActionsMenu() {
    if (!actionsEl?.open) return;
    const r = actionsEl.getBoundingClientRect();
    actionsMenuPos = `top: ${Math.round(r.bottom + 6)}px; left: ${Math.round(r.left)}px;`;
  }

  function closeMenusOnOutsideClick(e: MouseEvent) {
    const target = e.target as Node | null;
    if (actionsOpen && actionsEl && target && !actionsEl.contains(target)) actionsOpen = false;
    if (moreOpen && moreEl && target && !moreEl.contains(target)) moreOpen = false;
  }

  function closeMenusOnEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape' || (!actionsOpen && !moreOpen)) return;
    actionsOpen = false;
    moreOpen = false;
  }

  // Up to 600px the bottom bar keeps the five field tabs and folds the rest
  // into More, so every tab stays a 48px target. More is shown at every width
  // because it also holds Send feedback (#466).
  const PRIMARY_COUNT = 5;
  const moreItems = $derived(items.slice(PRIMARY_COUNT));
  const moreActive = $derived(moreItems.some((i) => isActive(i.href)));
  let moreOpen = $state(false);
  let feedbackOpen = $state(false);

  // Above 768px the top nav keeps as many pages inline as fit and folds the
  // rest into More, so nothing (More included) is scrolled out of sight.
  let navEl = $state<HTMLElement | null>(null);
  let headerEl = $state<HTMLElement | null>(null);
  let fit = $state<number>(Number.POSITIVE_INFINITY);
  const foldedActive = $derived(items.some((it, i) => desktopSlot[i] >= fit && isActive(it.href)));

  async function measure() {
    const nav = navEl;
    if (!nav || typeof window === 'undefined') return;
    fit = Number.POSITIVE_INFINITY;
    if (window.innerWidth <= 768) return;
    await tick();
    const links = [
      ...nav.querySelectorAll<HTMLElement>(
        ':scope > a.nav-link:not(.action-item), :scope > .actions-nav'
      )
    ];
    const more = nav.querySelector<HTMLElement>(':scope > .more-nav');
    if (!more || nav.scrollWidth <= nav.clientWidth + 1) return;
    const gap = parseFloat(getComputedStyle(nav).columnGap) || 0;
    let used = more.getBoundingClientRect().width;
    let n = 0;
    for (const link of links) {
      const w = link.getBoundingClientRect().width + gap;
      if (used + w > nav.clientWidth - 1) break;
      used += w;
      n += 1;
    }
    fit = n;
  }

  $effect(() => {
    const header = headerEl;
    void items.length;
    if (!header || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void measure();
        placeActionsMenu();
      });
    });
    ro.observe(header);
    void measure();
    window.addEventListener('scroll', placeActionsMenu, true);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('scroll', placeActionsMenu, true);
    };
  });

  function openFeedback() {
    moreOpen = false;
    feedbackOpen = true;
  }

  const avatarName = $derived(user?.name ?? user?.email ?? (user?.phone ? '#' : '?'));
</script>

<svelte:window onclick={closeMenusOnOutsideClick} onkeydown={closeMenusOnEscape} />

<header class="topbar" bind:this={headerEl}>
  <div class="brand-cluster">
    <span class="brand-mark" aria-hidden="true">
      <Leaf size={16} />
    </span>
    <a href="/" class="brand serif" aria-label={tr('nav.home')}>CropCard</a>
    {#if activeOwner}
      <span class="divider" aria-hidden="true"></span>
      <span class="farm mono" title={activeOwner.name}>{activeOwner.name}</span>
    {/if}
  </div>

  <nav aria-label={tr('nav.primary')} class="primary-nav" bind:this={navEl}>
    {#each items as item, i (item.href)}
      {@const Icon = item.icon}
      {@const active = isActive(item.href)}
      {#if item.href === firstActionHref}
        <details
          class="actions-nav"
          class:folded={actionsSlot >= fit}
          bind:open={actionsOpen}
          bind:this={actionsEl}
          ontoggle={placeActionsMenu}
        >
          <summary class="nav-link" class:active={actionsActive}>
            <Zap size={15} strokeWidth={1.75} />
            <span>{tr('nav.actions')}</span>
            <ChevronDown size={14} strokeWidth={1.75} class="caret" />
          </summary>
          <div class="actions-menu" style={actionsMenuPos}>
            {#each actionItems as action (action.href)}
              {@const ActionIcon = action.icon}
              <a
                href={action.href}
                class="more-link action-link"
                aria-current={isActive(action.href) ? 'page' : undefined}
                onclick={() => (actionsOpen = false)}
              >
                <ActionIcon size={16} strokeWidth={1.75} />
                <span>{action.label}</span>
              </a>
            {/each}
          </div>
        </details>
      {/if}
      <a
        href={item.href}
        class="nav-link"
        class:action-item={ACTION_HREFS.has(item.href)}
        class:secondary={i >= PRIMARY_COUNT}
        class:folded={desktopSlot[i] >= fit}
        class:active
        aria-current={active ? 'page' : undefined}
      >
        <Icon size={15} strokeWidth={1.75} />
        <span>{item.label}</span>
      </a>
    {/each}
    <details class="more-nav" bind:open={moreOpen} bind:this={moreEl}>
      <summary
        class="nav-link"
        class:overflow-active={moreActive}
        class:folded-active={foldedActive}
        aria-label={tr('nav.morePages')}
      >
        <Ellipsis size={15} strokeWidth={1.75} />
        <span>{tr('nav.more')}</span>
      </summary>
      <div class="more-menu">
        {#each items as item, i (item.href)}
          {@const Icon = item.icon}
          <a
            href={item.href}
            class="more-link page-link"
            class:overflow={i >= PRIMARY_COUNT}
            class:folded={desktopSlot[i] >= fit}
            aria-current={isActive(item.href) ? 'page' : undefined}
            onclick={() => (moreOpen = false)}
          >
            <Icon size={16} strokeWidth={1.75} />
            <span>{item.label}</span>
          </a>
        {/each}
        {#if user?.isSuperadmin}
          <a href="/admin/feedback" class="more-link" onclick={() => (moreOpen = false)}>
            <Inbox size={16} strokeWidth={1.75} />
            <span>{tr('nav.feedbackInbox')}</span>
          </a>
        {/if}
        <button type="button" class="more-link" onclick={openFeedback}>
          <MessageSquare size={16} strokeWidth={1.75} />
          <span>{tr('nav.sendFeedback')}</span>
        </button>
      </div>
    </details>
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
    {#if availableOwners.length > 1 && activeOwner}
      <details class="owner-chip">
        <summary aria-label={tr('nav.switchFarm')} title={activeOwner.name}>
          <Avatar name={avatarName} src={user?.avatarUrl} />
        </summary>
        <div class="owner-popover" role="menu">
          <div class="owner-popover-label">{tr('nav.switchFarm')}</div>
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
      <span class="standalone" title={user?.name}>
        <Avatar name={avatarName} src={user?.avatarUrl} />
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
  .owner-role {
    font-size: var(--font-size-meta);
    color: var(--color-ink-muted);
    text-transform: uppercase;
  }

  /* The header row degrades in steps so it never widens the page: the sync
     label collapses to its dot first (text stays in the a11y tree), then the
     farm name. Pages that still do not fit fold into More. */
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

  .more-nav {
    display: flex;
    position: relative;
  }
  .more-nav summary {
    list-style: none;
    cursor: pointer;
  }
  .more-nav summary::-webkit-details-marker {
    display: none;
  }
  .more-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
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
  .more-link {
    display: flex;
    align-items: center;
    gap: 10px;
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
  .more-link:hover {
    background: var(--color-divider-soft);
  }
  .more-link[aria-current='page'] {
    background: var(--pill-forest-bg);
    color: var(--pill-forest-fg);
  }
  .more-link.overflow {
    display: none;
  }
  .more-link.page-link:not(.overflow):not(.folded) {
    display: none;
  }
  .actions-nav {
    display: none;
    position: relative;
  }
  .actions-nav summary {
    list-style: none;
    cursor: pointer;
  }
  .actions-nav summary::-webkit-details-marker {
    display: none;
  }
  .actions-nav :global(.caret) {
    transition: transform 0.15s ease;
  }
  .actions-nav[open] :global(.caret) {
    transform: rotate(180deg);
  }
  .actions-menu {
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
  /* Pages that do not fit the top nav move into More. The nav is a
     scrolling strip as a last resort, which would clip a dropdown, so the
     open menu is placed against the viewport. */
  @media (min-width: 769px) {
    .actions-nav {
      display: flex;
    }
    .nav-link.action-item,
    .nav-link.folded,
    .actions-nav.folded {
      display: none;
    }
    .more-link.folded {
      display: flex;
    }
    .more-nav summary.folded-active {
      color: var(--color-forest-deep);
      font-weight: 600;
    }
    .more-nav[open] .more-menu {
      position: fixed;
      top: 64px;
      right: 16px;
    }
  }
  @media (max-width: 768px) {
    .more-nav {
      flex: 1;
    }
    .more-nav summary {
      width: 100%;
    }
    .more-menu {
      position: fixed;
      top: auto;
      right: 8px;
      bottom: calc(72px + env(safe-area-inset-bottom, 0px));
    }
  }
  @media (max-width: 600px) {
    .nav-link.secondary {
      display: none;
    }
    .more-link.overflow {
      display: flex;
    }
    .more-nav summary.overflow-active {
      background: var(--pill-forest-bg);
      color: var(--pill-forest-fg);
      font-weight: 600;
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
