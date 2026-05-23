<script lang="ts">
  let { data, form } = $props();

  function fmtDate(ms: number) {
    return new Date(ms).toLocaleString();
  }

  function scanFlagCount(scan: unknown, key: string): number {
    if (!scan || typeof scan !== 'object') return 0;
    const arr = (scan as Record<string, unknown>)[key];
    return Array.isArray(arr) ? arr.length : 0;
  }
</script>

<h1>Review queue <a href="/admin" class="back">← admin</a></h1>

{#if form?.error}<p class="warn">{form.error}</p>{/if}
{#if form?.approved}<p class="muted">Approved {form.approved}.</p>{/if}
{#if form?.rejected}<p class="muted">Rejected {form.rejected}.</p>{/if}

{#if data.pending.length === 0}
  <p class="muted">No versions pending review. 🎉</p>
{/if}

{#each data.pending as row (row.id)}
  <article>
    <header>
      <h2>
        {row.displayName ?? row.pluginId} <span class="version">v{row.version}</span>
      </h2>
      <p class="meta">
        Type: <strong>{row.type ?? '—'}</strong> · Plugin ID: <code>{row.pluginId}</code>
        · Hash: <code>{row.hash.slice(0, 12)}…</code>
      </p>
      <p class="meta">
        Uploaded: {fmtDate(row.uploadedAt)} by
        <code>{row.uploadedByLabel ?? row.uploadedByCredentialId}</code>
        (trust: <strong>{row.uploadedByTrustLevel ?? '—'}</strong>)
      </p>
      {#if row.currentApprovedVersion}
        <p class="meta">
          Current approved: v{row.currentApprovedVersion} (hash
          <code>{row.currentApprovedHash?.slice(0, 12)}…</code>)
        </p>
      {:else}
        <p class="meta">First version of this plugin.</p>
      {/if}
    </header>

    <details>
      <summary>
        Scan flags · prompt-injection {scanFlagCount(row.scanResults, 'promptInjection')}
        · structural {scanFlagCount(row.scanResults, 'structural')} · injection
        {scanFlagCount(row.scanResults, 'injection')}
      </summary>
      <pre>{JSON.stringify(row.scanResults, null, 2)}</pre>
    </details>

    <details>
      <summary>Payload preview</summary>
      <pre>{JSON.stringify(row.payload, null, 2).slice(0, 4000)}</pre>
    </details>

    <div class="actions">
      <form method="post" action="?/approve">
        <input type="hidden" name="versionId" value={row.id} />
        <input type="text" name="notes" placeholder="approve note (optional)" />
        <button type="submit">Approve</button>
      </form>
      <form method="post" action="?/reject">
        <input type="hidden" name="versionId" value={row.id} />
        <input type="text" name="notes" placeholder="reject note (required)" required />
        <button type="submit" class="danger">Reject</button>
      </form>
    </div>
  </article>
{/each}

<style>
  .back {
    font-size: 0.85rem;
    color: #555;
    margin-left: 1rem;
  }
  .muted {
    color: #555;
  }
  .warn {
    color: #b00020;
  }
  article {
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 1rem;
    margin: 1rem 0;
  }
  .version {
    color: #888;
    font-size: 0.9rem;
  }
  .meta {
    font-size: 0.85rem;
    color: #555;
    margin: 0.25rem 0;
  }
  details {
    margin: 0.5rem 0;
  }
  pre {
    background: #f8f8f6;
    padding: 0.75rem;
    border-radius: 4px;
    font-size: 0.8rem;
    overflow-x: auto;
    max-height: 24rem;
  }
  .actions {
    display: flex;
    gap: 1rem;
    margin-top: 1rem;
  }
  .actions form {
    display: flex;
    gap: 0.5rem;
    flex: 1;
  }
  .actions input[type='text'] {
    flex: 1;
  }
  button.danger {
    background: #fee;
    border: 1px solid #b00020;
    color: #b00020;
  }
</style>
