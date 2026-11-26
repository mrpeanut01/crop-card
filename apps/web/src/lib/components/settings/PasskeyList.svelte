<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { formatInstant } from '$lib/prefs';
  import { currentPrefs } from '$lib/prefsState.svelte';
  import { PASSKEY_NAME_MAX } from '$lib/auth/apiSchemas';
  import { addPasskey, canAddPasskeyHere } from '$lib/client/passkey';

  /** Phase 38 Passkeys section on /settings/account. Lives inside the
   *  page's Save form, so every button is `type="button"` and the name
   *  field has no `name` attribute. */
  export interface PasskeyRow {
    id: string;
    name: string | null;
    provider: string | null;
    backedUp: boolean;
    createdAt: number;
    lastUsedAt: number | null;
  }

  interface Props {
    passkeys: PasskeyRow[];
    /** Signed in recently enough to add one (P38-5), not a demo. */
    canAdd: boolean;
    readOnly?: boolean;
  }

  const { passkeys: initial, canAdd, readOnly = false }: Props = $props();

  const tr = $derived(createT(page.data?.locale));

  let rows = $derived<PasskeyRow[]>(initial.map((r) => ({ ...r })));
  let deviceCan = $state(false);
  let busy = $state(false);
  let message = $state<{ text: string; error: boolean } | null>(null);
  let editing = $state<string | null>(null);
  let draft = $state('');
  let confirming = $state<string | null>(null);

  onMount(() => {
    void canAddPasskeyHere().then((v) => (deviceCan = v));
  });

  function label(r: PasskeyRow): string {
    return r.name || r.provider || tr('passkey.settings.defaultName');
  }

  function day(ms: number): string {
    return formatInstant(ms, currentPrefs(), 'date');
  }

  async function refresh(): Promise<void> {
    const res = await fetch('/api/account/passkeys', { credentials: 'same-origin' });
    if (res.ok) {
      const body = (await res.json()) as { passkeys: PasskeyRow[] };
      rows = body.passkeys;
    }
  }

  async function errorOf(res: Response): Promise<string> {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : tr('passkey.err.badRequest');
  }

  async function add(): Promise<void> {
    busy = true;
    message = null;
    try {
      const r = await addPasskey();
      if (r.ok) {
        await refresh();
        message = { text: tr('passkey.offer.done'), error: false };
      } else if (!r.cancelled) {
        message = { text: r.error ?? tr(r.errorKey ?? 'passkey.err.addFailed'), error: true };
      }
    } finally {
      busy = false;
    }
  }

  function startRename(r: PasskeyRow): void {
    editing = r.id;
    draft = r.name ?? '';
    confirming = null;
  }

  async function saveRename(id: string): Promise<void> {
    busy = true;
    message = null;
    try {
      const res = await fetch(`/api/account/passkeys/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: draft.trim() || null }),
        credentials: 'same-origin'
      });
      if (!res.ok) {
        message = { text: await errorOf(res), error: true };
        return;
      }
      rows = rows.map((r) => (r.id === id ? { ...r, name: draft.trim() || null } : r));
      editing = null;
    } finally {
      busy = false;
    }
  }

  async function remove(id: string): Promise<void> {
    busy = true;
    message = null;
    try {
      const res = await fetch(`/api/account/passkeys/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      if (!res.ok && res.status !== 404) {
        message = { text: await errorOf(res), error: true };
        return;
      }
      rows = rows.filter((r) => r.id !== id);
      confirming = null;
    } finally {
      busy = false;
    }
  }

  function renameKey(e: KeyboardEvent, id: string): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      void saveRename(id);
    } else if (e.key === 'Escape') {
      editing = null;
    }
  }
</script>

<div class="pk" data-testid="passkey-list">
  {#if rows.length === 0}
    <p class="empty">{tr('passkey.settings.empty')}</p>
  {:else}
    <ul>
      {#each rows as r (r.id)}
        <li>
          {#if editing === r.id}
            <label class="rename">
              <span class="lbl">{tr('passkey.settings.nameLabel')}</span>
              <input
                class="s-input"
                type="text"
                bind:value={draft}
                maxlength={PASSKEY_NAME_MAX}
                placeholder={r.provider ?? tr('passkey.settings.defaultName')}
                onkeydown={(e) => renameKey(e, r.id)}
              />
            </label>
            <div class="row-actions">
              <button type="button" class="ghost" onclick={() => saveRename(r.id)} disabled={busy}>
                {tr('passkey.settings.save')}
              </button>
              <button type="button" class="ghost" onclick={() => (editing = null)} disabled={busy}>
                {tr('passkey.settings.cancel')}
              </button>
            </div>
          {:else}
            <div class="meta">
              <strong>{label(r)}</strong>
              <span>{tr('passkey.settings.added', { date: day(r.createdAt) })}</span>
              <span>
                {r.lastUsedAt
                  ? tr('passkey.settings.lastUsed', { date: day(r.lastUsedAt) })
                  : tr('passkey.settings.neverUsed')}
              </span>
              {#if r.backedUp}<span>{tr('passkey.settings.synced')}</span>{/if}
            </div>
            {#if !readOnly}
              {#if confirming === r.id}
                <div class="confirm" role="group">
                  <p>{tr('passkey.settings.confirmRemove')}</p>
                  <div class="row-actions">
                    <button
                      type="button"
                      class="danger"
                      onclick={() => remove(r.id)}
                      disabled={busy}
                    >
                      {tr('passkey.settings.remove')}
                    </button>
                    <button
                      type="button"
                      class="ghost"
                      onclick={() => (confirming = null)}
                      disabled={busy}
                    >
                      {tr('passkey.settings.cancel')}
                    </button>
                  </div>
                </div>
              {:else}
                <div class="row-actions">
                  <button
                    type="button"
                    class="ghost"
                    onclick={() => startRename(r)}
                    disabled={busy}
                    aria-label={tr('passkey.settings.renameLabel', { name: label(r) })}
                  >
                    {tr('passkey.settings.rename')}
                  </button>
                  <button
                    type="button"
                    class="ghost"
                    onclick={() => {
                      confirming = r.id;
                      editing = null;
                    }}
                    disabled={busy}
                    aria-label={tr('passkey.settings.removeLabel', { name: label(r) })}
                  >
                    {tr('passkey.settings.remove')}
                  </button>
                </div>
              {/if}
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if !readOnly && deviceCan}
    {#if canAdd}
      <button type="button" class="primary" onclick={add} disabled={busy}>
        {tr('passkey.settings.add')}
      </button>
    {:else}
      <p class="note">{tr('passkey.err.reauth')}</p>
    {/if}
  {/if}

  {#if message}
    <p class={message.error ? 'msg error' : 'msg'} role={message.error ? 'alert' : 'status'}>
      {message.text}
    </p>
  {/if}

  <p class="note">{tr('passkey.settings.stolen')}</p>
</div>

<style>
  .pk {
    display: grid;
    gap: 0.75rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  li {
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    padding: 0.75rem;
    display: grid;
    gap: 0.5rem;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    align-items: baseline;
    color: var(--color-ink-soft);
    font-size: 0.875rem;
  }
  .meta strong {
    color: var(--color-ink);
    font-size: 1rem;
  }
  .rename {
    display: grid;
    gap: 0.25rem;
  }
  .lbl {
    font-size: 0.8125rem;
    color: var(--color-ink-soft);
  }
  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .confirm p {
    margin: 0 0 0.5rem;
  }
  button {
    min-height: var(--btn-height-min-tap, 48px);
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary {
    justify-self: start;
    background: var(--color-forest);
    color: var(--color-paper);
    border: none;
  }
  .ghost {
    background: transparent;
    color: var(--color-forest);
    border: 1px solid var(--color-divider);
  }
  .danger {
    background: var(--color-rust);
    color: var(--color-paper);
    border: none;
  }
  button:disabled {
    opacity: 0.7;
  }
  button:focus-visible {
    outline: 3px solid var(--color-forest);
    outline-offset: 2px;
  }
  .empty,
  .note,
  .msg {
    margin: 0;
    font-size: 0.875rem;
    color: var(--color-ink-soft);
  }
  .msg.error {
    color: var(--color-rust);
  }
</style>
