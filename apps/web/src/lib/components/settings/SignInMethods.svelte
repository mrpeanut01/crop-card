<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { formatPhone, parseIdentifier } from '$lib/identity';
  import Pill from '$lib/components/ui/Pill.svelte';

  let { email, phone }: { email: string | null; phone: string | null } = $props();

  type Kind = 'email' | 'phone';
  let adding = $state<Kind | null>(null);
  let entered = $state('');
  let pendingIdentifier = $state<string | null>(null);
  let code = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);

  const methods = $derived([
    { kind: 'email' as const, value: email, label: 'Email', shown: email },
    { kind: 'phone' as const, value: phone, label: 'Mobile', shown: phone ? formatPhone(phone) : null }
  ]);
  const linkedCount = $derived(methods.filter((m) => m.value).length);

  function start(kind: Kind) {
    adding = kind;
    entered = '';
    code = '';
    pendingIdentifier = null;
    error = null;
    notice = null;
  }

  function cancel() {
    adding = null;
    pendingIdentifier = null;
    error = null;
  }

  async function call(url: string, method: string, body: unknown) {
    busy = true;
    error = null;
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        error = data.error ?? 'Something went wrong. Try again.';
        return null;
      }
      return data;
    } catch {
      error = "Couldn't reach the server. Check your connection.";
      return null;
    } finally {
      busy = false;
    }
  }

  async function sendCode() {
    const id = parseIdentifier(entered);
    if (!id || id.kind !== adding) {
      error = adding === 'email' ? 'Enter a valid email address.' : 'Enter a valid mobile number.';
      return;
    }
    const r = await call('/api/account/identity', 'POST', { identifier: id.value });
    if (r) pendingIdentifier = r.identifier;
  }

  async function verify() {
    const r = await call('/api/account/identity/verify', 'POST', {
      identifier: pendingIdentifier,
      code
    });
    if (!r) return;
    notice = `${r.kind === 'email' ? 'Email' : 'Mobile number'} added. You can sign in with it now.`;
    adding = null;
    pendingIdentifier = null;
    await invalidateAll();
  }

  async function remove(kind: Kind) {
    const r = await call('/api/account/identity', 'DELETE', { kind });
    if (!r) return;
    notice = `${kind === 'email' ? 'Email' : 'Mobile number'} removed.`;
    await invalidateAll();
  }

  /** This component sits inside the settings save form; Enter must not submit it. */
  function onEnter(e: KeyboardEvent, action: () => void) {
    if (e.key === 'Enter') {
      e.preventDefault();
      action();
    }
  }
</script>

<div class="methods">
  {#each methods as m (m.kind)}
    <div class="method-row">
      <div class="m-text">
        <div class="m-label">{m.label}</div>
        <div class="m-value mono">{m.shown ?? 'Not added'}</div>
      </div>
      {#if m.value}
        <Pill tone="forest">Verified</Pill>
        {#if linkedCount > 1}
          <button type="button" class="ghost-sm" disabled={busy} onclick={() => remove(m.kind)}>
            Remove
          </button>
        {/if}
      {:else if adding !== m.kind}
        <button type="button" class="ghost-sm" onclick={() => start(m.kind)}>
          + Add {m.kind === 'email' ? 'email' : 'mobile'}
        </button>
      {/if}
    </div>

    {#if adding === m.kind}
      <div class="add-panel">
        {#if !pendingIdentifier}
          <label class="add-field">
            <span>{m.kind === 'email' ? 'Email address' : 'Mobile number'}</span>
            <input
              class="s-input"
              type={m.kind === 'email' ? 'email' : 'tel'}
              autocomplete={m.kind === 'email' ? 'email' : 'tel'}
              inputmode={m.kind === 'email' ? 'email' : 'tel'}
              placeholder={m.kind === 'email' ? 'you@example.com' : '(571) 555-0123'}
              bind:value={entered}
              onkeydown={(e) => onEnter(e, sendCode)}
            />
          </label>
          <div class="add-actions">
            <button type="button" class="primary-sm" disabled={busy} onclick={sendCode}>
              {busy ? 'Sending…' : m.kind === 'email' ? 'Email me a code' : 'Text me a code'}
            </button>
            <button type="button" class="ghost-sm" onclick={cancel}>Cancel</button>
          </div>
        {:else}
          <label class="add-field">
            <span>
              6-digit code sent to {m.kind === 'phone' ? formatPhone(pendingIdentifier) : pendingIdentifier}
            </span>
            <input
              class="s-input mono code"
              type="text"
              autocomplete="one-time-code"
              inputmode="numeric"
              maxlength="7"
              bind:value={code}
              onkeydown={(e) => onEnter(e, verify)}
            />
          </label>
          <div class="add-actions">
            <button type="button" class="primary-sm" disabled={busy} onclick={verify}>
              {busy ? 'Checking…' : 'Verify'}
            </button>
            <button type="button" class="ghost-sm" disabled={busy} onclick={sendCode}>Resend</button>
            <button type="button" class="ghost-sm" onclick={cancel}>Cancel</button>
          </div>
        {/if}
      </div>
    {/if}
  {/each}

  {#if error}
    <p class="msg err" role="alert">{error}</p>
  {:else if notice}
    <p class="msg ok" role="status" aria-live="polite">{notice}</p>
  {/if}
</div>

<style>
  .methods {
    display: grid;
    gap: 10px;
  }
  .method-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--color-rule, #e3dccb);
    border-radius: 6px;
  }
  .m-text {
    flex: 1;
    min-width: 0;
  }
  .m-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-ink-muted, #6b6457);
  }
  .m-value {
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  .add-panel {
    display: grid;
    gap: 8px;
    padding: 12px;
    background: var(--color-cream-2, #f3ecdc);
    border-radius: 6px;
  }
  .add-field {
    display: grid;
    gap: 4px;
    font-size: 13px;
  }
  .code {
    font-size: 20px;
    letter-spacing: 0.3em;
  }
  .add-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .ghost-sm,
  .primary-sm {
    min-height: 48px;
    padding: 0 14px;
    border-radius: 6px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .ghost-sm {
    background: transparent;
    border: 1px solid var(--color-rule, #e3dccb);
    color: inherit;
  }
  .primary-sm {
    background: var(--color-forest, #1f5e3a);
    border: 1px solid var(--color-forest, #1f5e3a);
    color: #fff;
  }
  .msg {
    margin: 0;
    font-size: 13px;
  }
  .err {
    color: var(--color-rust, #a3402b);
  }
  .ok {
    color: var(--color-forest, #1f5e3a);
  }
</style>
