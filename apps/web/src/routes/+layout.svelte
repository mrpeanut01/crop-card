<script lang="ts">
  import { onMount } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';

  let { data, children } = $props();

  /** True when the current URL "belongs to" the nav link's href —
   *  exact match OR pathname is a subroute of the link path. Special-
   *  cases /plan?tab=layout (Map link) since the pathname is shared
   *  with the Plan link; we discriminate on the tab query param. */
  function navActive(href: string): boolean {
    const path = page.url.pathname;
    const tabParam = page.url.searchParams.get('tab');
    if (href === '/plan?tab=layout') {
      return path === '/plan' && tabParam === 'layout';
    }
    if (href === '/plan') {
      return path === '/plan' && tabParam !== 'layout';
    }
    if (href === '/') return path === '/';
    // Sub-paths count (e.g., /spray/fungicide highlights /spray).
    return path === href || path.startsWith(`${href}/`);
  }

  let pendingCount = $state<number | null>(null);
  let online = $state(true);
  let userDetails: HTMLDetailsElement | undefined = $state();

  const userInitial = $derived(data.user?.email?.[0]?.toUpperCase() ?? '?');

  afterNavigate(() => {
    if (userDetails) userDetails.open = false;
  });

  onMount(() => {
    online = navigator.onLine;
    const updateOnline = () => (online = navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    let cleanupSync: (() => void) | undefined;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    (async () => {
      try {
        const { watchOnline, pendingCount: count } = await import('$lib/client/syncQueue');
        cleanupSync = watchOnline();
        const refresh = async () => {
          try {
            pendingCount = await count();
          } catch {
            pendingCount = null;
          }
        };
        await refresh();
        pollInterval = setInterval(refresh, 4000);
      } catch {
        // IndexedDB unavailable (SSR / private mode). Skip silently.
      }
    })();

    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      cleanupSync?.();
      if (pollInterval) clearInterval(pollInterval);
    };
  });
</script>

{#if data.user}
  <header class="app-header">
    <a href="/" class="brand">CropCard</a>
    <nav aria-label="Primary" class="primary-nav">
      {#each [{ href: '/today', label: 'Today' }, { href: '/plan', label: 'Plan' }, { href: '/calendar', label: 'Calendar' }, { href: '/stock', label: 'Stock' }, { href: '/spray', label: 'Spray' }, { href: '/insecticides', label: 'Insecticides' }, { href: '/scout', label: 'Scout' }, { href: '/harvest', label: 'Harvest' }, { href: '/hay', label: 'Hay' }, { href: '/fertility', label: 'Fertility' }, { href: '/equipment', label: 'Equipment' }, { href: '/plan?tab=layout', label: 'Map' }, { href: '/records', label: 'Records' }] as item (item.href)}
        <a href={item.href} aria-current={navActive(item.href) ? 'page' : undefined}>{item.label}</a
        >
      {/each}
    </nav>
    <div class="top-right">
      {#if data.user && data.activeOwner}
        <details class="owner-chip">
          <summary aria-label="Switch farm" title={data.activeOwner.name}>
            <span class="owner-name">{data.activeOwner.name}</span>
            <span class="owner-caret" aria-hidden="true">▾</span>
          </summary>
          <div class="owner-popover">
            <ul class="owner-list">
              {#each data.availableOwners as o}
                <li>
                  <form
                    method="POST"
                    action="/api/session/switch-owner"
                    enctype="application/x-www-form-urlencoded"
                  >
                    <input type="hidden" name="ownerId" value={o.id} />
                    <button
                      type="button"
                      class="owner-choice"
                      class:active={o.id === data.activeOwner.id}
                      onclick={async () => {
                        const res = await fetch('/api/session/switch-owner', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ ownerId: o.id })
                        });
                        if (res.ok) {
                          try {
                            const { resetTenantCaches } = await import('$lib/client/tenantSwitch');
                            await resetTenantCaches(o.id);
                          } catch {
                            /* cache reset best-effort */
                          }
                          window.location.href = '/today';
                        }
                      }}
                    >
                      <span>{o.name}</span>
                      <span class="owner-role">{o.role}</span>
                    </button>
                  </form>
                </li>
              {/each}
            </ul>
          </div>
        </details>
      {/if}
      <a href="/settings" class="gear-btn" aria-label="Settings" title="Settings">
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
      </a>
      <details class="user-menu" bind:this={userDetails}>
        <summary aria-label="Account menu" title={data.user.email}>
          <span class="avatar role-{data.user.role}" aria-hidden="true">{userInitial}</span>
        </summary>
        <div class="user-popover">
          <div class="user-info">
            <div class="user-email">{data.user.email}</div>
            <span class="user-role role-{data.user.role}">{data.user.role}</span>
          </div>
          <form method="POST" action="/signout">
            <button type="submit" class="signout">Sign out</button>
          </form>
        </div>
      </details>
    </div>
  </header>
{/if}

{#if !online || (pendingCount ?? 0) > 0}
  <div
    class="status-bar"
    class:offline={!online}
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    {#if !online}
      <span>⚠ Offline — spray records will queue locally and sync when back online.</span>
    {/if}
    {#if pendingCount && pendingCount > 0}
      <span>{pendingCount} pending record{pendingCount === 1 ? '' : 's'} queued.</span>
    {/if}
  </div>
{/if}

{#if data.user?.impersonating}
  <div class="role-banner impersonation" role="status">
    🔒 Impersonating <strong>{data.activeOwner?.name ?? 'this Owner'}</strong> as superadmin — every
    mutation is audited. <a href="/admin/owners">Exit impersonation</a>
  </div>
{/if}

{#if data.user?.role === 'inspector'}
  <div class="role-banner inspector" role="status">
    👁 Inspector mode — read-only across all records, plans, and exports.
  </div>
{:else if data.user?.role === 'custom-operator'}
  <div class="role-banner custom-operator" role="status">
    🤝 Custom Operator — can record sprays on assigned blocks; stock financials are hidden.
  </div>
{/if}

{#if data.dirtySprayers.length > 0}
  <div class="decon-banner" role="status">
    <span>
      ⚠ {data.dirtySprayers.length} sprayer{data.dirtySprayers.length === 1 ? '' : 's'}
      need{data.dirtySprayers.length === 1 ? 's' : ''} decontamination —
      {#each data.dirtySprayers as s, i (s.id)}
        {#if i > 0},
        {/if}
        <a href="/spray/decon?sprayer={encodeURIComponent(s.id)}">
          <strong>{s.label}</strong> ({s.lastChemistryClass})
        </a>
      {/each}
    </span>
  </div>
{/if}

<a class="skip-link" href="#main-content">Skip to main content</a>

<main id="main-content" tabindex="-1">
  {@render children()}
</main>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    background: #f5f7f4;
    color: #1a1a1a;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(button, a) {
    min-height: 48px;
    min-width: 48px;
  }

  :global(:focus-visible) {
    outline: 3px solid #ffd400;
    outline-offset: 2px;
  }

  :global(:focus:not(:focus-visible)) {
    outline: none;
  }

  .skip-link {
    position: absolute;
    left: 0.5rem;
    top: -100px;
    background: #1f5e3a;
    color: white;
    padding: 0.6rem 1rem;
    border-radius: 0 0 6px 6px;
    text-decoration: none;
    font-weight: 600;
    z-index: 100;
    transition: top 0.15s ease;
  }
  .skip-link:focus {
    top: 0;
  }

  main:focus {
    outline: none;
  }

  .app-header {
    background: #1f5e3a;
    color: white;
    /* Zero bottom padding so the active tab's white fill connects to
     * the page body without a green stripe in between. */
    padding: 0.75rem 1rem 0;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .brand {
    color: white;
    font-weight: 700;
    font-size: 1.25rem;
    text-decoration: none;
  }
  .top-right {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-left: auto;
  }
  .gear-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    min-width: 40px;
    min-height: 40px;
    border-radius: 50%;
    color: white;
    background: rgba(255, 255, 255, 0.12);
    text-decoration: none;
    transition: background 0.15s ease;
  }
  .gear-btn:hover {
    background: rgba(255, 255, 255, 0.25);
  }
  .gear-btn svg {
    display: block;
  }

  .user-menu {
    position: relative;
  }
  .user-menu > summary {
    list-style: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    min-width: 40px;
    min-height: 40px;
    border-radius: 50%;
    padding: 0;
  }
  .user-menu > summary::-webkit-details-marker {
    display: none;
  }
  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    font-size: 0.95rem;
    font-weight: 700;
    border: 2px solid rgba(255, 255, 255, 0.3);
    line-height: 1;
  }
  .avatar.role-owner {
    background: #ffd400;
    color: #1f5e3a;
    border-color: rgba(255, 212, 0, 0.55);
  }
  .avatar.role-helper {
    background: rgba(255, 255, 255, 0.25);
    color: white;
  }
  .avatar.role-inspector {
    background: #ececec;
    color: #1f5e3a;
  }
  .avatar.role-custom-operator {
    background: #c8d8ee;
    color: #1f3a5e;
  }
  .user-menu[open] > summary .avatar {
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.35);
  }

  .user-popover {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    min-width: 240px;
    background: white;
    color: #1a1a1a;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    padding: 0.85rem;
    z-index: 200;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .user-info {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .user-email {
    font-size: 0.92rem;
    font-weight: 600;
    word-break: break-all;
  }
  .user-role {
    align-self: flex-start;
    padding: 0.15rem 0.55rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .user-role.role-owner {
    background: #ffd400;
    color: #1f5e3a;
  }
  .user-role.role-helper {
    background: #1f5e3a;
    color: white;
  }
  .user-role.role-inspector {
    background: #ececec;
    color: #1f5e3a;
  }
  .user-role.role-custom-operator {
    background: #c8d8ee;
    color: #1f3a5e;
  }
  .user-popover form {
    margin: 0;
  }
  .user-popover .signout {
    width: 100%;
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.6rem 0.9rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    min-height: 44px;
  }
  .user-popover .signout:hover {
    background: #195030;
  }

  .top-right .signin {
    background: rgba(255, 255, 255, 0.15);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 0.6rem 1rem;
    text-decoration: none;
  }
  .top-right .signin:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  /** Visually-hidden helper, available app-wide. Pages now hide their
   *  H1/lede behind this — the active top-nav tab carries the page
   *  identity for sighted users while keeping the heading in the DOM
   *  for assistive tech. */
  :global(.sr-only) {
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

  .primary-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 100;
    background: #1f5e3a;
    box-shadow: 0 -2px 6px rgba(0, 0, 0, 0.2);
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 0;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  .primary-nav > a {
    color: white;
    text-decoration: none;
    padding: 0.4rem 0.25rem;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-size: 0.72rem;
    font-weight: 600;
    min-height: 52px;
    border-top: 3px solid transparent;
    border-radius: 0;
  }
  .primary-nav > a:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  main {
    /* Tightened top padding so the active nav tab and the page content
     * read as one continuous surface; the bottom keeps room for the
     * fixed mobile nav + finger-reach margin. */
    padding-block: 0.5rem 1rem;
    padding-inline: clamp(0.5rem, 2vw, 2rem);
    padding-bottom: calc(112px + env(safe-area-inset-bottom, 0) + 1rem);
    max-width: 1800px;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }
  .status-bar {
    background: #fff3cd;
    color: #4a2900;
    padding: 0.6rem 1rem;
    font-size: 0.95rem;
    text-align: center;
    border-bottom: 1px solid #d4b75a;
    display: flex;
    justify-content: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    font-weight: 600;
  }
  .status-bar.offline {
    background: #b71c1c;
    color: #fff;
    border-bottom-color: #5a0e0e;
  }
  .role-banner {
    padding: 0.5rem 1rem;
    font-size: 0.9rem;
    text-align: center;
    font-weight: 600;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  }
  .role-banner.inspector {
    background: #ececec;
    color: #333;
  }
  .role-banner.custom-operator {
    background: #e3edf9;
    color: #1f3a5e;
  }
  .decon-banner {
    background: #b71c1c;
    color: #fff;
    padding: 0.75rem 1rem;
    font-size: 1rem;
    text-align: center;
    border-bottom: 2px solid #5a0e0e;
    font-weight: 600;
  }
  .decon-banner a {
    color: #fff;
    text-decoration: underline;
  }
  .decon-banner a strong {
    color: #fff;
  }

  @media (min-width: 768px) {
    .primary-nav {
      position: static;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding: 0;
      box-shadow: none;
      grid-template-columns: none;
    }
    .primary-nav > a {
      padding: 0.55rem 1rem 0.6rem;
      border-radius: 10px 10px 0 0;
      background: rgba(255, 255, 255, 0.08);
      min-height: 44px;
      font-size: 1rem;
      border-top: none;
      position: relative;
      bottom: -1px;
      transition: background-color 0.12s ease;
    }
    .primary-nav > a:hover {
      background: rgba(255, 255, 255, 0.18);
    }
    .primary-nav > a[aria-current='page'] {
      /* Pure white so the tab's base color matches the page body and
       * the bottom edge looks continuous with the content surface. */
      background: #fff;
      color: #1f5e3a;
      font-weight: 700;
      cursor: default;
      box-shadow: 0 -2px 4px rgba(0, 0, 0, 0.08);
      z-index: 1;
    }
    .primary-nav > a[aria-current='page']:hover {
      background: #fff;
    }
    main {
      padding: 1rem;
      padding-bottom: 1rem;
    }
  }
  /* Mobile (bottom nav): tab metaphor doesn't work upside-down. Use a
   * solid pill fill for the active item instead. */
  @media (max-width: 767.98px) {
    .primary-nav > a[aria-current='page'] {
      background: rgba(255, 255, 255, 0.22);
      border-top: 3px solid #fff;
    }
  }

  /* Phase 18d: top-nav Owner chip + impersonation banner */
  .owner-chip {
    margin-right: 0.5rem;
  }
  .owner-chip summary {
    list-style: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    background: rgba(255, 255, 255, 0.1);
    font-size: 0.875rem;
    min-height: 32px;
    min-width: 0;
  }
  .owner-chip summary::-webkit-details-marker {
    display: none;
  }
  .owner-name {
    font-weight: 600;
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .owner-caret {
    opacity: 0.75;
  }
  .owner-popover {
    position: absolute;
    right: 1rem;
    margin-top: 0.25rem;
    background: white;
    color: #1a1a1a;
    border: 1px solid var(--divider, #ccc);
    border-radius: 0.375rem;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.15);
    z-index: 50;
    min-width: 16rem;
  }
  .owner-list {
    list-style: none;
    padding: 0.25rem 0;
    margin: 0;
  }
  .owner-choice {
    background: transparent;
    color: inherit;
    border: none;
    width: 100%;
    text-align: left;
    padding: 0.625rem 0.875rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    cursor: pointer;
    font: inherit;
    min-height: 40px;
  }
  .owner-choice:hover {
    background: rgba(31, 94, 58, 0.08);
  }
  .owner-choice.active {
    background: rgba(31, 94, 58, 0.16);
    font-weight: 600;
  }
  .owner-role {
    color: var(--fg-muted, #555);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .role-banner.impersonation {
    background: #6b1717;
    color: white;
    padding: 0.5rem 1rem;
    text-align: center;
    font-weight: 600;
  }
  .role-banner.impersonation a {
    color: #ffd400;
    margin-left: 0.5rem;
  }
</style>
