<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
  <title>Helpers — CropCard</title>
</svelte:head>

<main class="helpers">
  <h1>Helpers</h1>
  <p class="hint">Invite people to your farm. Helpers can record sprays and other field events; inspectors are read-only; custom-operators are scoped to specific blocks.</p>

  <section class="section">
    <h2>Invite a helper</h2>
    {#if form?.error}
      <p class="error" role="alert">{form.error}</p>
    {/if}
    {#if form?.ok && form?.acceptUrl}
      <p class="success" role="status">
        Invite sent. Share this link if email delivery fails:<br />
        <code>{form.acceptUrl}</code>
      </p>
    {/if}
    <form method="POST" action="?/invite" use:enhance class="form-row">
      <input type="email" name="email" placeholder="email@example.com" required />
      <select name="role">
        <option value="helper">Helper</option>
        <option value="inspector">Inspector (read-only)</option>
        <option value="custom-operator">Custom operator</option>
      </select>
      <button type="submit">Send invite</button>
    </form>
  </section>

  <section class="section">
    <h2>Pending invites</h2>
    {#if data.invites.length === 0}
      <p class="empty">No outstanding invites.</p>
    {:else}
      <table>
        <thead>
          <tr><th>Role</th><th>Sent</th><th>Expires</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {#each data.invites as inv}
            <tr>
              <td>{inv.roleWithinOwner}</td>
              <td>{new Date(inv.createdAt).toLocaleDateString()}</td>
              <td>{new Date(inv.expiresAt).toLocaleDateString()}</td>
              <td>{inv.status}</td>
              <td>
                {#if inv.status === 'pending'}
                  <form method="POST" action="?/revoke" use:enhance>
                    <input type="hidden" name="inviteId" value={inv.id} />
                    <button class="revoke" type="submit">Revoke</button>
                  </form>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <section class="section">
    <h2>Current members</h2>
    <table>
      <thead><tr><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody>
        {#each data.members as m}
          <tr>
            <td>{m.email}</td>
            <td>{m.roleWithinOwner}</td>
            <td>{m.status}</td>
            <td>
              {#if m.roleWithinOwner !== 'owner' && m.status === 'active'}
                <form method="POST" action="?/remove" use:enhance>
                  <input type="hidden" name="userId" value={m.userId} />
                  <button class="revoke" type="submit">Remove</button>
                </form>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
</main>

<style>
  .helpers { max-width: 64rem; margin: 2rem auto; padding: 1rem; }
  .hint { color: var(--fg-muted, #555); }
  .section { margin: 2rem 0; }
  h2 { margin-bottom: 0.75rem; }
  .form-row { display: flex; gap: 0.5rem; align-items: center; }
  .form-row input, .form-row select, button {
    font: inherit; padding: 0.5rem 0.75rem; min-height: 40px;
    border: 1px solid var(--divider, #ccc); border-radius: 0.25rem;
  }
  button { background: var(--accent, #1f5e3a); color: white; cursor: pointer; }
  .revoke { background: #b54a4a; }
  .error { background: #fde7e7; padding: 0.75rem; border-radius: 0.25rem; }
  .success { background: #e7fde7; padding: 0.75rem; border-radius: 0.25rem; }
  .success code { display: block; word-break: break-all; margin-top: 0.5rem; font-size: 0.875rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid var(--divider, #eee); }
  .empty { color: var(--fg-muted, #777); }
</style>
