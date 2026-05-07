<script lang="ts">
  let { form, data } = $props();
</script>

<h1>Sign in</h1>

{#if data.user}
  <section class="card">
    <p>
      Signed in as <strong>{data.user.email}</strong>
      <span class="role role-{data.user.role}">{data.user.role}</span>.
    </p>
    <form method="POST" action="/signout">
      <button type="submit" class="primary">Sign out</button>
    </form>
  </section>
{:else}
  <section class="card">
    <h2>Demo sign-in</h2>
    <p class="lede">
      Pick a role to try it out. New emails default to helper; the demo buttons hard-set the role on
      first sign-in.
    </p>
    <div class="demo-buttons">
      <form method="POST" action="?/demo">
        <input type="hidden" name="role" value="owner" />
        <button class="primary owner" type="submit">Sign in as Owner</button>
      </form>
      <form method="POST" action="?/demo">
        <input type="hidden" name="role" value="helper" />
        <button class="primary helper" type="submit">Sign in as Helper</button>
      </form>
    </div>
  </section>

  <section class="card">
    <h2>Email sign-in</h2>
    <p class="lede">
      First-time emails default to <em>helper</em>. Tick the owner box to claim owner role on first
      sign-in (this is dev auth — production should use Auth.js magic-link, which the codebase has
      installed).
    </p>
    <form method="POST" action="?/signin">
      <label>
        Email
        <input type="email" name="email" required placeholder="you@example.com" />
      </label>
      <label class="checkbox">
        <input type="checkbox" name="role" value="owner" />
        First sign-in: claim owner role
      </label>
      <button type="submit" class="primary">Sign in</button>
    </form>
    {#if form?.error}
      <p class="error">{form.error}</p>
    {/if}
  </section>
{/if}

<style>
  h1 {
    margin: 0 0 1rem;
  }
  .card {
    background: white;
    padding: 1.25rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h2 {
    margin: 0 0 0.5rem;
    color: #1f5e3a;
    font-size: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .lede {
    color: #555;
    margin: 0 0 1rem;
  }
  .demo-buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  form {
    margin: 0;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
    margin-bottom: 0.75rem;
  }
  label.checkbox {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }
  input[type='email'] {
    padding: 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
  }
  .primary {
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.9rem 1.5rem;
    font-weight: 600;
    cursor: pointer;
    width: 100%;
    min-height: 56px;
    font-size: 1rem;
  }
  .primary.owner {
    background: #b35900;
  }
  .primary.helper {
    background: #1f5e3a;
  }
  .role {
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    margin-left: 0.5rem;
  }
  .role-owner {
    background: #fff3cd;
    color: #b35900;
  }
  .role-helper {
    background: #e7f1ea;
    color: #1f5e3a;
  }
  .error {
    color: #b00020;
  }
</style>
