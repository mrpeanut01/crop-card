<script lang="ts">
  import { cropDisplayName } from '$lib/i18n/cropName';
  import { fmt } from '$lib/prefsState.svelte';
  import { browser } from '$app/env';
  import { invalidateAll } from '$app/navigation';
  import { ChevronRight, Check, X, Lock } from 'lucide-svelte';
  import type { PageData } from './$types';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import { listPendingForActiveOwner } from '$lib/client/syncQueue';
  import { createT, type MessageKey } from '$lib/i18n';

  let { data }: { data: PageData } = $props();

  const tr = $derived(createT(data.locale));
  const PLANTING_STATUSES = ['planned', 'active', 'harvested', 'failed', 'archived'];
  const statusLabel = (status: string) =>
    PLANTING_STATUSES.includes(status) ? tr(`crops.status.${status}` as MessageKey) : status;

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

  type BulkStatus = 'harvested' | 'failed' | 'archived';
  const unresolved = $derived(data.preflight.plantings.filter((p) => !p.resolved));
  let selected = $state<string[]>([]);
  let bulkStatus = $state<BulkStatus>('harvested');
  let confirming = $state(false);
  let bulkSaving = $state(false);
  let bulkMessage = $state<string | null>(null);
  const openIds = $derived(new Set(unresolved.map((p) => p.cropId)));
  const chosen = $derived(selected.filter((id) => openIds.has(id)));
  const allSelected = $derived(unresolved.length > 0 && chosen.length === unresolved.length);

  function toggleAll(on: boolean) {
    selected = on ? unresolved.map((p) => p.cropId) : [];
    confirming = false;
  }

  function toggleOne(id: string, on: boolean) {
    selected = on ? [...selected.filter((x) => x !== id), id] : selected.filter((x) => x !== id);
    confirming = false;
  }

  async function bulkResolve() {
    submitError = null;
    bulkMessage = null;
    bulkSaving = true;
    try {
      const res = await fetch('/api/season/resolve-plantings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ year: data.year, status: bulkStatus, cropIds: chosen })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        submitError =
          typeof body.message === 'string'
            ? body.message
            : tr('settings.close.bulkFailedMsg', { status: res.status });
        return;
      }
      const body = (await res.json()) as { resolved: number };
      bulkMessage = tr('settings.close.bulkDone', { count: body.resolved });
      selected = [];
      confirming = false;
      await invalidateAll();
    } catch {
      submitError = tr('settings.close.bulkNetwork');
    } finally {
      bulkSaving = false;
    }
  }

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
        submitError = body.error
          ? tr('settings.close.refused', { error: body.error })
          : tr('settings.close.failed', { status: res.status });
        return;
      }
      justClosed = true;
      await invalidateAll();
    } catch {
      submitError = tr('settings.close.networkClose');
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
        submitError =
          body.error === 'REOPEN_WINDOW_EXPIRED'
            ? tr('settings.close.permanent')
            : tr('settings.close.reopenFailed', { status: res.status });
        return;
      }
      justClosed = false;
      await invalidateAll();
    } catch {
      submitError = tr('settings.close.networkReopen');
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>{tr('settings.close.pageTitle')}</title>
</svelte:head>

<div class="closeout-page">
  <nav class="breadcrumb" aria-label={tr('settings.tokens.breadcrumbAria')}>
    <a href="/settings">{tr('settings.tokens.crumbSettings')}</a>
    <ChevronRight size={13} aria-hidden="true" />
    <a href="/settings/season">{tr('settings.carry.crumbSeason')}</a>
    <ChevronRight size={13} aria-hidden="true" />
    <span>{tr('settings.close.crumb')}</span>
  </nav>

  <header class="page-header">
    <Kicker>{tr('settings.close.kicker', { year: data.year })}</Kicker>
    <h1 class="serif">{tr('settings.close.h1', { year: data.year })}</h1>
    <p class="hint">
      {tr('settings.close.hint', { year: data.year })}
    </p>
  </header>

  {#if !data.isOwner}
    <p class="readonly-banner" role="status">
      <Lock size={14} aria-hidden="true" />
      {tr('settings.close.helperBanner')}
    </p>
  {/if}

  {#if submitError}
    <p class="error" role="alert">{submitError}</p>
  {/if}

  {#if showHandoff}
    <section class="handoff" aria-labelledby="handoff-h">
      <div class="closed-badge">
        <Lock size={16} aria-hidden="true" />
        {tr('settings.close.closedBadge', { year: data.year })}
      </div>
      <h2 id="handoff-h">{tr('settings.close.nextTitle')}</h2>
      <p class="hint">
        {tr('settings.close.nextHint', { year: data.year })}
      </p>
      <div class="cta-grid">
        <a class="cta-card" href="/equipment">
          <span class="cta-title">{tr('settings.close.winterize')}</span>
          <span class="cta-sub">{tr('settings.close.winterizeSub')}</span>
        </a>
        <a class="cta-card" href="/records">
          <span class="cta-title">{tr('settings.close.yearEnd')}</span>
          <span class="cta-sub">{tr('settings.close.yearEndSub', { year: data.year })}</span>
        </a>
        <a class="cta-card" href="/settings/season/carry-forward">
          <span class="cta-title">{tr('settings.close.prep')}</span>
          <span class="cta-sub">{tr('settings.close.prepSub', { year: data.year + 1 })}</span>
        </a>
      </div>

      {#if data.isOwner && data.reopenAvailable}
        <div class="reopen-row">
          <p class="hint">
            {tr('settings.close.reopenHint', { year: data.year })}
          </p>
          <button type="button" class="secondary-btn" disabled={submitting} onclick={reopenSeason}>
            {submitting ? tr('settings.close.reopening') : tr('settings.close.reopen')}
          </button>
        </div>
      {:else if data.isOwner && data.closed}
        <p class="hint muted">{tr('settings.close.permanent')}</p>
      {/if}
    </section>
  {:else}
    <section class="checklist" aria-labelledby="checklist-h">
      <h2 id="checklist-h">{tr('settings.close.checklist')}</h2>

      <div class="check-row" class:ok={pendingOk} class:pending={pendingCount === null}>
        <span class="check-icon">
          {#if pendingOk}<Check size={18} aria-hidden="true" />{:else}<X
              size={18}
              aria-hidden="true"
            />{/if}
        </span>
        <div class="check-body">
          <span class="check-title">{tr('settings.close.queueTitle')}</span>
          <span class="check-sub">
            {#if pendingCount === null}
              {tr('settings.close.checking')}
            {:else if pendingOk}
              {tr('settings.close.noneWaiting')}
            {:else}
              {tr('settings.close.pending', { count: pendingCount })}
              <a href="/records/pending">{tr('settings.close.reviewPending')}</a>
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
          <span class="check-title">{tr('settings.close.plantingsTitle')}</span>
          <span class="check-sub">
            {#if plantingsOk}
              {tr('settings.close.plantingsOk', { year: data.year })}
            {:else}
              {tr('settings.close.unresolved', { count: data.preflight.unresolvedCount })}
              <a href="/plan">{tr('settings.close.planLink')}</a>
            {/if}
          </span>
        </div>
        {#if !plantingsOk}
          <div class="unresolved">
            {#if data.isOwner}
              <label class="bulk-all">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onchange={(e) => toggleAll(e.currentTarget.checked)}
                />
                {tr('settings.close.bulkSelectAll', { count: unresolved.length })}
              </label>
            {/if}
            <ul class="unresolved-list" class:selectable={data.isOwner}>
              {#each unresolved as p (p.cropId)}
                {@const name = cropDisplayName(p.cropPluginId, p.varietyDisplayName, data.locale)}
                {@const block = p.blockName ?? tr('settings.close.noBlock')}
                {@const date =
                  p.plantingDate === null ? tr('settings.close.noDate') : fmt.day(p.plantingDate)}
                <li>
                  {#if data.isOwner}
                    <label class="planting-row">
                      <input
                        type="checkbox"
                        checked={chosen.includes(p.cropId)}
                        onchange={(e) => toggleOne(p.cropId, e.currentTarget.checked)}
                        aria-label={tr('settings.close.plantingRowAria', { name, block, date })}
                      />
                      <span class="planting-name">{name}</span>
                      <span class="muted">{block} · {date} · {statusLabel(p.status)}</span>
                    </label>
                  {:else}
                    <span class="planting-name">{name}</span>
                    <span class="muted">{block} · {date} · {statusLabel(p.status)}</span>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if data.isOwner}
              <div class="bulk-bar" aria-label={tr('settings.close.bulkTitle')} role="group">
                <label class="bulk-status">
                  {tr('settings.close.bulkMarkAs')}
                  <select
                    bind:value={bulkStatus}
                    onchange={() => (confirming = false)}
                    disabled={bulkSaving}
                  >
                    <option value="harvested">{tr('settings.close.bulkHarvested')}</option>
                    <option value="failed">{tr('settings.close.bulkFailed')}</option>
                    <option value="archived">{tr('settings.close.bulkArchived')}</option>
                  </select>
                </label>
                {#if confirming}
                  <p class="hint" role="status">
                    {tr('settings.close.bulkConfirm', {
                      count: chosen.length,
                      status: statusLabel(bulkStatus)
                    })}
                  </p>
                  <div class="bulk-actions">
                    <button
                      type="button"
                      class="secondary-btn solid"
                      disabled={bulkSaving || chosen.length === 0}
                      onclick={bulkResolve}
                    >
                      {bulkSaving
                        ? tr('settings.close.bulkSaving')
                        : tr('settings.close.bulkConfirmBtn')}
                    </button>
                    <button
                      type="button"
                      class="secondary-btn"
                      disabled={bulkSaving}
                      onclick={() => (confirming = false)}
                    >
                      {tr('settings.close.bulkCancel')}
                    </button>
                  </div>
                {:else}
                  <button
                    type="button"
                    class="secondary-btn"
                    disabled={chosen.length === 0}
                    onclick={() => (confirming = true)}
                  >
                    {tr('settings.close.bulkApply', { count: chosen.length })}
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
        {#if bulkMessage}
          <p class="hint bulk-done" role="status">{bulkMessage}</p>
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
          <span class="check-title">{tr('settings.close.harvestTitle')}</span>
          <span class="check-sub">
            {tr('settings.close.harvestEvents', {
              count: data.preflight.harvest.eventCount,
              year: data.year
            })}
          </span>
          <label class="attest-check">
            <input type="checkbox" bind:checked={harvestAttested} disabled={!data.isOwner} />
            {tr('settings.close.attest', { year: data.year })}
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
        {submitting
          ? tr('settings.close.closing')
          : tr('settings.close.closeBtn', { year: data.year })}
      </button>
      {#if data.isOwner && !allGreen}
        <p class="hint muted">{tr('settings.close.clearAll')}</p>
      {/if}
    </div>
  {/if}
</div>

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
  .unresolved,
  .bulk-done {
    grid-column: 1 / -1;
  }
  .unresolved {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .unresolved-list {
    margin: 0.25rem 0 0;
    padding-left: 1.1rem;
    font-size: 0.85rem;
    color: #4a5a4a;
    max-height: 26rem;
    overflow-y: auto;
  }
  .unresolved-list.selectable {
    list-style: none;
    padding-left: 0;
  }
  .unresolved-list li {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.5rem;
  }
  .planting-row,
  .bulk-all {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 0.5rem;
    min-height: 48px;
    cursor: pointer;
  }
  .bulk-all {
    font-size: 0.85rem;
    font-weight: 600;
    color: #22331f;
  }
  .planting-row input,
  .bulk-all input {
    width: 22px;
    height: 22px;
  }
  .planting-name {
    font-weight: 600;
    color: #22331f;
  }
  .bulk-bar {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px dashed #d8cfb4;
  }
  .bulk-status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: #22331f;
  }
  .bulk-status select {
    min-height: 48px;
  }
  .bulk-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .secondary-btn.solid {
    background: #1f5e3a;
    color: #fff;
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
