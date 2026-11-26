<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import { createT } from '$lib/i18n';
  import {
    addPasskey,
    canAddPasskeyHere,
    dismissOffer,
    offerDismissCount,
    offerSuppressedHere,
    recordOfferDismissed,
    suppressOfferHere
  } from '$lib/client/passkey';

  /** Phase 38 add-a-passkey card (P38-6, P38-7). Shown only when the root
   *  layout says the sign-in qualifies and this device can hold a passkey,
   *  and held back while a safety stop or urgent banner is on screen. */
  const tr = $derived(createT(page.data?.locale));
  const offered = $derived(!!page.data?.passkeyOffer);
  const userId = $derived((page.data?.user?.id as string | undefined) ?? '');

  const BLOCKERS = '[data-safety-stop], [role="alertdialog"], dialog[open]';

  let ready = $state(false);
  let capable = $state(false);
  let blocked = $state(true);
  let hidden = $state(false);
  let busy = $state(false);
  let done = $state(false);
  let error = $state<string | null>(null);
  let dismissals = $state(0);

  onMount(() => {
    void (async () => {
      capable = await canAddPasskeyHere();
      dismissals = userId ? offerDismissCount(userId) : 0;
      hidden = !userId || offerSuppressedHere(userId);
      await tick();
      blocked = document.querySelector(BLOCKERS) !== null;
      ready = true;
    })();
  });

  const visible = $derived(ready && offered && capable && !blocked && !hidden);

  async function add(): Promise<void> {
    busy = true;
    error = null;
    try {
      const r = await addPasskey();
      if (r.ok) {
        done = true;
        return;
      }
      if (r.cancelled) return;
      error = r.error ?? tr(r.errorKey ?? 'passkey.err.addFailed');
    } finally {
      busy = false;
    }
  }

  async function notNow(): Promise<void> {
    if (userId) recordOfferDismissed(userId);
    hidden = true;
    await dismissOffer();
  }

  async function never(): Promise<void> {
    if (userId) suppressOfferHere(userId);
    hidden = true;
    await dismissOffer();
  }

  async function close(): Promise<void> {
    hidden = true;
    await invalidateAll();
  }
</script>

{#if visible || (done && !hidden)}
  <section class="pk-card" aria-labelledby="pk-card-title" data-testid="add-passkey-card">
    {#if done}
      <p class="done" role="status">{tr('passkey.offer.done')}</p>
      <button type="button" class="ghost" onclick={close}>{tr('ui.close')}</button>
    {:else}
      <h2 id="pk-card-title">{tr('passkey.offer.title')}</h2>
      <p>{tr('passkey.offer.body')}</p>
      <p class="shared">{tr('passkey.offer.shared')}</p>
      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}
      <div class="actions">
        <button type="button" class="primary" onclick={add} disabled={busy}>
          {tr('passkey.offer.add')}
        </button>
        <button type="button" class="ghost" onclick={notNow} disabled={busy}>
          {tr('passkey.offer.notNow')}
        </button>
        {#if dismissals >= 2}
          <button type="button" class="ghost" onclick={never} disabled={busy}>
            {tr('passkey.offer.never')}
          </button>
        {/if}
      </div>
    {/if}
  </section>
{/if}

<style>
  .pk-card {
    margin: 0 0 1rem;
    padding: 1rem 1.125rem;
    border: 1px solid var(--color-divider);
    border-left: 4px solid var(--color-forest);
    border-radius: 0.5rem;
    background: var(--color-paper);
    display: grid;
    gap: 0.5rem;
  }
  h2 {
    margin: 0;
    font-size: 1.125rem;
  }
  p {
    margin: 0;
    line-height: 1.45;
  }
  .shared {
    font-size: 0.875rem;
    color: var(--color-ink-soft);
  }
  .error {
    color: var(--color-rust);
  }
  .done {
    font-weight: 600;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }
  button {
    min-height: var(--btn-height-primary, 48px);
    padding: 0.625rem 1rem;
    border-radius: 0.5rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary {
    background: var(--color-forest);
    color: #fff;
    border: none;
  }
  .ghost {
    background: transparent;
    color: var(--color-forest);
    border: 1px solid var(--color-forest);
  }
  button:disabled {
    opacity: 0.7;
  }
  button:focus-visible {
    outline: 3px solid var(--color-forest);
    outline-offset: 2px;
  }
</style>
