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
  <nav aria-label="Primary">
    <a href="/today">Today</a>
    <a href="/plan">Plan</a>
    <a href="/spray">Spray</a>
    <a href="/scout">Scout</a>
    <a href="/harvest">Harvest</a>
    <a href="/calibrate">Calibrate</a>
    <a href="/records">Records</a>
    <a href="/plugins">Plugins</a>
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
  .user-area .signout,
  .user-area .signin {
    background: rgba(255, 255, 255, 0.15);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 0.4rem 0.75rem;
    font: inherit;
    text-decoration: none;
    cursor: pointer;
    min-height: 36px;
    min-width: 36px;
  }
  .user-area .signout:hover,
  .user-area .signin:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  nav {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  nav a {
    color: white;
    text-decoration: none;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.1);
    display: inline-flex;
    align-items: center;
  }

  nav a:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  main {
    padding: 1rem;
    max-width: 960px;
    margin: 0 auto;
  }
  .status-bar {
    background: #fff3cd;
    color: #b35900;
    padding: 0.5rem 1rem;
    font-size: 0.85rem;
    text-align: center;
    border-bottom: 1px solid #f0e0a0;
    display: flex;
    justify-content: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .status-bar.offline {
    background: #fce8e8;
    color: #b00020;
    border-bottom-color: #ffb3b3;
    font-weight: 600;
  }
  .decon-banner {
    background: #fff3cd;
    color: #b35900;
    padding: 0.6rem 1rem;
    font-size: 0.9rem;
    text-align: center;
    border-bottom: 1px solid #f0e0a0;
    font-weight: 600;
  }
  .decon-banner a {
    color: #b35900;
    text-decoration: underline;
  }

  @media (min-width: 768px) {
    .app-header {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
  }
</style>
