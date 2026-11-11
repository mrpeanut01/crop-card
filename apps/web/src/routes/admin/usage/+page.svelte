<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let sending = $state(false);
</script>

<svelte:head>
  <title>Admin · Usage | CropCard</title>
</svelte:head>

<div class="admin">
  <nav class="crumbs" aria-label="Admin pages">
    <a href="/admin/owners">Owners</a>
    <span aria-hidden="true">·</span>
    <a href="/admin/feedback">Feedback</a>
    <span aria-hidden="true">·</span>
    <a href="/admin/usage" aria-current="page">Usage</a>
  </nav>
  <h1>Usage</h1>
  <p class="hint">
    The last seven days, as emailed every Monday morning (Eastern Time) to the addresses in
    <code>OPS_REPORT_TO</code>.
  </p>

  {#if data.recipientCount === 0}
    <p class="note">
      The weekly email is off. Store the address with
      <code>./scripts/set-azure-secret.sh ops-report-to</code>, then deploy.
    </p>
  {:else}
    <form
      method="POST"
      action="?/send"
      use:enhance={() => {
        sending = true;
        return async ({ update }) => {
          await update();
          sending = false;
        };
      }}
    >
      <button type="submit" class="send" disabled={sending}>
        Email this report now ({data.recipientCount}
        {data.recipientCount === 1 ? 'recipient' : 'recipients'})
      </button>
    </form>
  {/if}
  {#if form && 'sent' in form}
    <p class="ok" role="status">Sent to {form.sent}.</p>
  {:else if form && 'error' in form}
    <p class="err" role="alert">{form.error}</p>
  {/if}

  <h2>{data.subject}</h2>
  <pre class="report">{data.text}</pre>
</div>

<style>
  .admin {
    max-width: 960px;
    margin: 0 auto;
  }
  .crumbs {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: var(--font-size-caption);
  }
  .crumbs a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
  }
  .crumbs a[aria-current='page'] {
    font-weight: 700;
    color: var(--color-forest-deep);
  }
  h1 {
    margin: 0 0 4px;
  }
  .hint,
  .note {
    color: var(--color-ink-muted);
  }
  .note {
    border-left: 3px solid var(--color-wheat);
    padding: 6px 10px;
  }
  .send {
    min-height: 48px;
    padding: 0 16px;
  }
  .ok {
    color: var(--color-forest-deep);
  }
  .err {
    color: var(--color-rust, #a33);
  }
  .report {
    white-space: pre-wrap;
    background: var(--color-cream, #faf7ef);
    padding: 12px;
    border-radius: 6px;
    font-size: 14px;
    overflow-x: auto;
  }
</style>
