<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import type { SubmitFunction } from '$app/forms';
  import { createT, type MessageKey } from '$lib/i18n';
  import { fmt } from '$lib/prefsState.svelte';
  import Banner from '$lib/components/ui/Banner.svelte';

  const { expiresAt }: { expiresAt: number } = $props();
  const tr = $derived(createT(page.data?.locale));

  let busy = $state(false);

  const tryLinks: Array<{ href: string; key: MessageKey }> = [
    { href: '/today?view=week', key: 'entry.demo.try.week' },
    { href: '/plan', key: 'entry.demo.try.plan' },
    { href: '/plan/farm', key: 'entry.demo.try.map' },
    { href: '/spray', key: 'entry.demo.try.spray' },
    { href: '/records', key: 'entry.demo.try.records' },
    { href: '/inventory', key: 'entry.demo.try.inventory' },
    { href: '/equipment', key: 'entry.demo.try.equipment' },
    { href: '/animals', key: 'entry.demo.try.animals' },
    { href: '/cards', key: 'entry.demo.try.cards' },
    { href: '/finance', key: 'entry.demo.try.finance' }
  ];

  /** A fresh farm is a different Owner, so reload the whole app rather than
   *  keep this tab's caches for the old one. */
  const fullReload: SubmitFunction = ({ cancel, action }) => {
    if (action.search.includes('reset') && !confirm(tr('entry.demo.resetConfirm'))) {
      cancel();
      return;
    }
    if (action.search.includes('scratch') && !confirm(tr('entry.demo.scratchConfirm'))) {
      cancel();
      return;
    }
    busy = true;
    return async ({ result, update }) => {
      if (result.type === 'redirect') {
        window.location.href = result.location;
        return;
      }
      busy = false;
      await update();
    };
  };
</script>

<Banner tone="sky">
  <span data-testid="demo-banner">
    {tr('entry.demo.banner', { time: fmt.instant(expiresAt, 'time') })}
  </span>
  <details class="try">
    <summary>{tr('entry.demo.try')}</summary>
    <ul>
      {#each tryLinks as l (l.href)}
        <li><a href={l.href}>{tr(l.key)}</a></li>
      {/each}
    </ul>
  </details>
  <div class="demo-actions">
    <form method="POST" action="/demo?/reset" use:enhance={fullReload}>
      <button type="submit" class="demo-btn" disabled={busy} data-testid="demo-reset">
        {tr('entry.demo.reset')}
      </button>
    </form>
    <form method="POST" action="/demo?/scratch" use:enhance={fullReload}>
      <button type="submit" class="demo-btn" disabled={busy} data-testid="demo-scratch">
        {tr('entry.demo.scratch')}
      </button>
    </form>
    <form method="POST" action="/demo?/end" use:enhance={fullReload}>
      <button type="submit" class="demo-btn ghost" disabled={busy} data-testid="demo-leave">
        {tr('entry.demo.leave')}
      </button>
    </form>
  </div>
</Banner>

<style>
  .try {
    margin-top: 4px;
  }
  .try summary {
    cursor: pointer;
    font-weight: 600;
    min-height: 48px;
    display: inline-flex;
    align-items: center;
  }
  .try ul {
    margin: 0 0 6px;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
  }
  .try a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    padding: 0 10px;
    border: 1px solid currentColor;
    border-radius: 999px;
    color: inherit;
    text-decoration: none;
  }
  .try a:hover,
  .try a:focus-visible {
    text-decoration: underline;
  }
  .demo-actions {
    margin-top: 4px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .demo-btn {
    min-height: 48px;
    padding: 0 14px;
    border-radius: 8px;
    border: 1px solid #3a586e;
    background: #3a586e;
    color: #fff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .demo-btn.ghost {
    background: transparent;
    color: #3a586e;
  }
  .demo-btn:disabled {
    opacity: 0.6;
    cursor: progress;
  }
</style>
