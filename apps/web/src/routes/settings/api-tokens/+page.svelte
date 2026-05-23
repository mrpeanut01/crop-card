<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let copied = $state(false);
  function copy(token: string) {
    navigator.clipboard?.writeText(token).then(
      () => (copied = true),
      () => (copied = false)
    );
  }
</script>

<svelte:head>
  <title>API tokens — CropCard</title>
</svelte:head>

<main class="api-tokens">
  <h1>API tokens</h1>
  <p class="hint">
    Bearer credentials for external Claude agents that act on this farm's behalf
    (UC-43). Each token is scoped to this Owner and inherits your role's
    permissions. Tokens cannot mint other tokens or switch Owners. Revoke
    immediately if leaked — the plaintext is shown <strong>once</strong> on
    mint and never recoverable.
  </p>

  <section class="section">
    <h2>Mint a new token</h2>
    {#if form?.error}
      <p class="error" role="alert">{form.error}</p>
    {/if}
    {#if form?.minted}
      <div class="copy-once" role="status">
        <h3>Copy this token now — it will not be shown again</h3>
        <pre class="token">{form.minted.token}</pre>
        <button type="button" onclick={() => copy(form.minted.token)}>
          {copied ? 'Copied ✓' : 'Copy to clipboard'}
        </button>
        <p class="hint">
          Stored as <code>sha256(plaintext)</code> in the DB. If you lose it,
          revoke and mint a new one.
        </p>
      </div>
    {/if}
    <form method="POST" action="?/mint" use:enhance class="form-row">
      <input
        type="text"
        name="label"
        placeholder="e.g. scouting-drone-1"
        maxlength="64"
        required
      />
      <label class="checkbox">
        <input type="checkbox" name="isServiceAccount" />
        Service account (independent AI quota)
      </label>
      <button type="submit">Mint token</button>
    </form>
  </section>

  <section class="section">
    <h2>Active tokens</h2>
    {#if data.tokens.filter((t) => !t.revokedAt).length === 0}
      <p class="empty">No active tokens.</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Label</th>
            <th>Kind</th>
            <th>Created</th>
            <th>Last used</th>
            <th>Requests</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each data.tokens.filter((t) => !t.revokedAt) as t}
            <tr>
              <td>{t.label}</td>
              <td>{t.isServiceAccount ? 'Service account' : 'Personal use'}</td>
              <td>{new Date(t.createdAt).toLocaleDateString()}</td>
              <td>{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : '—'}</td>
              <td>{t.requestCount.toLocaleString()}</td>
              <td>
                <form method="POST" action="?/revoke" use:enhance>
                  <input type="hidden" name="tokenId" value={t.id} />
                  <button class="revoke" type="submit">Revoke</button>
                </form>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  {#if data.tokens.some((t) => t.revokedAt)}
    <section class="section">
      <h2>Revoked tokens</h2>
      <table>
        <thead>
          <tr><th>Label</th><th>Revoked</th><th>Total requests</th></tr>
        </thead>
        <tbody>
          {#each data.tokens.filter((t) => t.revokedAt) as t}
            <tr>
              <td>{t.label}</td>
              <td>{new Date(t.revokedAt!).toLocaleDateString()}</td>
              <td>{t.requestCount.toLocaleString()}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}
</main>

<style>
  .api-tokens {
    max-width: 880px;
    margin: 0 auto;
    padding: 1rem;
  }
  .hint {
    color: #555;
    margin: 0 0 1rem;
  }
  .section {
    margin-bottom: 2rem;
    padding: 1rem;
    border: 1px solid #e4e9e4;
    border-radius: 8px;
    background: #fafcfa;
  }
  .form-row {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .form-row input[type='text'] {
    flex: 1;
    min-width: 14rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid #cbd5cb;
    border-radius: 6px;
    min-height: 48px;
  }
  .form-row .checkbox {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  button {
    min-height: 48px;
    padding: 0 1rem;
    border-radius: 6px;
    background: #1f5e3a;
    color: white;
    border: 1px solid #1f5e3a;
    font-weight: 600;
    cursor: pointer;
  }
  button.revoke {
    background: white;
    color: #9b2c2c;
    border-color: #d4a3a3;
  }
  .copy-once {
    background: #fff8e1;
    border: 2px solid #f0a500;
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1rem;
  }
  .copy-once h3 {
    margin: 0 0 0.5rem;
  }
  .token {
    background: white;
    padding: 0.6rem 0.8rem;
    border-radius: 4px;
    border: 1px solid #d4d4d4;
    overflow-x: auto;
    font-size: 0.95rem;
    word-break: break-all;
    white-space: pre-wrap;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    text-align: left;
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid #e4e9e4;
  }
  .empty {
    color: #777;
    font-style: italic;
  }
  .error {
    color: #9b2c2c;
    font-weight: 600;
  }
</style>
