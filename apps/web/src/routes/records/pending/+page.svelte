<script lang="ts">
  import { onMount } from 'svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import type { PendingSprayRecord } from '$lib/client/dexie';
  import type { DrainHalt } from '$lib/client/syncQueue';
  import { fmt } from '$lib/prefsState.svelte';
  import {
    queueKindLabel,
    recoveryLabel,
    deleteConfirmText,
    lineageKeys,
    payloadSubjectKeys,
    pendingSummary,
    recoveryFor,
    type RecoveryAction
  } from '$lib/animals/queueRecovery';
  import { localInputToMs, msToLocalInput } from '$lib/animals/display';
  import type { FarmSnapshot } from '$lib/cards/snapshot';

  const tr = $derived(createT(page.data?.locale));
  let pending = $state<PendingSprayRecord[]>([]);
  let otherOwnerCount = $state(0);
  let busy = $state(false);
  let lastDrainResult = $state<string | null>(null);
  let dexieAvailable = $state(true);
  let snapshot = $state<FarmSnapshot | null>(null);
  let redating = $state<string | null>(null);
  let redateValue = $state(msToLocalInput(Date.now()));
  const rejectedCount = $derived(pending.filter((p) => p.status === 'rejected').length);
  /** D1-09: rows held back behind a refused row for the same animal or flock. */
  const waiting = $derived.by(() => {
    const blocked = new Set<string>();
    const out = new Set<string>();
    for (const p of pending) {
      const subjectKeys = payloadSubjectKeys(p.kind, p.payload);
      if (subjectKeys.length === 0) continue;
      const keys = [...lineageKeys(subjectKeys, snapshot)];
      if (p.status === 'rejected') {
        for (const k of keys) blocked.add(k);
      } else if (keys.some((k) => blocked.has(k))) {
        out.add(p.id);
        for (const k of keys) blocked.add(k);
      }
    }
    return out;
  });
  const retryableCount = $derived(pending.length - rejectedCount);

  const HALT_MESSAGES = $derived<Record<DrainHalt, string>>({
    offline: tr('records.pending.halt.offline'),
    'no-active-owner': tr('records.pending.halt.noOwner'),
    'owner-unverified': tr('records.pending.halt.unverified'),
    'owner-mismatch': tr('records.pending.halt.mismatch')
  });

  async function refresh() {
    try {
      const { listPendingForActiveOwner, pendingCountForOtherOwners } =
        await import('$lib/client/syncQueue');
      pending = await listPendingForActiveOwner();
      otherOwnerCount = await pendingCountForOtherOwners();
      try {
        const { loadSnapshot } = await import('$lib/client/cardStore');
        snapshot = (await loadSnapshot())?.bundle ?? null;
      } catch {
        snapshot = null;
      }
    } catch {
      dexieAvailable = false;
    }
  }

  async function drainNow() {
    busy = true;
    lastDrainResult = null;
    try {
      const { drainQueue } = await import('$lib/client/syncQueue');
      const result = await drainQueue();
      // #315 — surface skippedOtherOwner so the operator understands why a
      // drain that "succeeded 0" still left records behind: they belong to
      // another farm and only drain when that Owner is active.
      const parts = [
        tr('records.pending.synced', { ok: result.succeeded.length, failed: result.failed.length })
      ];
      if (result.rejected.length > 0) {
        parts.push(tr('records.pending.rejectedReview', { n: result.rejected.length }));
      }
      if (result.heldBehindRejected.length > 0) {
        parts.push(tr('records.pending.heldBehind', { n: result.heldBehindRejected.length }));
      }
      if (result.skippedOtherOwner > 0) {
        parts.push(tr('records.pending.skipped', { n: result.skippedOtherOwner }));
      }
      lastDrainResult = result.halted ? HALT_MESSAGES[result.halted] : `${parts.join('; ')}.`;
      await refresh();
    } catch (e) {
      lastDrainResult = tr('records.pending.error', {
        msg: e instanceof Error ? e.message : String(e)
      });
    } finally {
      busy = false;
    }
  }

  async function discard(p: PendingSprayRecord) {
    if (!confirm(deleteConfirmText(p.kind, p.payload, page.data?.locale))) return;
    const { discardPendingForActiveOwner } = await import('$lib/client/syncQueue');
    await discardPendingForActiveOwner(p.id);
    await refresh();
  }

  async function recover(p: PendingSprayRecord, action: RecoveryAction) {
    if (action === 'redate' && redating !== p.id) {
      redating = p.id;
      redateValue = msToLocalInput(Date.now());
      return;
    }
    let at: number | undefined;
    if (action === 'redate') {
      const ms = localInputToMs(redateValue);
      if (ms === null) {
        lastDrainResult = tr('records.pending.errDate');
        return;
      }
      at = ms;
    }
    const { recoverRejectedForActiveOwner } = await import('$lib/client/syncQueue');
    const ok = await recoverRejectedForActiveOwner(p.id, action, { at });
    redating = null;
    if (!ok) {
      lastDrainResult = tr('records.pending.errChanged');
      await refresh();
      return;
    }
    if (action === 'keep-here') {
      lastDrainResult = tr('records.pending.moveDropped');
      await refresh();
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      lastDrainResult = tr('records.pending.savedPhone');
      await refresh();
      return;
    }
    await drainNow();
  }

  async function retry(id: string) {
    const { retryRejectedForActiveOwner } = await import('$lib/client/syncQueue');
    await retryRejectedForActiveOwner(id);
    await refresh();
  }

  onMount(() => {
    refresh();
  });

  function hidePhotoData(_key: string, value: unknown): unknown {
    return typeof value === 'string' && value.startsWith('data:image/')
      ? `[photo, ${Math.round((value.length * 0.75) / 1024)} KB]`
      : value;
  }
</script>

<h1>{tr('records.pending.title')}</h1>
<p class="lede">
  {tr('records.pending.lede')}
</p>

{#if !dexieAvailable}
  <p class="warn">{tr('records.pending.noIdb')}</p>
{:else}
  <div class="actions">
    <button class="primary" onclick={drainNow} disabled={busy || retryableCount === 0}>
      {busy ? tr('records.pending.syncing') : tr('records.pending.syncNow', { n: retryableCount })}
    </button>
    <a href="/records">{tr('records.pending.allRecords')}</a>
  </div>
  <!-- #242 — persistent aria-live region so screen readers announce the drain
       outcome even when the message body changes between drains. Must stay
       mounted (no {#if}) for assistive tech to pick up updates. -->
  <p class="result" role="status" aria-live="polite">{lastDrainResult ?? ''}</p>
  {#if otherOwnerCount > 0}
    <p class="other-owner-badge">
      {tr('records.pending.otherFarm', { count: otherOwnerCount })}
    </p>
  {/if}
  {#if rejectedCount > 0}
    <p class="rejected-note">
      {tr('records.pending.refused', { count: rejectedCount })}
    </p>
  {/if}
  {#if pending.length === 0}
    <p class="empty">{tr('records.pending.empty')}</p>
  {:else}
    <ul class="pending">
      {#each pending as p (p.id)}
        <li class:rejected={p.status === 'rejected'}>
          <header>
            <strong>{fmt.instant(p.occurredAt)}</strong>
            <span class="meta"
              >{tr('records.pending.queuedAt', { time: fmt.instant(p.createdAt, 'time') })}</span
            >
            <span class="attempts">{tr('records.pending.attempts', { count: p.attempts })}</span>
            {#if p.status === 'rejected'}
              <span class="rejected-pill"
                >{tr('records.pending.rejected')}{p.lastStatus ? ` (${p.lastStatus})` : ''}</span
              >
              {#if p.holdMarker}<span class="rejected-pill">{p.holdMarker}</span>{/if}
            {/if}
            <span class="row-actions">
              {#if p.status === 'rejected' && recoveryFor(p).actions.includes('retry')}
                <button class="retry" onclick={() => retry(p.id)}
                  >{tr('records.pending.retry')}</button
                >
              {/if}
              <details class="more">
                <summary aria-label={tr('records.pending.moreActions')}
                  >{tr('records.pending.more')}</summary
                >
                <button class="discard" onclick={() => discard(p)}
                  >{tr('records.pending.delete')}</button
                >
              </details>
            </span>
          </header>
          <p class="what">
            <strong
              >{queueKindLabel(p.kind ?? 'herbicide', page.data?.locale) ??
                tr('records.pending.record')}</strong
            >{#if pendingSummary(p.kind, p.payload, page.data?.locale)}
              · {pendingSummary(p.kind, p.payload, page.data?.locale)}{/if}
          </p>
          {#if waiting.has(p.id)}
            <p class="waiting">{tr('recui.pending.waiting')}</p>
          {/if}
          {#if p.status === 'rejected' && p.rejectInfo?.error}
            <p class="err">{p.rejectInfo.error}</p>
          {:else if p.lastError}
            <p class="err">{p.lastError}</p>
          {/if}
          {#if p.status === 'rejected'}
            {@const rec = recoveryFor(p)}
            {#if rec.askOwner}
              <p class="ask">{tr('recui.pending.askOwner')}</p>
            {/if}
            {#if rec.actions.some((a) => a !== 'retry')}
              <div class="recover" data-testid="recovery-actions">
                {#each rec.actions.filter((a) => a !== 'retry') as a (a)}
                  <button
                    class={a === rec.primary ? 'primary wide' : 'secondary wide'}
                    onclick={() => recover(p, a)}>{recoveryLabel(a, page.data?.locale)}</button
                  >
                {/each}
                {#if redating === p.id}
                  <label class="redate">
                    {tr('records.pending.newDate')}
                    <input type="datetime-local" bind:value={redateValue} />
                  </label>
                  <button class="primary wide" onclick={() => recover(p, 'redate')}>
                    {tr('records.pending.saveDate')}
                  </button>
                {/if}
              </div>
            {/if}
          {/if}
          <details>
            <summary>{tr('records.pending.payload')}</summary>
            <pre>{JSON.stringify(p.payload, hidePhotoData, 2)}</pre>
          </details>
        </li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  h1 {
    margin: 0 0 0.25rem;
  }
  .lede {
    color: #555;
    margin: 0 0 1rem;
  }
  .actions {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    margin-bottom: 1rem;
  }
  .actions a {
    color: #1f5e3a;
    text-decoration: none;
    font-weight: 600;
  }
  .primary {
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.75rem 1.25rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  .primary:disabled {
    background: #999;
    cursor: not-allowed;
  }
  .result {
    color: #1f5e3a;
    font-weight: 600;
  }
  .empty {
    color: #555;
    font-style: italic;
  }
  .other-owner-badge {
    background: #fff4d6;
    border: 1px solid #e6c97a;
    color: #6b4d00;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    font-size: 0.85rem;
    margin: 0.5rem 0 1rem;
  }
  .warn {
    color: #b00020;
  }
  .pending {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .pending li {
    background: white;
    padding: 0.75rem 1rem;
    margin: 0.5rem 0;
    border-radius: 8px;
    border-left: 4px solid #b35900;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .pending header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .meta {
    color: #777;
    font-size: 0.85rem;
  }
  .attempts {
    background: #f5f5f5;
    padding: 0.05rem 0.5rem;
    border-radius: 3px;
    font-size: 0.8rem;
  }
  .pending li.rejected {
    border-left-color: #b00020;
  }
  .rejected-note {
    background: #fce8e8;
    border: 1px solid #e8a3a3;
    color: #7a0016;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    font-size: 0.85rem;
    margin: 0.5rem 0 1rem;
  }
  .rejected-pill {
    background: #b00020;
    color: white;
    padding: 0.05rem 0.5rem;
    border-radius: 3px;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .row-actions {
    margin-left: auto;
    display: flex;
    gap: 0.5rem;
  }
  .retry {
    background: #e6f2ea;
    color: #1f5e3a;
    border: none;
    border-radius: 4px;
    padding: 0.4rem 0.75rem;
    cursor: pointer;
    font-weight: 600;
    min-height: 48px;
  }
  .discard {
    background: #fce8e8;
    color: #b00020;
    border: none;
    border-radius: 4px;
    padding: 0.4rem 0.75rem;
    cursor: pointer;
    font-weight: 600;
    min-height: 48px;
  }
  .err {
    color: #b00020;
    background: #fce8e8;
    padding: 0.4rem 0.6rem;
    border-radius: 4px;
    margin: 0.4rem 0;
    font-size: 0.85rem;
  }
  details {
    margin-top: 0.4rem;
  }
  .what {
    margin: 0.4rem 0 0;
  }
  .waiting,
  .ask {
    margin: 0.4rem 0;
    padding: 0.4rem 0.6rem;
    border-radius: 4px;
    background: #fff4d6;
    color: #6b4d00;
    font-size: 0.9rem;
  }
  .recover {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0.5rem 0;
  }
  .wide {
    width: 100%;
    min-height: 48px;
  }
  .secondary {
    background: white;
    color: #1f5e3a;
    border: 1px solid #1f5e3a;
    border-radius: 6px;
    padding: 0.75rem 1.25rem;
    font-weight: 600;
    cursor: pointer;
  }
  .redate {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-weight: 600;
  }
  .redate input {
    min-height: 48px;
    font-size: 16px;
  }
  .more {
    margin: 0;
    position: relative;
  }
  .more summary {
    min-height: 48px;
    min-width: 48px;
    display: inline-flex;
    align-items: center;
    padding: 0 0.75rem;
    cursor: pointer;
    font-weight: 600;
    border: 1px solid #ccc;
    border-radius: 4px;
    list-style: none;
  }
  .more[open] .discard {
    margin-top: 0.4rem;
  }
  pre {
    background: #f5f5f5;
    padding: 0.5rem;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.8rem;
  }
</style>
