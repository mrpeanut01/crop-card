<script lang="ts">
  import { OFFLINE_MESSAGE, errorFromResponse } from '$lib/animals/display';
  import { holdRefusalOf, shorteningLine, type HoldShortenBody } from '$lib/animals/holdGuardCopy';

  interface Props {
    /** The record's `POST …/[id]/void` endpoint. */
    url: string;
    /** Server: the viewer is the owner, signed in on their own account. */
    canVoidHolds: boolean;
    /** Server save time + 48 hours; null when the entry can never be voided. */
    voidableUntilMs: number | null;
    timeZone?: string;
    /** A spray, insecticide or fungicide application. */
    application?: boolean;
    onVoided: () => void | Promise<void>;
    fetcher?: typeof fetch;
  }

  const {
    url,
    canVoidHolds,
    voidableUntilMs,
    timeZone,
    application = false,
    onVoided,
    fetcher
  }: Props = $props();

  const uid = $props.id();
  const visible = $derived(
    canVoidHolds && voidableUntilMs !== null && voidableUntilMs > Date.now()
  );

  let open = $state(false);
  let reason = $state('');
  let busy = $state(false);
  let errorText = $state<string | null>(null);
  let offer = $state<HoldShortenBody | null>(null);

  const lines = $derived.by(() => {
    if (!offer) return [];
    return [
      ...offer.holds.map((h) => shorteningLine(h, timeZone, { dated: false })),
      ...offer.coverage.map((c) => `${c.label} would no longer fall inside a hold.`)
    ];
  });

  async function submit(confirmShorten?: string) {
    errorText = null;
    if (!reason.trim()) {
      errorText = 'Say why this entry is being voided.';
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      errorText = OFFLINE_MESSAGE;
      return;
    }
    busy = true;
    try {
      const res = await (fetcher ?? fetch)(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason: reason.trim(),
          ...(confirmShorten ? { confirmShorten } : {})
        })
      });
      const refusal = await holdRefusalOf(res);
      if (refusal?.canVoid) {
        offer = refusal;
        return;
      }
      offer = null;
      if (!res.ok) {
        errorText = await errorFromResponse(res);
        return;
      }
      open = false;
      reason = '';
      await onVoided();
    } catch {
      errorText = OFFLINE_MESSAGE;
    } finally {
      busy = false;
    }
  }
</script>

{#if visible}
  <div class="hold-void" data-testid="hold-void" lang="en" data-english-only="safety">
    {#if !open}
      <button type="button" class="danger" onclick={() => (open = true)}>Void this entry…</button>
    {:else}
      <label class="label" for="void-reason-{uid}">Why is this entry being voided?</label>
      <input
        id="void-reason-{uid}"
        class="input"
        type="text"
        maxlength="500"
        bind:value={reason}
        oninput={() => (offer = null)}
      />
      {#if !offer}
        <div class="row">
          <button type="button" class="danger" disabled={busy} onclick={() => submit()}>
            Void this entry
          </button>
          <button
            type="button"
            class="ghost"
            disabled={busy}
            onclick={() => {
              open = false;
              offer = null;
              errorText = null;
            }}
          >
            Keep it
          </button>
        </div>
      {/if}
    {/if}
    <p class="help">
      The owner can void an entry that was a mistake within 48 hours of entering it. Holds from an
      unknown label or a prohibited drug can't be voided.
    </p>
    {#if application}
      <p class="help">
        Voiding removes this application everywhere, including its re-entry and pre-harvest
        intervals.
      </p>
    {/if}
    {#if offer}
      <div class="offer" role="alert">
        <p><strong>Voiding this entry would shorten holds:</strong></p>
        <ul>
          {#each lines.slice(0, 3) as line, i (i)}<li>{line}</li>{/each}
          {#if lines.length > 3}<li>+{lines.length - 3} more</li>{/if}
        </ul>
        <button
          type="button"
          class="danger"
          disabled={busy}
          onclick={() => offer && submit(offer.diffHash)}
        >
          Void it and shorten these holds
        </button>
      </div>
    {/if}
    {#if errorText}<p class="error" role="alert">{errorText}</p>{/if}
  </div>
{/if}

<style>
  .hold-void {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 100%;
    white-space: normal;
  }
  .label {
    font-weight: 600;
  }
  .input {
    min-height: 48px;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    padding: 0 10px;
    border: 1px solid var(--color-divider, #ccc);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper, #fff);
    font: inherit;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  button {
    min-height: 48px;
    min-width: 48px;
    padding: 0 16px;
    border-radius: var(--radius-input, 6px);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    max-width: 100%;
    white-space: normal;
  }
  .danger {
    border: 2px solid var(--color-rust, #9a3b1b);
    background: var(--color-paper, #fff);
    color: var(--color-rust, #9a3b1b);
    align-self: flex-start;
  }
  .ghost {
    border: 1px solid var(--color-divider, #ccc);
    background: transparent;
    color: inherit;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .help {
    margin: 0;
    color: var(--color-ink-soft, #555);
    font-size: 0.9em;
  }
  .offer {
    border: 2px solid var(--color-rust, #9a3b1b);
    border-radius: 12px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .offer p,
  .offer ul {
    margin: 0;
  }
  .offer ul {
    padding-left: 18px;
  }
  .error {
    margin: 0;
    color: var(--color-rust, #9a3b1b);
    font-weight: 600;
  }
</style>
