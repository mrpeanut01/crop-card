<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import type { SubmitFunction } from '$app/forms';
  import { createT, type MessageKey } from '$lib/i18n';
  import { fmt } from '$lib/prefsState.svelte';
  import Banner from '$lib/components/ui/Banner.svelte';

  import {
    DEMO_PHASES,
    DEMO_STEPS,
    MAX_DEMO_OFFSET_MS,
    currentPhase,
    nextPhaseStart,
    type DemoFarmKind
  } from '$lib/demo/fastForward';
  import { DAY_MS, ymdOf } from '$lib/demo/time';

  const {
    demo
  }: {
    demo: { expiresAt: number; kind: DemoFarmKind | null; offsetMs: number; today: number };
  } = $props();
  const tr = $derived(createT(page.data?.locale));

  let busy = $state(false);
  let error = $state<string | null>(null);

  const daysAhead = $derived(Math.round(demo.offsetMs / DAY_MS));
  const roomMs = $derived(MAX_DEMO_OFFSET_MS - demo.offsetMs);
  const phases = $derived(
    demo.kind === 'sample'
      ? DEMO_PHASES.filter((p) => p.id !== currentPhase(demo.today))
          .map((p) => ({
            id: p.id,
            at: nextPhaseStart(p.id, demo.today)
          }))
          .filter((p) => p.at - demo.today <= roomMs)
          .sort((a, b) => a.at - b.at)
      : []
  );
  const steps = $derived(DEMO_STEPS.filter((s) => s.days * DAY_MS <= roomMs));

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
    if (
      action.search.includes('forward') &&
      demo.kind === 'sample' &&
      !confirm(tr('entry.demo.ff.confirmSample'))
    ) {
      cancel();
      return;
    }
    error = null;
    busy = true;
    return async ({ result, update }) => {
      if (result.type === 'redirect') {
        window.location.href = result.location;
        return;
      }
      busy = false;
      if (result.type === 'failure') {
        const msg = (result.data as { demoError?: unknown } | undefined)?.demoError;
        error = typeof msg === 'string' ? msg : tr('entry.demo.ff.errTooFar');
        return;
      }
      await update();
    };
  };
</script>

<Banner tone="sky">
  <span data-testid="demo-banner">
    {tr('entry.demo.banner', { time: fmt.instant(demo.expiresAt, 'time') })}
  </span>
  {#if daysAhead > 0}
    <p class="ff-today" data-testid="demo-date">
      {tr('entry.demo.ff.today', { date: fmt.day(ymdOf(demo.today), 'date-long') })}
    </p>
  {/if}
  <details class="try">
    <summary>{tr('entry.demo.try')}</summary>
    <ul>
      {#each tryLinks as l (l.href)}
        <li><a href={l.href}>{tr(l.key)}</a></li>
      {/each}
    </ul>
  </details>
  {#if demo.kind && (steps.length || phases.length)}
    <details class="try ff" data-testid="demo-ff">
      <summary>{tr('entry.demo.ff.title')}</summary>
      <p class="ff-note">
        {demo.kind === 'sample' ? tr('entry.demo.ff.noteSample') : tr('entry.demo.ff.noteScratch')}
      </p>
      <form method="POST" action="/demo?/forward" use:enhance={fullReload} class="ff-row">
        {#each steps as s (s.id)}
          <button
            type="submit"
            name="to"
            value={`step:${s.id}`}
            class="ff-btn"
            disabled={busy}
            data-testid={`demo-ff-${s.id}`}
          >
            {tr(`entry.demo.ff.step.${s.id}` as MessageKey)}
          </button>
        {/each}
      </form>
      {#if phases.length}
        <p class="ff-sub">{tr('entry.demo.ff.jump')}</p>
        <form method="POST" action="/demo?/forward" use:enhance={fullReload} class="ff-row">
          {#each phases as p (p.id)}
            <button
              type="submit"
              name="to"
              value={`phase:${p.id}`}
              class="ff-btn"
              disabled={busy}
              data-testid={`demo-ff-phase-${p.id}`}
            >
              <span>{tr(`entry.demo.ff.phase.${p.id}` as MessageKey)}</span>
              <span class="ff-when">{fmt.day(ymdOf(p.at), 'month-day')}</span>
            </button>
          {/each}
        </form>
      {/if}
    </details>
  {/if}
  {#if error}
    <p class="ff-error" role="alert">{error}</p>
  {/if}
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
  .ff-today {
    margin: 4px 0 0;
    font-weight: 600;
  }
  .ff-note,
  .ff-sub {
    margin: 0 0 6px;
  }
  .ff-sub {
    font-weight: 600;
  }
  .ff-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 8px;
    margin: 0 0 8px;
  }
  .ff-btn {
    min-height: 48px;
    padding: 4px 12px;
    border-radius: 999px;
    border: 1px solid currentColor;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    line-height: 1.2;
  }
  .ff-when {
    font-size: 0.85em;
    opacity: 0.85;
  }
  .ff-btn:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .ff-error {
    margin: 4px 0 0;
    font-weight: 600;
  }
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
