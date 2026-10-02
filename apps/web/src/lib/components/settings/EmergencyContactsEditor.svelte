<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
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

  const tr = $derived(createT(page.data?.locale));

  let nextId = 0;
  type Row = ContactRowInput & { id: number };
  const toRow = (r: ContactRowInput): Row => ({
    id: nextId++,
    name: r.name,
    role: r.role,
    phone: r.phone,
    type: r.type === 'vet' ? 'vet' : 'other'
  });

  let rows = $state<Row[]>(untrack(() => initial.map(toRow)));

  const filledCount = $derived(rows.filter((r) => !isBlankRow(r)).length);
  const full = $derived(rows.length >= MAX_EMERGENCY_CONTACTS);
  const showPoison = $derived(!hasPoisonControl(rows) && filledCount < MAX_EMERGENCY_CONTACTS);

  function addRow() {
    if (full) return;
    rows.push(toRow({ name: '', role: '', phone: '', type: 'other' }));
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
    {tr('settings.contacts.empty')}
  </p>
{/if}

<ol class="rows" aria-label={tr('settings.contacts.listAria')}>
  {#each rows as row, i (row.id)}
    <li class="row">
      <label class="field">
        <span>{tr('settings.contacts.name')}</span>
        <input
          class="s-input"
          name="contactName"
          autocomplete="off"
          maxlength="60"
          bind:value={row.name}
          aria-label={tr('settings.contacts.nameAria', { n: i + 1 })}
        />
      </label>
      <label class="field">
        <span>{tr('settings.contacts.role')}</span>
        <input
          class="s-input"
          name="contactRole"
          autocomplete="off"
          maxlength="60"
          placeholder={tr('settings.contacts.rolePlaceholder')}
          bind:value={row.role}
          aria-label={tr('settings.contacts.roleAria', { n: i + 1 })}
        />
      </label>
      <label class="field">
        <span>{tr('settings.contacts.type')}</span>
        <select
          class="s-input"
          name="contactType"
          bind:value={row.type}
          aria-label={tr('settings.contacts.typeAria', { n: i + 1 })}
        >
          <option value="other">{tr('settings.contacts.typeOther')}</option>
          <option value="vet">{tr('settings.contacts.typeVet')}</option>
        </select>
      </label>
      <label class="field">
        <span>{tr('settings.contacts.phone')}</span>
        <input
          class="s-input mono"
          name="contactPhone"
          type="tel"
          inputmode="tel"
          autocomplete="off"
          maxlength="30"
          bind:value={row.phone}
          aria-label={tr('settings.contacts.phoneAria', { n: i + 1 })}
        />
      </label>
      <button
        type="button"
        class="remove"
        onclick={() => removeRow(row.id)}
        aria-label={tr('settings.contacts.removeAria', { n: i + 1 })}
      >
        <X size={16} />
      </button>
    </li>
  {/each}
</ol>

<div class="actions">
  {#if showPoison}
    <button type="submit" class="suggest" name="intent" value={ADD_POISON_CONTROL_INTENT}>
      <Phone size={15} />
      {tr('settings.contacts.addPoison', {
        name: POISON_CONTROL_CONTACT.name,
        phone: POISON_CONTROL_CONTACT.phone
      })}
    </button>
  {/if}
  <button type="button" class="add" onclick={addRow} disabled={full}>
    <Plus size={15} />
    {tr('settings.contacts.add')}
  </button>
</div>
<p class="hint">
  {tr('settings.contacts.hint', {
    max: MAX_EMERGENCY_CONTACTS,
    phone: POISON_CONTROL_CONTACT.phone
  })}
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
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 0.6fr) minmax(0, 1fr) 48px;
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
