<script lang="ts">
  import { untrack } from 'svelte';
  import { Phone, Plus, X } from 'lucide-svelte';
  import {
    ADD_POISON_CONTROL_INTENT,
    MAX_EMERGENCY_CONTACTS,
    POISON_CONTROL_CONTACT,
    hasPoisonControl,
    isBlankRow,
    type ContactRowInput
  } from '$lib/farm/emergencyContacts';

  interface Props {
    initial: readonly ContactRowInput[];
    error?: string | null;
  }

  const { initial, error = null }: Props = $props();

  let nextId = 0;
  type Row = ContactRowInput & { id: number };
  const toRow = (r: ContactRowInput): Row => ({
    id: nextId++,
    name: r.name,
    role: r.role,
    phone: r.phone
  });

  let rows = $state<Row[]>(untrack(() => initial.map(toRow)));

  const filledCount = $derived(rows.filter((r) => !isBlankRow(r)).length);
  const full = $derived(rows.length >= MAX_EMERGENCY_CONTACTS);
  const showPoison = $derived(!hasPoisonControl(rows) && filledCount < MAX_EMERGENCY_CONTACTS);

  function addRow() {
    if (full) return;
    rows.push(toRow({ name: '', role: '', phone: '' }));
  }

  function removeRow(id: number) {
    rows = rows.filter((r) => r.id !== id);
  }
</script>

<input type="hidden" name="contactsPresent" value="1" />

{#if error}
  <p class="error" role="alert">{error}</p>
{/if}

{#if rows.length === 0}
  <p class="empty">
    No contacts yet. Anyone reading your Farm Map Card will see these numbers first.
  </p>
{/if}

<ol class="rows" aria-label="Emergency contacts">
  {#each rows as row, i (row.id)}
    <li class="row">
      <label class="field">
        <span>Name</span>
        <input
          class="s-input"
          name="contactName"
          autocomplete="off"
          maxlength="60"
          bind:value={row.name}
          aria-label="Contact {i + 1} name"
        />
      </label>
      <label class="field">
        <span>Role</span>
        <input
          class="s-input"
          name="contactRole"
          autocomplete="off"
          maxlength="60"
          placeholder="Vet, neighbor, co-op"
          bind:value={row.role}
          aria-label="Contact {i + 1} role"
        />
      </label>
      <label class="field">
        <span>Phone</span>
        <input
          class="s-input mono"
          name="contactPhone"
          type="tel"
          inputmode="tel"
          autocomplete="off"
          maxlength="30"
          bind:value={row.phone}
          aria-label="Contact {i + 1} phone"
        />
      </label>
      <button
        type="button"
        class="remove"
        onclick={() => removeRow(row.id)}
        aria-label="Remove contact {i + 1}"
      >
        <X size={16} />
      </button>
    </li>
  {/each}
</ol>

<div class="actions">
  {#if showPoison}
    <button type="submit" class="suggest" name="intent" value={ADD_POISON_CONTROL_INTENT}>
      <Phone size={15} /> Add {POISON_CONTROL_CONTACT.name} ({POISON_CONTROL_CONTACT.phone})
    </button>
  {/if}
  <button type="button" class="add" onclick={addRow} disabled={full}>
    <Plus size={15} /> Add a contact
  </button>
</div>
<p class="hint">
  Up to {MAX_EMERGENCY_CONTACTS} contacts. {POISON_CONTROL_CONTACT.phone} is the national US Poison Help
  line, open all day, every day. Tap Save changes to keep edits.
</p>

<style>
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) 48px;
    gap: 8px;
    align-items: end;
  }
  .field {
    display: grid;
    gap: 4px;
    min-width: 0;
    font-size: 12px;
    color: var(--color-ink-soft);
  }
  .s-input {
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    padding: 8px 10px;
    min-height: 48px;
    border-radius: var(--radius-input, 6px);
    font-size: 15px;
    font-family: inherit;
    width: 100%;
    box-sizing: border-box;
  }
  .s-input.mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .s-input:focus {
    outline: none;
    border-color: var(--color-forest-deep);
    box-shadow: 0 0 0 2px rgba(44, 82, 55, 0.15);
  }
  .remove {
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    color: var(--color-ink-soft);
    cursor: pointer;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
  .suggest,
  .add {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 48px;
    padding: 0 14px;
    border-radius: var(--radius-input, 6px);
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    max-width: 100%;
    text-align: left;
  }
  .suggest {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: 0;
  }
  .add {
    background: var(--color-paper);
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
  }
  .add:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .hint,
  .empty {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--color-ink-soft);
  }
  .empty {
    margin: 0 0 8px;
  }
  .error {
    background: var(--pill-rust-bg);
    border: 1px solid var(--pill-rust-bd);
    color: var(--pill-rust-fg);
    padding: 10px 14px;
    border-radius: var(--radius-input);
    margin: 0 0 12px;
  }
  @media (max-width: 640px) {
    .row {
      grid-template-columns: minmax(0, 1fr) 48px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--color-divider-soft, var(--color-divider));
    }
    .field {
      grid-column: 1 / 2;
    }
    .remove {
      grid-column: 2;
      grid-row: 1;
    }
  }
</style>
