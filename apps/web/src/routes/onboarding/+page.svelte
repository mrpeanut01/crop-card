<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();

  // First-field focus on a freshly-loaded setup form is intentional — but
  // `autofocus` is flagged by Svelte's a11y lint as a jarring shift for
  // screen readers. Use bind:this + $effect to call focus() after mount.
  let farmNameInput = $state<HTMLInputElement | null>(null);
  $effect(() => {
    farmNameInput?.focus();
  });
</script>

<svelte:head>
  <title>Set up your farm — CropCard</title>
</svelte:head>

<main class="onboarding">
  <h1>Welcome to CropCard</h1>
  <p class="hint">Tell us about your farm. You can change these later in settings.</p>

  {#if form?.error}
    <p class="error" role="alert">{form.error}</p>
  {/if}

  <form method="POST" use:enhance class="form">
    <label class="row">
      <span class="lbl">Farm name <em>*</em></span>
      <input
        type="text"
        name="farmName"
        required
        autocomplete="organization"
        placeholder="e.g., Hilltop Acres"
        bind:this={farmNameInput}
      />
    </label>

    <label class="row">
      <span class="lbl">Location <em class="opt">(optional)</em></span>
      <input
        type="text"
        name="location"
        autocomplete="street-address"
        placeholder="e.g., Loudoun County, VA — paste lat/lng if you have it"
      />
    </label>

    <button class="submit" type="submit">Create farm →</button>
  </form>

  <p class="next-step-hint">
    💡 After you create your farm, head to <a href="/plan">Plan</a> to set up this season's input philosophy
    (6 quick questions — drives what the planner suggests).
  </p>
</main>

<style>
  .onboarding {
    max-width: 32rem;
    margin: 4rem auto;
    padding: 1.5rem;
  }
  h1 {
    margin-top: 0;
  }
  .hint {
    color: var(--fg-muted, #555);
    margin-bottom: 1.5rem;
  }
  .error {
    background: #fde7e7;
    border: 1px solid #b54a4a;
    color: #6b1717;
    padding: 0.75rem 1rem;
    border-radius: 0.375rem;
    margin-bottom: 1rem;
  }
  .form {
    display: grid;
    gap: 1rem;
  }
  .row {
    display: grid;
    gap: 0.375rem;
  }
  .lbl {
    font-weight: 600;
  }
  .opt {
    color: var(--fg-muted, #555);
    font-style: normal;
    font-weight: 400;
  }
  em {
    color: #b54a4a;
    font-style: normal;
  }
  input[type='text'] {
    font: inherit;
    padding: 0.75rem 0.875rem;
    border: 1px solid var(--divider, #ccc);
    border-radius: 0.375rem;
    min-height: 48px;
  }
  input[type='text']:focus {
    outline: 2px solid var(--accent, #1f5e3a);
    outline-offset: 2px;
  }
  .submit {
    margin-top: 0.5rem;
    min-height: 48px;
    padding: 0.75rem 1.25rem;
    background: var(--accent, #1f5e3a);
    color: white;
    border: none;
    border-radius: 0.375rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .submit:hover {
    filter: brightness(1.1);
  }
  .next-step-hint {
    margin-top: 1.5rem;
    padding: 0.75rem 1rem;
    background: #f0f7f2;
    border: 1px solid #c4d2c4;
    border-radius: 0.375rem;
    color: #1f5e3a;
    font-size: 0.9rem;
    line-height: 1.4;
  }
  .next-step-hint a {
    color: #1f5e3a;
    font-weight: 600;
    text-decoration: underline;
  }
</style>
