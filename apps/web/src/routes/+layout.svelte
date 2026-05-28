<script lang="ts">
  import { onMount } from 'svelte';
  // Fonts: `@font-face` declarations in $lib/styles/type.css use a local()
  // → CDN fallback chain so a missing font asset never crashes a route.
  // No npm dep on fontsource intentionally — the static `import` from
  // node_modules was a single point of failure on container/lockfile drift.
  import '$lib/styles/index.css';

  import { enhance } from '$app/forms';
  import TopBar from '$lib/components/ui/TopBar.svelte';
  import Banner from '$lib/components/ui/Banner.svelte';

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

  async function onSwitchOwner(ownerId: string) {
    const res = await fetch('/api/session/switch-owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId })
    });
    if (res.ok) {
      try {
        const { resetTenantCaches } = await import('$lib/client/tenantSwitch');
        await resetTenantCaches(ownerId);
      } catch {
        // best-effort cache reset
      }
      window.location.href = '/today';
    }
  }
</script>

{#if data.user}
  <TopBar
    user={data.user}
    activeOwner={data.activeOwner}
    availableOwners={data.availableOwners}
    {online}
    {pendingCount}
    {onSwitchOwner}
  />
{/if}

{#if !online}
  <Banner tone="rust" urgent>
    Offline — spray records will queue locally and sync when back online.
  </Banner>
{:else if (pendingCount ?? 0) > 0}
  <Banner tone="wheat">
    {pendingCount} pending record{pendingCount === 1 ? '' : 's'} queued.
    {#snippet action()}
      <a href="/records/pending" class="banner-link">Review queue</a>
    {/snippet}
  </Banner>
{/if}

{#if data.user?.impersonating}
  <Banner tone="rust" urgent>
    Impersonating <strong>{data.activeOwner?.name ?? 'this Owner'}</strong> as superadmin — every
    mutation is audited.
    {#snippet action()}
      <!-- #221 / CT-ADM-002 — must be a form POST so the server-side
           exitImpersonation action runs (clears the session impersonation
           flag and writes the superadmin_audit row). Previously a plain
           anchor GET, which navigated without invoking the action — the
           session stayed impersonated and the audit trail was missing. -->
      <form
        method="POST"
        action="/admin/owners?/exitImpersonation"
        use:enhance
        style="display:contents"
      >
        <button type="submit" class="banner-link-btn">Exit impersonation</button>
      </form>
    {/snippet}
  </Banner>
{/if}

{#if data.user?.role === 'inspector'}
  <Banner tone="neutral">Inspector mode — read-only across all records, plans, and exports.</Banner>
{:else if data.user?.role === 'custom-operator'}
  <Banner tone="sky">
    Custom Operator — can record sprays on assigned blocks; stock financials are hidden.
  </Banner>
{/if}

{#if data.dirtySprayers.length > 0}
  <Banner tone="rust" urgent>
    {data.dirtySprayers.length} sprayer{data.dirtySprayers.length === 1 ? '' : 's'} need{data
      .dirtySprayers.length === 1
      ? 's'
      : ''} decontamination —
    {#each data.dirtySprayers as s, i (s.id)}
      {#if i > 0}{', '}{/if}<strong>{s.label}</strong> ({s.lastChemistryClass}){/each}
    <a class="decon-cta" href="/spray/decon?sprayer={encodeURIComponent(data.dirtySprayers[0].id)}">
      Run decon wizard →
    </a>
  </Banner>
{/if}

<a class="skip-link" href="#main-content">Skip to main content</a>

<main id="main-content" tabindex="-1">
  {@render children()}
</main>

<style>
  .skip-link {
    position: absolute;
    left: 0.5rem;
    top: -100px;
    background: var(--color-forest);
    color: var(--color-cream);
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

  main {
    padding-block: var(--space-4) var(--space-4);
    padding-inline: clamp(var(--space-2), 2vw, var(--page-padding));
    max-width: 1800px;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }
  main:focus {
    outline: none;
  }

  /* Mobile: reserve bottom space so fixed bottom-nav (rendered inside TopBar)
     doesn't occlude main content. Matches the env(safe-area-inset-bottom)
     handling on the bottom nav itself. */
  @media (max-width: 768px) {
    main {
      padding-bottom: calc(72px + env(safe-area-inset-bottom, 0));
    }
  }

  /* #221 / CT-ADM-002 — banner action that needs to POST (form button)
     styled to read like the prior anchor link. Inherits the Banner's
     foreground colour + underlined affordance. */
  .banner-link-btn {
    background: transparent;
    border: 0;
    padding: 0;
    margin: 0;
    color: inherit;
    text-decoration: underline;
    font: inherit;
    cursor: pointer;
  }
  .banner-link-btn:hover,
  .banner-link-btn:focus-visible {
    text-decoration: none;
  }

  /* Visually-hidden helper used app-wide for screen-reader-only labels. */
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
</style>
