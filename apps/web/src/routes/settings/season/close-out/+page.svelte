<script lang="ts">
  import { browser } from '$app/environment';
  import { invalidateAll } from '$app/navigation';
  import { ChevronRight, Check, X, Lock } from 'lucide-svelte';
  import type { PageData } from './$types';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import { listPendingForActiveOwner } from '$lib/client/syncQueue';

  let { data }: { data: PageData } = $props();

  // Client-attested offline pending count (Dexie is client-only). Null until
  // the first read resolves; treated as "unknown/blocking" until then.
  let pendingCount = $state<number | null>(null);
  let harvestAttested = $state(false);
  let submitting = $state(false);
  let submitError = $state<string | null>(null);
  let justClosed = $state(false);

  $effect(() => {
    if (!browser) return;
    listPendingForActiveOwner()
      .then((rows) => {
        pendingCount = rows.length;
      })
      .catch(() => {
        pendingCount = 0;
      });
  });

  const pendingOk = $derived(pendingCount === 0);
  const plantingsOk = $derived(data.preflight.plantingsResolved);
  const allGreen = $derived(pendingOk && plantingsOk && harvestAttested);
  const showHandoff = $derived(data.closed || justClosed);

  async function closeSeason() {
    submitError = null;
    submitting = true;
    try {
      const res = await fetch('/api/season/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'close',
          year: data.year,
          pendingCount: pendingCount ?? 0,
          harvestAttested
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        submitError = body.error ? `Close refused: ${body.error}` : `Close failed (${res.status}).`;
        return;
      }
      justClosed = true;
      await invalidateAll();
    } catch {
      submitError = 'Network error while closing the season.';
    } finally {
      submitting = false;
    }
  }

  async function reopenSeason() {
    submitError = null;
    submitting = true;
    try {
      const res = await fetch('/api/season/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'reopen', year: data.year })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        submitError = body.message ?? `Reopen failed (${res.status}).`;
        return;
      }
      justClosed = false;
      await invalidateAll();
    } catch {
      submitError = 'Network error while reopening the season.';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Close season · CropCard</title>
</svelte:head>

<main class="closeout-page">
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <a href="/settings">Settings</a>
    <ChevronRight size={13} aria-hidden="true" />
    <a href="/settings/season">Season</a>
    <ChevronRight size={13} aria-hidden="true" />
    <span>Close-out</span>
  </nav>

  <header class="page-header">
    <Kicker>Settings · Season {data.year}</Kicker>
    <h1 class="serif">Close the {data.year} season.</h1>
    <p class="hint">
      Closing the season locks every {data.year} record. No spray, insecticide, fungicide, harvest, or
      hay-cutting entry dated in {data.year} can be added or changed afterward — the same way a spray
      record locks 48 hours after it's written. You have 7 days to reopen if you close by mistake.
    </p>
  </header>

  {#if !data.isOwner}
    <p class="readonly-banner" role="status">
      <Lock size={14} aria-hidden="true" /> Helper view — only the farm owner can close or reopen a season.
    </p>
  {/if}

  {#if submitError}
    <p class="error" role="alert">{submitError}</p>
  {/if}

  {#if showHandoff}
    <section class="handoff" aria-labelledby="handoff-h">
      <div class="closed-badge">
        <Lock size={16} aria-hidden="true" />
        {data.year} season closed
      </div>
      <h2 id="handoff-h">Season closed. What's next?</h2>
      <p class="hint">
        The {data.year} books are sealed. Records are read-only. Pick up the off-season checklist:
      </p>
      <div class="cta-grid">
        <a class="cta-card" href="/equipment">
          <span class="cta-title">Winterize equipment →</span>
          <span class="cta-sub">Log storage state for sprayers + tools.</span>
        </a>
        <a class="cta-card" href="/records">
          <span class="cta-title">Year-end report →</span>
          <span class="cta-sub">Review + export the {data.year} record book.</span>
        </a>
        <a class="cta-card" href="/settings/season/carry-forward">
          <span class="cta-title">Prep next season →</span>
          <span class="cta-sub"
            >Rotation checks, stock roll-forward + plan draft for {data.year + 1}.</span
          >
        </a>
      </div>

      {#if data.isOwner && data.reopenAvailable}
        <div class="reopen-row">
          <p class="hint">
            Closed in error? You can still reopen the {data.year} season (within 7 days of closing).
          </p>
          <button type="button" class="secondary-btn" disabled={submitting} onclick={reopenSeason}>
            {submitting ? 'Reopening…' : 'Reopen season'}
          </button>
        </div>
      {:else if data.isOwner && data.closed}
        <p class="hint muted">The 7-day reopen window has passed. This close is permanent.</p>
      {/if}
    </section>
  {:else}
    <section class="checklist" aria-labelledby="checklist-h">
      <h2 id="checklist-h">Preflight checklist</h2>

      <div class="check-row" class:ok={pendingOk} class:pending={pendingCount === null}>
        <span class="check-icon">
          {#if pendingOk}<Check size={18} aria-hidden="true" />{:else}<X
              size={18}
              aria-hidden="true"
            />{/if}
        </span>
        <div class="check-body">
          <span class="check-title">Offline queue drained</span>
          <span class="check-sub">
            {#if pendingCount === null}
              Checking your device's pending records…
            {:else if pendingOk}
              No records waiting to sync.
            {:else}
              {pendingCount} record{pendingCount === 1 ? '' : 's'} still pending. Go online + let them
              sync first — <a href="/records/pending">review pending →</a>
            {/if}
          </span>
        </div>
      </div>

      <div class="check-row" class:ok={plantingsOk}>
        <span class="check-icon">
          {#if plantingsOk}<Check size={18} aria-hidden="true" />{:else}<X
              size={18}
              aria-hidden="true"
            />{/if}
        </span>
        <div class="check-body">
          <span class="check-title">Active plantings resolved</span>
          <span class="check-sub">
            {#if plantingsOk}
              Every {data.year} planting is harvested, failed, or archived.
            {:else}
              {data.preflight.unresolvedCount} planting{data.preflight.unresolvedCount === 1
                ? ''
                : 's'} still active or planned. Mark each harvested / failed / archived in
              <a href="/plan">Plan →</a>
            {/if}
          </span>
        </div>
        {#if !plantingsOk}
          <ul class="unresolved-list">
            {#each data.preflight.plantings.filter((p) => !p.resolved) as p (p.cropId)}
              <li>{p.varietyDisplayName} <span class="muted">({p.status})</span></li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="check-row attest" class:ok={harvestAttested}>
        <span class="check-icon">
          {#if harvestAttested}<Check size={18} aria-hidden="true" />{:else}<X
              size={18}
              aria-hidden="true"
            />{/if}
        </span>
        <div class="check-body">
          <span class="check-title">Harvest roll-up reviewed</span>
          <span class="check-sub">
            {data.preflight.harvest.eventCount} harvest event{data.preflight.harvest.eventCount ===
            1
              ? ''
              : 's'} recorded in {data.year}.
          </span>
          <label class="attest-check">
            <input type="checkbox" bind:checked={harvestAttested} disabled={!data.isOwner} />
            I've reviewed the {data.year} harvest totals and confirm they're complete.
          </label>
        </div>
      </div>
    </section>

    <div class="close-row">
      <button
        type="button"
        class="close-btn"
        disabled={!data.isOwner || !allGreen || submitting}
        onclick={closeSeason}
      >
        <Lock size={16} aria-hidden="true" />
        {submitting ? 'Closing…' : `Close ${data.year} season`}
      </button>
      {#if data.isOwner && !allGreen}
        <p class="hint muted">Clear all three checks above to enable close.</p>
      {/if}
    </div>
  {/if}
</main>

<style>
  .closeout-page {
    max-width: 760px;
    margin: 0 auto;
    padding: 1.5rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--color-ink-muted);
  }
  .breadcrumb a {
    color: var(--color-forest);
    text-decoration: none;
  }
  .breadcrumb a:hover {
    text-decoration: underline;
  }
  .page-header {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .page-header h1 {
    margin: 6px 0 0;
    font-family: var(--font-serif, serif);
    font-size: 30px;
    color: var(--color-forest-deep, #143024);
    letter-spacing: -0.02em;
  }
  .hint {
    margin: 0;
    color: #4a5a4a;
    font-size: 0.9rem;
    line-height: 1.45;
  }
  .muted {
    color: #6b7a6b;
  }
  .readonly-banner {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 0.6rem 1rem;
    background: #f3efe4;
    border: 1px solid #cbbf9a;
    border-radius: 6px;
    color: #6b5d2f;
    font-size: 0.9rem;
  }
  .error {
    margin: 0;
    padding: 0.6rem 1rem;
    background: #fbeaea;
    border: 1px solid #b3261e;
    border-radius: 6px;
    color: #b3261e;
    font-size: 0.9rem;
  }
  .checklist {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .checklist h2 {
    margin: 0;
    font-size: 1.1rem;
    color: #1f5e3a;
  }
  .check-row {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.65rem;
    padding: 0.85rem 1rem;
    background: #faf8f1;
    border: 1px solid #e0dac6;
    border-radius: 8px;
  }
  .check-row.ok {
    border-color: #1f5e3a;
    background: #eef6f0;
  }
  .check-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #d8c9c2;
    color: #8a3b34;
  }
  .check-row.ok .check-icon {
    background: #1f5e3a;
    color: #fff;
  }
  .check-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .check-title {
    font-weight: 600;
    color: #22331f;
  }
  .check-sub {
    font-size: 0.85rem;
    color: #4a5a4a;
    line-height: 1.4;
  }
  .check-sub a,
  .check-body a {
    color: #1f5e3a;
  }
  .unresolved-list {
    grid-column: 2;
    margin: 0.25rem 0 0;
    padding-left: 1.1rem;
    font-size: 0.85rem;
    color: #4a5a4a;
  }
  .attest-check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 0.4rem;
    font-size: 0.85rem;
    color: #22331f;
    cursor: pointer;
  }
  .attest-check input {
    width: 20px;
    height: 20px;
    margin-top: 1px;
  }
  .close-row {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    align-self: flex-start;
    min-height: 48px;
    padding: 0.6rem 1.5rem;
    background: #8a3b34;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-weight: 700;
    font-size: 1rem;
    cursor: pointer;
  }
  .close-btn:disabled {
    background: #c3b7b4;
    cursor: not-allowed;
  }
  .secondary-btn {
    min-height: 48px;
    padding: 0.55rem 1.35rem;
    background: transparent;
    color: #1f5e3a;
    border: 1px solid #1f5e3a;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
  }
  .secondary-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .handoff {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 1.25rem;
    background: #eef6f0;
    border: 1px solid #1f5e3a;
    border-radius: 10px;
  }
  .closed-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    align-self: flex-start;
    padding: 0.3rem 0.7rem;
    background: #1f5e3a;
    color: #fff;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .handoff h2 {
    margin: 0;
    font-family: var(--font-serif, serif);
    font-size: 1.4rem;
    color: #143024;
  }
  .cta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.75rem;
  }
  .cta-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0.85rem 1rem;
    background: #fff;
    border: 1px solid #cfe0d4;
    border-radius: 8px;
    text-decoration: none;
    min-height: 48px;
  }
  .cta-card:hover {
    border-color: #1f5e3a;
  }
  .cta-title {
    font-weight: 700;
    color: #1f5e3a;
  }
  .cta-sub {
    font-size: 0.82rem;
    color: #4a5a4a;
  }
  .reopen-row {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px dashed #b7ccbc;
  }
</style>
