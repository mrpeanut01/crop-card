<script lang="ts">
  import { enhance } from '$app/forms';
  import { ChevronRight } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import { fmt } from '$lib/prefsState.svelte';
  import { createT } from '$lib/i18n';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const tr = $derived(createT(data.locale));

  let copied = $state(false);
  function copy(token: string) {
    navigator.clipboard?.writeText(token).then(
      () => (copied = true),
      () => (copied = false)
    );
  }
</script>

<svelte:head>
  <title>{tr('settings.tokens.pageTitle')}</title>
</svelte:head>

<div class="api-tokens">
  <nav class="breadcrumb" aria-label={tr('settings.tokens.breadcrumbAria')}>
    <a href="/settings">{tr('settings.tokens.crumbSettings')}</a>
    <ChevronRight size={13} aria-hidden="true" />
    <a href="/settings/integrations">{tr('settings.tokens.crumbIntegrations')}</a>
    <ChevronRight size={13} aria-hidden="true" />
    <span>{tr('settings.tokens.crumbAgents')}</span>
  </nav>
  <Kicker>{tr('settings.tokens.kicker')}</Kicker>
  <h1 class="serif">{tr('settings.tokens.h1')}</h1>
  <p class="hint">
    {tr('settings.tokens.hintA')}
    <strong>{tr('settings.tokens.once')}</strong>
    {tr('settings.tokens.hintB')}
  </p>

  <section class="section">
    <h2>{tr('settings.tokens.mintTitle')}</h2>
    {#if form?.error}
      <p class="error" role="alert">{form.error}</p>
    {/if}
    {#if form?.minted}
      <div class="copy-once" role="status">
        <h3>{tr('settings.tokens.copyTitle')}</h3>
        <pre class="token">{form.minted.token}</pre>
        <button type="button" onclick={() => copy(form.minted.token)}>
          {copied ? tr('settings.tokens.copied') : tr('settings.tokens.copy')}
        </button>
        <p class="hint">
          {tr('settings.tokens.storedA')}
          <code>sha256(plaintext)</code>
          {tr('settings.tokens.storedB')}
        </p>
      </div>
    {/if}
    <form method="POST" action="?/mint" use:enhance class="form-row">
      <input
        type="text"
        name="label"
        placeholder={tr('settings.tokens.labelPlaceholder')}
        maxlength="64"
        required
      />
      <label class="checkbox">
        <input type="checkbox" name="isServiceAccount" />
        {tr('settings.tokens.serviceAccount')}
      </label>
      <button type="submit">{tr('settings.tokens.mint')}</button>
    </form>
  </section>

  <section class="section">
    <h2>{tr('settings.tokens.activeTitle')}</h2>
    {#if data.tokens.filter((t) => !t.revokedAt).length === 0}
      <p class="empty">{tr('settings.tokens.noActive')}</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th>{tr('settings.tokens.colLabel')}</th>
            <th>{tr('settings.tokens.colKind')}</th>
            <th>{tr('settings.tokens.colCreated')}</th>
            <th>{tr('settings.tokens.colLastUsed')}</th>
            <th>{tr('settings.tokens.colRequests')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each data.tokens.filter((t) => !t.revokedAt) as t (t.id)}
            <tr>
              <td>{t.label}</td>
              <td
                >{t.isServiceAccount
                  ? tr('settings.tokens.kindService')
                  : tr('settings.tokens.kindPersonal')}</td
              >
              <td>{fmt.instant(t.createdAt, 'date')}</td>
              <td>{fmt.instant(t.lastUsedAt)}</td>
              <td>{t.requestCount.toLocaleString()}</td>
              <td>
                <form method="POST" action="?/revoke" use:enhance>
                  <input type="hidden" name="tokenId" value={t.id} />
                  <button class="revoke" type="submit">{tr('settings.tokens.revoke')}</button>
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
      <h2>{tr('settings.tokens.revokedTitle')}</h2>
      <table>
        <thead>
          <tr>
            <th>{tr('settings.tokens.colLabel')}</th>
            <th>{tr('settings.tokens.colRevoked')}</th>
            <th>{tr('settings.tokens.colTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.tokens.filter((t) => t.revokedAt) as t (t.id)}
            <tr>
              <td>{t.label}</td>
              <td>{fmt.instant(t.revokedAt, 'date')}</td>
              <td>{t.requestCount.toLocaleString()}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}
</div>

<style>
  .api-tokens {
    max-width: 880px;
    margin: 0 auto;
    padding: 1rem;
  }
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--color-ink-muted);
    margin-bottom: 4px;
  }
  .breadcrumb a {
    color: var(--color-forest);
    text-decoration: none;
  }
  .breadcrumb a:hover {
    text-decoration: underline;
  }
  h1 {
    margin: 6px 0 0.5rem;
    font-family: var(--font-serif, serif);
    font-size: 30px;
    color: var(--color-forest-deep);
    letter-spacing: -0.02em;
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
