<script lang="ts">
  let { data, form } = $props();

  function fmtDate(ms: number | null) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString();
  }
</script>

<h1>Sources <a href="/admin" class="back">← admin</a></h1>

{#if form?.minted}
  <section class="minted">
    <h2>New credential — copy now (not shown again)</h2>
    <pre class="token">{form.minted.token}</pre>
    <p>
      Label: <strong>{form.minted.label}</strong> · Trust:
      <strong>{form.minted.trustLevel}</strong>
    </p>
    <p class="muted">
      Issued by {form.mintedByAdmin}. The plaintext is NOT stored — refresh and it's gone.
    </p>
  </section>
{/if}

{#if form?.error}<p class="warn">{form.error}</p>{/if}
{#if form?.revoked}<p class="muted">Revoked credential {form.revoked}.</p>{/if}
{#if form?.trustChanged}<p class="muted">Trust level updated for {form.trustChanged}.</p>{/if}

<section>
  <h2>Mint new credential</h2>
  <form method="post" action="?/mint">
    <label>
      Label
      <input type="text" name="label" required placeholder="e.g. cropcard-prod, scouting-drone" />
    </label>
    <label>
      Trust
      <select name="trustLevel">
        <option value="community" selected>community (uploads → pending_review)</option>
        <option value="trusted">trusted (uploads → approved)</option>
      </select>
    </label>
    <button type="submit">Mint</button>
  </form>
</section>

<section>
  <h2>Existing credentials</h2>
  <table>
    <thead>
      <tr>
        <th>Label</th>
        <th>Trust</th>
        <th>Created</th>
        <th>Last used</th>
        <th>Requests</th>
        <th>Revoked?</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each data.credentials as cred (cred.id)}
        <tr class:revoked={cred.revokedAt !== null}>
          <td>{cred.label}<br /><span class="id">{cred.id}</span></td>
          <td>{cred.trustLevel}</td>
          <td>{fmtDate(cred.createdAt)}</td>
          <td>{fmtDate(cred.lastUsedAt)}</td>
          <td>{cred.requestCount}</td>
          <td>{cred.revokedAt ? fmtDate(cred.revokedAt) : ''}</td>
          <td>
            {#if !cred.revokedAt}
              <form method="post" action="?/setTrust" style="display:inline">
                <input type="hidden" name="id" value={cred.id} />
                <input
                  type="hidden"
                  name="trustLevel"
                  value={cred.trustLevel === 'trusted' ? 'community' : 'trusted'}
                />
                <button type="submit">
                  → {cred.trustLevel === 'trusted' ? 'community' : 'trusted'}
                </button>
              </form>
              <form method="post" action="?/revoke" style="display:inline">
                <input type="hidden" name="id" value={cred.id} />
                <button type="submit" class="danger">Revoke</button>
              </form>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  .back {
    font-size: 0.85rem;
    color: #555;
    margin-left: 1rem;
  }
  .minted {
    background: #fef3c7;
    border: 1px solid #f59e0b;
    padding: 1rem;
    border-radius: 8px;
    margin: 1rem 0;
  }
  .token {
    background: #fff;
    padding: 0.75rem;
    border-radius: 4px;
    overflow-x: auto;
    user-select: all;
  }
  .muted {
    color: #555;
  }
  .warn {
    color: #b00020;
  }
  form {
    display: grid;
    gap: 0.5rem;
    max-width: 28rem;
    margin: 0.5rem 0 1.5rem;
  }
  label {
    display: grid;
    gap: 0.25rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 0.5rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.5rem;
    border-bottom: 1px solid #eee;
    font-size: 0.9rem;
    vertical-align: top;
  }
  tr.revoked td {
    opacity: 0.5;
  }
  .id {
    font-family: monospace;
    font-size: 0.75rem;
    color: #777;
  }
  button.danger {
    background: #fee;
    border: 1px solid #b00020;
    color: #b00020;
  }
</style>
