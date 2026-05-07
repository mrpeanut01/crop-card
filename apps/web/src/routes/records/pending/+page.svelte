<script lang="ts">
  import { onMount } from 'svelte';
  import type { PendingSprayRecord } from '$lib/client/dexie';

  let pending = $state<PendingSprayRecord[]>([]);
  let busy = $state(false);
  let lastDrainResult = $state<string | null>(null);
  let dexieAvailable = $state(true);

  async function refresh() {
    try {
      const { listPending } = await import('$lib/client/syncQueue');
      pending = await listPending();
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
      lastDrainResult = `Synced ${result.succeeded.length}; ${result.failed.length} still pending.`;
      await refresh();
    } catch (e) {
      lastDrainResult = `error: ${e instanceof Error ? e.message : e}`;
    } finally {
      busy = false;
    }
  }

  async function discard(id: string) {
    if (!confirm('Discard this queued record? This cannot be undone.')) return;
    const { db } = await import('$lib/client/dexie');
    await db().pendingSprayRecords.delete(id);
    await refresh();
  }

  onMount(() => {
    refresh();
  });
</script>

<h1>Pending sync queue</h1>
<p class="lede">
  Spray records confirmed offline (or that hit a transient network error) are stored in IndexedDB.
  They submit to <code>/api/spray/record</code> when the app reconnects — the server still re-runs the
  kernel on each one. Records the kernel rejects stay flagged for owner review.
</p>

{#if !dexieAvailable}
  <p class="warn">IndexedDB unavailable in this context. Open the app in a real browser tab.</p>
{:else}
  <div class="actions">
    <button class="primary" onclick={drainNow} disabled={busy || pending.length === 0}>
      {busy ? 'Syncing…' : `Sync now (${pending.length})`}
    </button>
    <a href="/records">All records →</a>
  </div>
  {#if lastDrainResult}<p class="result">{lastDrainResult}</p>{/if}
  {#if pending.length === 0}
    <p class="empty">Queue is empty.</p>
  {:else}
    <ul class="pending">
      {#each pending as p (p.id)}
        <li>
          <header>
            <strong>{new Date(p.occurredAt).toLocaleString()}</strong>
            <span class="meta">queued {new Date(p.createdAt).toLocaleTimeString()}</span>
            <span class="attempts">{p.attempts} attempt{p.attempts === 1 ? '' : 's'}</span>
            <button class="discard" onclick={() => discard(p.id)}>Discard</button>
          </header>
          {#if p.lastError}
            <p class="err">{p.lastError}</p>
          {/if}
          <details>
            <summary>Payload</summary>
            <pre>{JSON.stringify(p.payload, null, 2)}</pre>
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
  code {
    background: #f5f5f5;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.85rem;
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
  .discard {
    margin-left: auto;
    background: #fce8e8;
    color: #b00020;
    border: none;
    border-radius: 4px;
    padding: 0.4rem 0.75rem;
    cursor: pointer;
    font-weight: 600;
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
  pre {
    background: #f5f5f5;
    padding: 0.5rem;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.8rem;
  }
</style>
