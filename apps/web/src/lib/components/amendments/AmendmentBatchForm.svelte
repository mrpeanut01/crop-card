<script lang="ts">
  /**
   * Phase 33C (M-36, M-41): start a manure pile, compost batch or bedding
   * pack, or record a bought load. Owners, helpers and custom operators.
   */
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import {
    BATCH_KINDS,
    SUPPLIER_STATEMENT_VALUES,
    batchKindLabel,
    supplierStatementLabel,
    type BatchKind,
    type SupplierStatement
  } from '$lib/amendments/model';

  interface Props {
    today: string;
    canSave: boolean;
  }

  const { today, canSave }: Props = $props();
  const locale = $derived(page.data?.locale);
  const tr = $derived(createT(locale));

  let kind = $state<BatchKind>('manure');
  let name = $state('');
  let origin = $state<'on-farm' | 'bought'>('on-farm');
  let startedOn = $state(untrack(() => today));
  let supplier = $state('');
  let statement = $state<SupplierStatement | ''>('');
  let notes = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    busy = true;
    try {
      const res = await fetch('/api/amendments/batches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          name,
          origin,
          startedOn,
          notes: notes || undefined,
          ...(origin === 'bought'
            ? { supplier: supplier || undefined, supplierStatement: statement || undefined }
            : {})
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        error =
          data?.message ??
          data?.issues?.[0]?.message ??
          (res.status === 403 ? tr('amend.new.inspectorErr') : tr('amend.err.notSaved'));
        return;
      }
      await goto(`/inventory/amendment/${encodeURIComponent(data.batch.id)}`);
    } catch {
      error = tr('amend.err.unreachable');
    } finally {
      busy = false;
    }
  }
</script>

{#if !canSave}
  <p class="note" role="note">{tr('amend.new.inspectorNote')}</p>
{:else}
  <form onsubmit={submit} data-testid="batch-form">
    <fieldset class="field">
      <legend>{tr('amend.new.origin')}</legend>
      <label class="choice">
        <input type="radio" bind:group={origin} value="on-farm" />
        {tr('amend.new.madeHere')}
      </label>
      <label class="choice">
        <input type="radio" bind:group={origin} value="bought" />
        {tr('amend.new.bought')}
      </label>
    </fieldset>
    <label class="field">
      <span>{tr('amend.new.kind')}</span>
      <select bind:value={kind}>
        {#each BATCH_KINDS as k (k)}
          <option value={k}>{batchKindLabel(k, locale)}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span>{tr('amend.name')}</span>
      <input
        type="text"
        bind:value={name}
        maxlength="80"
        required
        placeholder={origin === 'bought'
          ? tr('amend.new.placeholderBought')
          : tr('amend.new.placeholderHome')}
      />
    </label>
    <label class="field">
      <span>{origin === 'bought' ? tr('amend.new.arrivedOn') : tr('amend.new.startedOn')}</span>
      <input type="date" bind:value={startedOn} max={today} required />
    </label>
    {#if origin === 'bought'}
      <label class="field">
        <span>{tr('amend.supplier')}</span>
        <input type="text" bind:value={supplier} maxlength="120" />
      </label>
      <label class="field">
        <span>{tr('amend.new.supplierSaid')}</span>
        <select bind:value={statement} data-testid="supplier-statement">
          <option value="">{tr('amend.form.noAnswer')}</option>
          {#each SUPPLIER_STATEMENT_VALUES as v (v)}
            <option value={v}>{supplierStatementLabel(v, locale)}</option>
          {/each}
        </select>
      </label>
    {:else}
      <p class="hint">{tr('amend.new.hint')}</p>
    {/if}
    <label class="field">
      <span>{tr('amend.notes')}</span>
      <textarea bind:value={notes} maxlength="1000" rows="3"></textarea>
    </label>
    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
    <button type="submit" class="primary" disabled={busy}>{tr('amend.new.save')}</button>
  </form>
{/if}

<style>
  form {
    display: grid;
    gap: 12px;
    max-width: 560px;
  }
  .field {
    display: grid;
    gap: 4px;
    font-size: 0.9rem;
    color: var(--color-forest-deep, #1f3522);
    border: none;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
  legend {
    margin-bottom: 4px;
  }
  .choice {
    display: flex;
    gap: 8px;
    align-items: center;
    min-height: 48px;
  }
  .choice input {
    width: 22px;
    height: 22px;
  }
  .field input[type='text'],
  .field input[type='date'],
  .field select,
  .field textarea {
    min-height: 48px;
    box-sizing: border-box;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--color-divider, #e5e7e0);
    border-radius: 6px;
    background: var(--color-paper, #fff);
    font: inherit;
  }
  .hint,
  .note {
    color: var(--color-ink-muted, #6a6f63);
    margin: 0;
  }
  .error {
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--pill-rust-bg, #f4d9cf);
    color: var(--pill-rust-fg, #7a2e14);
  }
  .primary {
    min-height: 48px;
    border: none;
    border-radius: 6px;
    background: var(--color-forest, #1f5e3a);
    color: var(--color-cream, #fff8e1);
    font-weight: 600;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
  }
</style>
