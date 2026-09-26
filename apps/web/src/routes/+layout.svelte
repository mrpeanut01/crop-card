<script lang="ts">
  import { onMount } from 'svelte';
  import { dev } from '$app/environment';
  // Fonts: `@font-face` declarations in $lib/styles/type.css use a local()
  // → CDN fallback chain so a missing font asset never crashes a route.
  // No npm dep on fontsource intentionally — the static `import` from
  // node_modules was a single point of failure on container/lockfile drift.
  import '$lib/styles/index.css';

  import { enhance } from '$app/forms';
  import TopBar from '$lib/components/ui/TopBar.svelte';
  import Banner from '$lib/components/ui/Banner.svelte';
  import UpdateToast from '$lib/components/ui/UpdateToast.svelte';

  const { data, children } = $props();

  let pendingCount = $state<number | null>(null);
  let online = $state(true);
  let waitingWorker = $state<ServiceWorker | null>(null);
  let updateDismissed = $state(false);
  // An Owner switch in another tab moves the shared session cookie; this
  // tab still shows (and queues records for) the Owner it rendered for.
  let staleOwnerId = $state<string | null>(null);
  const staleOwnerName = $derived(
    data.availableOwners?.find((o) => o.id === staleOwnerId)?.name ?? 'another farm'
  );
  const currentOwnerId = $derived(data.activeOwner?.id ?? data.user?.activeOwnerId ?? null);

  // Mount and client-side Owner changes (e.g. the owner picker) both land
  // here: keep this tab's queue key in step and tell other tabs.
  $effect(() => {
    const ownerId = currentOwnerId;
    if (!ownerId) return;
    staleOwnerId = null;
    Promise.all([import('$lib/client/syncQueue'), import('$lib/client/ownerSync')])
      .then(([queue, sync]) => {
        queue.primeActiveOwnerId(ownerId);
        sync.announceOwnerToTabs(ownerId);
      })
      .catch(() => undefined);
  });

  function reloadIntoNewVersion() {
    const worker = waitingWorker;
    if (!worker) return;
    import('$lib/client/swUpdate')
      .then(({ activateWaitingWorker }) =>
        activateWaitingWorker(worker, navigator.serviceWorker, () => window.location.reload())
      )
      .catch(() => window.location.reload());
  }

  onMount(() => {
    online = navigator.onLine;
    const updateOnline = () => (online = navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    let cleanupSync: (() => void) | undefined;
    let stopCardSync: (() => void) | undefined;
    let stopOwnerWatch: (() => void) | undefined;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const activeOwnerId = data.activeOwner?.id ?? data.user?.activeOwnerId ?? null;
    import('$lib/client/tenantSwitch')
      .then(({ syncServiceWorkerTenant }) =>
        syncServiceWorkerTenant({ register: !dev, signedIn: !!data.user, ownerId: activeOwnerId })
      )
      .catch(() => undefined);

    let stopSwUpdates: (() => void) | undefined;
    if (!dev) {
      import('$lib/client/swUpdate')
        .then(({ watchServiceWorkerUpdates }) =>
          watchServiceWorkerUpdates((worker) => {
            waitingWorker = worker;
            updateDismissed = false;
          })
        )
        .then((stop) => (stopSwUpdates = stop))
        .catch(() => undefined);
    }

    (async () => {
      try {
        const {
          watchOnline,
          pendingCount: count,
          primeActiveOwnerId
        } = await import('$lib/client/syncQueue');
        // #314 — seed the active-owner key from the server-provided value
        // BEFORE watchOnline() can auto-drain. A fresh tab / first-login
        // never fires an Owner-switch (the pre-#314 sole writer), so
        // without this the key is null and drainQueue would fail-safe to a
        // no-op (records stranded) while enqueue mis-tags rows.
        primeActiveOwnerId(activeOwnerId);
        if (activeOwnerId) {
          import('$lib/client/cardSync')
            .then(({ startCardSync }) => (stopCardSync = startCardSync()))
            .catch(() => undefined);
          const { isStaleOwner, watchOwnerSwitches } = await import('$lib/client/ownerSync');
          stopOwnerWatch = watchOwnerSwitches((observed) => {
            staleOwnerId = isStaleOwner(currentOwnerId, observed) ? observed : null;
          });
        }
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
      stopCardSync?.();
      stopOwnerWatch?.();
      stopSwUpdates?.();
      if (pollInterval) clearInterval(pollInterval);
    };
  });

  async function onSwitchOwner(ownerId: string) {
    const tenantSwitch = await import('$lib/client/tenantSwitch').catch(() => null);
    await tenantSwitch?.beginOwnerSwitch().catch(() => undefined);
    const res = await fetch('/api/session/switch-owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId })
    });
    if (res.ok) {
      await tenantSwitch?.resetTenantCaches(ownerId).catch(() => undefined);
      window.location.href = '/today';
    } else {
      const previous = data.activeOwner?.id ?? data.user?.activeOwnerId ?? null;
      await tenantSwitch?.announceActiveOwner(previous).catch(() => undefined);
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
    alerts={data.navAlerts}
    {onSwitchOwner}
  />
{/if}

{#if staleOwnerId}
  <Banner tone="rust" urgent>
    You switched to <strong>{staleOwnerName}</strong> in another tab. This tab still shows
    <strong>{data.activeOwner?.name ?? 'the previous farm'}</strong>; queued records wait until you
    reload.
    {#snippet action()}
      <button type="button" class="banner-link-btn" onclick={() => window.location.reload()}>
        Reload tab
      </button>
    {/snippet}
  </Banner>
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
      {i > 0 ? ', ' : ''}<strong>{s.label}</strong> ({s.lastChemistryClass}){/each}
    <a class="decon-cta" href="/spray/decon?sprayer={encodeURIComponent(data.dirtySprayers[0].id)}">
      Run decon wizard →
    </a>
  </Banner>
{/if}

<a class="skip-link" href="#main-content">Skip to main content</a>

<main id="main-content" tabindex="-1">
  {@render children()}
</main>

<UpdateToast
  visible={!!waitingWorker && !updateDismissed}
  onReload={reloadIntoNewVersion}
  onDismiss={() => (updateDismissed = true)}
/>

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
