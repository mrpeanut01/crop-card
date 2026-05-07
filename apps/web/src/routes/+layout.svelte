<script lang="ts">
  import { onMount } from 'svelte';

  let { data, children } = $props();

  let pendingCount = $state<number | null>(null);
  let online = $state(true);

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

<header class="app-header">
  <div class="top">
    <a href="/" class="brand">CropCard</a>
    <div class="user-area">
      {#if data.user}
        <span class="user">
          <span class="email">{data.user.email}</span>
          <span class="role role-{data.user.role}">{data.user.role}</span>
        </span>
        <form method="POST" action="/signout">
          <button type="submit" class="signout">Sign out</button>
        </form>
      {:else}
        <a class="signin" href="/signin">Sign in</a>
      {/if}
    </div>
  </div>
  <nav aria-label="Primary" class="primary-nav">
    <a href="/today">Today</a>
    <a href="/crops">Crops</a>
    <a href="/spray">Spray</a>
    <a href="/scout">Scout</a>
    <a href="/plan">Plan</a>
    <a href="/records">Records</a>
    <details class="more">
      <summary>More</summary>
      <div class="more-menu">
        <a href="/harvest">Harvest</a>
        <a href="/hay">Hay</a>
        <a href="/insecticides">Insecticides</a>
        <a href="/fertility">Fertility</a>
        <a href="/calibrate">Calibrate</a>
        <a href="/equipment">Equipment</a>
        <a href="/stock">Stock</a>
        <a href="/map">Map</a>
        <a href="/plugins">Plugins</a>
        <a href="/settings">Settings</a>
      </div>
    </details>
  </nav>
</header>

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
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .brand {
    color: white;
    font-weight: 700;
    font-size: 1.25rem;
    text-decoration: none;
  }
  .user-area {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
  }
  .user-area form {
    margin: 0;
  }
  .user-area .user {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: white;
  }
  .user-area .email {
    color: rgba(255, 255, 255, 0.9);
  }
  .user-area .role {
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.7rem;
    letter-spacing: 0.5px;
  }
  .user-area .role-owner {
    background: #ffd400;
    color: #1f5e3a;
  }
  .user-area .role-helper {
    background: rgba(255, 255, 255, 0.25);
    color: white;
  }
  .user-area .role-inspector {
    background: #ececec;
    color: #1f5e3a;
  }
  .user-area .role-custom-operator {
    background: #c8d8ee;
    color: #1f3a5e;
  }
  .user-area .signout,
  .user-area .signin {
    background: rgba(255, 255, 255, 0.15);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 0.6rem 1rem;
    font: inherit;
    text-decoration: none;
    cursor: pointer;
  }
  .user-area .signout:hover,
  .user-area .signin:hover {
    background: rgba(255, 255, 255, 0.3);
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
    grid-template-columns: repeat(7, 1fr);
    gap: 0;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  .primary-nav > a,
  .primary-nav > details > summary {
    color: white;
    text-decoration: none;
    padding: 0.5rem 0.25rem;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-size: 0.8rem;
    font-weight: 600;
    min-height: 60px;
    border-top: 3px solid transparent;
    border-radius: 0;
  }
  .primary-nav > a:hover,
  .primary-nav > details > summary:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .primary-nav .more {
    position: relative;
  }
  .primary-nav .more > summary {
    list-style: none;
    cursor: pointer;
  }
  .primary-nav .more > summary::-webkit-details-marker {
    display: none;
  }
  .primary-nav .more[open] > summary {
    background: rgba(255, 255, 255, 0.15);
  }
  .primary-nav .more-menu {
    position: absolute;
    bottom: 100%;
    right: 0;
    z-index: 101;
    background: #1f5e3a;
    border-radius: 8px 0 0 0;
    box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
    min-width: 12rem;
  }
  .primary-nav .more-menu a {
    color: white;
    text-decoration: none;
    padding: 0.9rem 1rem;
    min-height: 60px;
    display: flex;
    align-items: center;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    font-weight: 600;
  }
  .primary-nav .more-menu a:first-child {
    border-top: none;
  }
  .primary-nav .more-menu a:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  main {
    padding: 1rem;
    padding-bottom: calc(60px + env(safe-area-inset-bottom, 0) + 1rem);
    max-width: 960px;
    margin: 0 auto;
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
    .app-header {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
    .primary-nav {
      position: static;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding: 0;
      box-shadow: none;
      grid-template-columns: none;
    }
    .primary-nav > a,
    .primary-nav > details > summary {
      padding: 0.5rem 0.75rem;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.1);
      min-height: 48px;
      font-size: 1rem;
      border-top: none;
    }
    .primary-nav .more-menu a {
      min-height: 48px;
    }
    /* Desktop: nav is at the TOP, so the More dropdown must open DOWN
       below the summary (not up, which was clipping it off-screen). */
    .primary-nav .more-menu {
      bottom: auto;
      top: 100%;
      right: 0;
      border-radius: 0 0 8px 8px;
      box-shadow: 0 6px 12px rgba(0, 0, 0, 0.25);
    }
    main {
      padding: 1rem;
      padding-bottom: 1rem;
    }
  }
</style>
