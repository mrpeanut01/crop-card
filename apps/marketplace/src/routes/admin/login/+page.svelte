<script lang="ts">
  let { form } = $props();
</script>

<h1>Marketplace admin sign-in</h1>

<p>
  Enter your operator email. If it's on the allowlist
  (<code>MARKETPLACE_ADMIN_EMAILS</code>), you'll receive a magic-link.
</p>

<form method="post" action="?/login">
  <label>
    Email
    <input type="email" name="email" required autocomplete="email" />
  </label>
  <button type="submit">Send sign-in link</button>
</form>

{#if form?.sent}
  <p class="muted">
    Magic-link issued. Check the server logs (stdout email stub) for the URL.
  </p>
  {#if form.hint}
    <p class="muted" style="word-break: break-all;">{form.hint}</p>
  {/if}
{:else if form?.error}
  <p class="warn">{form.error}</p>
{/if}

<style>
  form {
    display: grid;
    gap: 0.75rem;
    max-width: 28rem;
    margin: 1rem 0;
  }
  label {
    display: grid;
    gap: 0.25rem;
  }
  .muted {
    color: #555;
  }
  .warn {
    color: #b00020;
  }
</style>
