<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
  <title>Admin · Owners — CropCard</title>
</svelte:head>

<main class="admin">
  <h1>All Owners</h1>
  <p class="hint">Cross-tenant view. Every action you take is appended to the superadmin audit log.</p>

  {#if form?.error}
    <p class="error" role="alert">{form.error}</p>
  {/if}

  <section class="section">
    <table class="owners">
      <thead>
        <tr>
          <th>Name</th><th>Slug</th><th>Status</th><th>AI calls<br />(this month)</th>
          <th>Sprays<br />(this month)</th><th>Created</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each data.owners as o}
          <tr class:suspended={o.billingStatus === 'suspended'}>
            <td><strong>{o.name}</strong></td>
            <td><code>{o.slug}</code></td>
            <td>
              <form method="POST" action="?/setBilling" use:enhance class="status-form">
                <input type="hidden" name="ownerId" value={o.id} />
                <select name="status" onchange={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}>
                  <option value="trial" selected={o.billingStatus === 'trial'}>trial</option>
                  <option value="active" selected={o.billingStatus === 'active'}>active</option>
                  <option value="past_due" selected={o.billingStatus === 'past_due'}>past_due</option>
                  <option value="canceled" selected={o.billingStatus === 'canceled'}>canceled</option>
                  <option value="suspended" selected={o.billingStatus === 'suspended'}>suspended</option>
                </select>
              </form>
            </td>
            <td>{o.currentPeriodAiCalls.toLocaleString()}</td>
            <td>{o.currentPeriodSprayEvents.toLocaleString()}</td>
            <td>{new Date(o.createdAt).toLocaleDateString()}</td>
            <td>
              <form method="POST" action="?/impersonate" use:enhance>
                <input type="hidden" name="ownerId" value={o.id} />
                <button type="submit" class="impersonate">Impersonate</button>
              </form>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="section">
    <h2>Recent audit log</h2>
    <table class="audit">
      <thead><tr><th>When</th><th>By</th><th>Action</th><th>Owner</th><th>Target</th></tr></thead>
      <tbody>
        {#each data.audit as a}
          <tr>
            <td>{new Date(a.at).toLocaleString()}</td>
            <td><code>{a.superadminUserId}</code></td>
            <td>{a.action}</td>
            <td>{a.ownerId ?? '—'}</td>
            <td>{a.targetTable ? `${a.targetTable}#${a.targetId}` : '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
</main>

<style>
  .admin { max-width: 80rem; margin: 1rem auto; padding: 1rem; }
  .hint { color: var(--fg-muted, #555); }
  .section { margin: 1.5rem 0; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid var(--divider, #eee); vertical-align: top; }
  th { background: rgba(0,0,0,0.04); font-weight: 600; }
  .owners tr.suspended { background: #fde7e7; }
  .status-form select, button { font: inherit; padding: 0.25rem 0.5rem; min-height: 32px; border: 1px solid var(--divider, #ccc); border-radius: 0.25rem; }
  button { background: var(--accent, #1f5e3a); color: white; cursor: pointer; }
  .impersonate { background: #b54a4a; }
  .error { background: #fde7e7; padding: 0.75rem; border-radius: 0.25rem; }
  code { font-size: 0.85em; }
</style>
