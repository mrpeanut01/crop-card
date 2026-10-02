<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const tr = $derived(createT(page.data?.locale));

  const REASON_COPY = $derived({
    invalid: tr('signin.verify.invalid'),
    expired: tr('signin.verify.expired'),
    used: tr('signin.verify.used')
  });

  const reason = $derived(form?.reason ?? (data.status === 'invalid' ? data.reason : null));
</script>

<svelte:head><title>{tr('signin.verify.title')}</title></svelte:head>

<section class="verify" aria-labelledby="verify-title">
  {#if form?.sent}
    <h1 id="verify-title">{tr('signin.verify.checkEmail')}</h1>
    <p role="status" aria-live="polite">{form.message}</p>
  {:else if reason || data.status !== 'ready'}
    <h1 id="verify-title">{tr('signin.verify.unusable')}</h1>
    <p role="alert">{REASON_COPY[reason ?? 'invalid']}</p>
    {#if form?.resendError}
      <p class="error" role="alert">{form.resendError}</p>
    {/if}
    <form method="POST" action="?/resend">
      <label class="row">
        <span class="lbl">{tr('signin.verify.email')}</span>
        <input
          type="email"
          name="email"
          required
          autocomplete="email"
          placeholder="you@example.com"
          inputmode="email"
          autocapitalize="off"
          spellcheck="false"
        />
      </label>
      {#if data.invite}
        <input type="hidden" name="invite" value={data.invite} />
      {/if}
      <button class="primary" type="submit">{tr('signin.verify.sendNew')}</button>
    </form>
    <a class="ghost" href="/">{tr('signin.verify.back')}</a>
  {:else}
    <h1 id="verify-title">{tr('signin.verify.finish')}</h1>
    <p>{tr('signin.verify.signingInAs')} <strong>{data.email}</strong>.</p>
    <form method="POST" action="?/confirm">
      <input type="hidden" name="token" value={data.token} />
      {#if data.invite}
        <input type="hidden" name="invite" value={data.invite} />
      {/if}
      <!-- svelte-ignore a11y_autofocus -->
      <button class="primary" type="submit" autofocus>{tr('signin.verify.continue')}</button>
    </form>
    <p class="hint">{tr('signin.verify.notYou')}</p>
  {/if}
</section>

<style>
  .verify {
    max-width: 440px;
    margin: 72px auto;
    padding: 32px;
    background: var(--color-paper, #fff);
    border: 1px solid var(--color-divider, #d9ddd5);
    border-radius: 12px;
    display: grid;
    gap: 1rem;
  }
  h1 {
    margin: 0;
    font-size: 1.5rem;
    color: var(--color-ink, #1d2420);
  }
  p {
    margin: 0;
    line-height: 1.5;
    color: var(--color-ink-soft, #3d4742);
  }
  form {
    display: grid;
    gap: 0.875rem;
  }
  .row {
    display: grid;
    gap: 0.375rem;
  }
  .lbl {
    font-weight: 600;
    font-size: 0.875rem;
  }
  input[type='email'] {
    font: inherit;
    padding: 0.75rem 0.875rem;
    border: 1px solid #c9d2c9;
    border-radius: 0.5rem;
    min-height: 48px;
    background: #fbfbf9;
  }
  .primary {
    min-height: 48px;
    padding: 0.75rem 1.25rem;
    background: var(--color-forest, #1f5e3a);
    color: #fff;
    border: none;
    border-radius: 0.5rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    color: var(--color-forest, #1f5e3a);
    font-weight: 600;
    text-decoration: none;
  }
  .error {
    background: #fdecec;
    border: 1px solid #e3a8a8;
    color: #6b1717;
    padding: 0.625rem 0.875rem;
    border-radius: 0.375rem;
  }
  .hint {
    font-size: 0.875rem;
  }
</style>
