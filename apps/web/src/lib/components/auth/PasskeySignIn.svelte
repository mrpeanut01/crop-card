<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import {
    cancelPasskeyRequests,
    loginWithButton,
    passkeysSupported,
    startAutofillLogin,
    type PasskeyResult,
    type SignedIn
  } from '$lib/client/passkey';

  const {
    inviteToken = null,
    autofill = true
  }: { inviteToken?: string | null; autofill?: boolean } = $props();

  const tr = $derived(createT(page.data?.locale));

  let supported = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  function land(value: SignedIn): void {
    window.location.href = inviteToken ? `/invite/${encodeURIComponent(inviteToken)}` : value.next;
  }

  function show(result: PasskeyResult<SignedIn>): void {
    if (result.ok) {
      land(result.value);
      return;
    }
    if (result.cancelled) return;
    error = result.error ?? tr(result.errorKey ?? 'passkey.err.signinFailed');
  }

  onMount(() => {
    supported = passkeysSupported();
    if (supported && autofill) {
      void startAutofillLogin().then((r) => {
        if (r) show(r);
      });
    }
    return () => cancelPasskeyRequests();
  });

  async function useButton(): Promise<void> {
    busy = true;
    error = null;
    try {
      show(await loginWithButton());
    } finally {
      busy = false;
    }
  }
</script>

{#if supported}
  <div class="passkey" data-testid="passkey-signin">
    <button class="passkey-btn" type="button" onclick={useButton} disabled={busy}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="9" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2" />
        <path
          d="M2 21c0-4 3-6 7-6 1.4 0 2.6.3 3.6.8M15 14a3 3 0 1 1 3 3v4l-1.5-1.5L18 18"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      {busy ? tr('passkey.signin.working') : tr('passkey.signin.button')}
    </button>
    <p class="help">{tr('passkey.signin.help')}</p>
    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
  </div>
{/if}

<style>
  .passkey {
    display: grid;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .passkey-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: var(--btn-height-primary, 48px);
    padding: 0.75rem 1.25rem;
    background: #fff;
    color: #1f5e3a;
    border: 2px solid #1f5e3a;
    border-radius: 0.5rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .passkey-btn:disabled {
    opacity: 0.7;
    cursor: progress;
  }
  .passkey-btn:focus-visible {
    outline: 3px solid #1f5e3a;
    outline-offset: 2px;
  }
  .help {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.45;
    color: #3d4742;
  }
  .error {
    margin: 0;
    font-size: 0.9rem;
    color: #8a1c1c;
  }
</style>
