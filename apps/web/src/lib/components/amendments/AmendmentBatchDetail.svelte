<script lang="ts">
  /**
   * Phase 33C (M-41, M-42): one manure pile, compost batch or bought load.
   * Shows the carryover state the records give and the path to it, what
   * went in, bioassays and where it was spread. Owners, helpers and custom
   * operators add inputs and close or rename it; only the owner removes an
   * input. It reports facts and never says a batch is safe.
   */
  import { untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import CarryoverStateBadge from './CarryoverStateBadge.svelte';
  import BioassayForm from './BioassayForm.svelte';
  import BioassayGuide from './BioassayGuide.svelte';
  import { carryoverHref } from '$lib/farm/areaCarryover';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import InvSection from '$lib/components/inventory/InvSection.svelte';
  import { fmt } from '$lib/prefsState.svelte';
  import {
    SUPPLIER_STATEMENT_VALUES,
    batchKindLabel,
    supplierStatementLabel,
    type SupplierStatement
  } from '$lib/amendments/model';
  import type { AmendmentDetailPayload } from '$lib/server/amendmentDetail';

  type Props = Omit<AmendmentDetailPayload, 'type'>;
  const { batch, bioassays, spreads, options, canEdit, canDeleteInputs, today }: Props = $props();

  const locale = $derived(page.data?.locale);
  const tr = $derived(createT(locale));

  type AddKind = 'group' | 'animal' | 'batch' | 'stock-lot';
  const ADD_KINDS: readonly AddKind[] = ['group', 'animal', 'batch', 'stock-lot'];

  let addKind = $state<AddKind>('group');
  let addId = $state('');
  let addFrom = $state(untrack(() => today));
  let addTo = $state('');
  let addStatement = $state<SupplierStatement | ''>('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let closeOn = $state(untrack(() => today));
  let name = $state('');
  let notes = $state('');
  let supplier = $state('');
  let statement = $state<SupplierStatement | ''>('');

  // Only a stored value that changed resets its field, so a reload after
  // another action keeps what was typed but not yet saved.
  let synced: { name?: string; notes?: string; supplier?: string; statement?: string } = {};
  $effect.pre(() => {
    const stored = {
      name: batch.name,
      notes: batch.notes ?? '',
      supplier: batch.supplier ?? '',
      statement: batch.supplierStatement ?? ''
    };
    untrack(() => {
      if (stored.name !== synced.name) name = stored.name;
      if (stored.notes !== synced.notes) notes = stored.notes;
      if (stored.supplier !== synced.supplier) supplier = stored.supplier;
      if (stored.statement !== synced.statement) statement = stored.statement as typeof statement;
      synced = stored;
    });
  });

  const choices = $derived(
    addKind === 'group'
      ? options.groups
      : addKind === 'animal'
        ? options.animals
        : addKind === 'batch'
          ? options.batches
          : options.lots
  );
  const isHome = $derived(batch.origin === 'on-farm');
  const isOpen = $derived(batch.closedAt === null);

  async function send(url: string, method: string, body?: unknown): Promise<boolean> {
    error = null;
    busy = true;
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        error =
          data?.message ??
          data?.issues?.[0]?.message ??
          (res.status === 403 ? tr('amend.err.noPermission') : tr('amend.err.notSaved'));
        return false;
      }
      await invalidateAll();
      return true;
    } catch {
      error = tr('amend.err.unreachable');
      return false;
    } finally {
      busy = false;
    }
  }

  async function addInput(e: SubmitEvent) {
    e.preventDefault();
    if (!addId) {
      error = tr('amend.err.pickInput');
      return;
    }
    const ok = await send(`/api/amendments/batches/${batch.id}/inputs`, 'POST', {
      inputType: addKind,
      inputId: addId,
      from: addFrom,
      ...(addTo && (addKind === 'group' || addKind === 'animal') ? { to: addTo } : {}),
      ...(addKind === 'stock-lot' && addStatement ? { supplierStatement: addStatement } : {})
    });
    if (ok) {
      addId = '';
      addTo = '';
      addStatement = '';
    }
  }

  function removeInput(inputId: string) {
    return send(`/api/amendments/batches/${batch.id}/inputs/${inputId}`, 'DELETE');
  }

  function removeTest(id: string) {
    return send(`/api/amendments/bioassays/${encodeURIComponent(id)}`, 'DELETE');
  }

  function patch(body: Record<string, unknown>) {
    return send(`/api/amendments/batches/${batch.id}`, 'PATCH', body);
  }

  function saveDetails(e: SubmitEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { name, notes };
    if (!isHome) {
      body.supplier = supplier;
      body.supplierStatement = statement || null;
    }
    return patch(body);
  }

  function inputDates(i: Props['batch']['inputs'][number]): string {
    if (i.inputType === 'animal' || i.inputType === 'group') {
      const end = i.toAt === null ? tr('amend.dates.stillCollecting') : fmt.day(i.toAt - 1);
      return tr('amend.dates.range', { from: fmt.day(i.fromAt), to: end });
    }
    return tr('amend.dates.added', { date: fmt.day(i.fromAt) });
  }

  function inputKindLabel(kind: Props['batch']['inputs'][number]['inputType']): string {
    return tr(`amend.inputKind.${kind}`);
  }
</script>

<header class="detail-header">
  <span class="kicker">{batchKindLabel(batch.kind, locale)}</span>
  <h1 class="serif">{batch.name}</h1>
  <p class="sub">
    {isHome
      ? tr('amend.header.madeHere')
      : batch.supplier
        ? tr('amend.header.boughtFrom', { supplier: batch.supplier })
        : tr('amend.header.bought')} · {tr('amend.header.started', {
      date: fmt.day(batch.startedAt)
    })}{batch.closedAt
      ? ` · ${tr('amend.header.closed', { date: fmt.day(batch.closedAt - 1) })}`
      : ''}
  </p>
</header>

{#if error}
  <p class="error" role="alert">{error}</p>
{/if}

<InvSection title={tr('amend.sec.carryover.title')} kicker={tr('amend.sec.carryover.kicker')}>
  <div class="state-row">
    <CarryoverStateBadge state={batch.state} />
    <Provenance source="data" detail={tr('amend.prov.yourRecords')} />
  </div>
  <p class="state-label" data-testid="carryover-label">{batch.stateLabel}</p>
  {#if batch.paths.length}
    <ul class="paths" data-testid="carryover-paths">
      {#each batch.paths as path, i (i)}
        <li class={path.state}>
          <span lang="en" data-english-only="safety">{path.sentence}</span>
        </li>
      {/each}
    </ul>
    {#if batch.morePaths > 0}
      <p class="muted">{tr('amend.morePaths', { count: batch.morePaths })}</p>
    {/if}
  {/if}
  {#if batch.advice}
    <p class="advice" data-testid="carryover-advice">
      <span lang="en" data-english-only="safety">{batch.advice}</span>
    </p>
  {/if}
  {#each batch.standingNotes as note (note)}
    <p class="muted note">{note}</p>
  {/each}
</InvSection>

{#if isHome}
  <InvSection title={tr('amend.sec.inputs.title')} kicker={tr('amend.sec.inputs.kicker')}>
    {#if batch.inputs.length === 0}
      <p class="muted">{tr('amend.inputs.none')}</p>
    {:else}
      <ul class="inputs" data-testid="batch-inputs">
        {#each batch.inputs as input (input.id)}
          <li>
            <span class="input-main">
              <span class="input-label">{input.label}</span>
              <span class="muted">
                {inputKindLabel(input.inputType)} · {inputDates(input)}{input.supplierStatement
                  ? ` · ${supplierStatementLabel(input.supplierStatement, locale)}`
                  : ''}
              </span>
            </span>
            {#if canDeleteInputs}
              <button
                type="button"
                class="ghost"
                disabled={busy}
                onclick={() => removeInput(input.id)}
                aria-label={tr('amend.removeAria', { label: input.label })}
                >{tr('amend.remove')}</button
              >
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if canEdit && isOpen}
      <form class="add-input" onsubmit={addInput} data-testid="add-input-form">
        <label class="field">
          <span>{tr('amend.form.whatWentIn')}</span>
          <select bind:value={addKind} onchange={() => (addId = '')} data-testid="add-input-kind">
            {#each ADD_KINDS as value (value)}
              <option {value}>{tr(`amend.add.${value}`)}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>{tr('amend.form.whichOne')}</span>
          <select bind:value={addId} data-testid="add-input-choice">
            <option value="">{tr('amend.form.choose')}</option>
            {#each choices as c (c.id)}
              <option value={c.id}>{c.label}</option>
            {/each}
          </select>
        </label>
        {#if choices.length === 0}
          <p class="muted">{tr('amend.form.noneOfKind')}</p>
        {/if}
        <label class="field">
          <span>
            {addKind === 'group' || addKind === 'animal'
              ? tr('amend.form.collectingFrom')
              : tr('amend.form.addedOn')}
          </span>
          <input type="date" bind:value={addFrom} max={today} required />
        </label>
        {#if addKind === 'group' || addKind === 'animal'}
          <label class="field">
            <span>{tr('amend.form.lastDay')}</span>
            <input type="date" bind:value={addTo} max={today} min={addFrom} />
          </label>
        {/if}
        {#if addKind === 'stock-lot'}
          <label class="field">
            <span>{tr('amend.form.supplierSaid')}</span>
            <select bind:value={addStatement}>
              <option value="">{tr('amend.form.noAnswer')}</option>
              {#each SUPPLIER_STATEMENT_VALUES as v (v)}
                <option value={v}>{supplierStatementLabel(v, locale)}</option>
              {/each}
            </select>
          </label>
        {/if}
        <button type="submit" class="primary" disabled={busy}>{tr('amend.form.addToBatch')}</button>
      </form>
    {:else if canEdit && !isOpen}
      <p class="muted">{tr('amend.closedReopen')}</p>
    {/if}
  </InvSection>
{/if}

{#if canEdit}
  <InvSection title={tr('amend.sec.details.title')} kicker={tr('amend.sec.details.kicker')}>
    <form class="details" onsubmit={saveDetails}>
      <label class="field">
        <span>{tr('amend.name')}</span>
        <input type="text" bind:value={name} maxlength="80" required />
      </label>
      {#if !isHome}
        <label class="field">
          <span>{tr('amend.supplier')}</span>
          <input type="text" bind:value={supplier} maxlength="120" />
        </label>
        <label class="field">
          <span>{tr('amend.form.supplierSaid')}</span>
          <select bind:value={statement} data-testid="supplier-statement">
            <option value="">{tr('amend.form.noAnswer')}</option>
            {#each SUPPLIER_STATEMENT_VALUES as v (v)}
              <option value={v}>{supplierStatementLabel(v, locale)}</option>
            {/each}
          </select>
        </label>
      {/if}
      <label class="field">
        <span>{tr('amend.notes')}</span>
        <textarea bind:value={notes} maxlength="1000" rows="3"></textarea>
      </label>
      <button type="submit" class="primary" disabled={busy}>{tr('amend.saveDetails')}</button>
    </form>
    {#if isHome}
      <div class="close-row">
        {#if isOpen}
          <label class="field">
            <span>{tr('amend.closedOn')}</span>
            <input type="date" bind:value={closeOn} max={today} />
          </label>
          <button
            type="button"
            class="ghost"
            disabled={busy}
            onclick={() => patch({ closedOn: closeOn })}>{tr('amend.closeBatch')}</button
          >
        {:else}
          <button
            type="button"
            class="ghost"
            disabled={busy}
            onclick={() => patch({ closedOn: null })}>{tr('amend.reopenBatch')}</button
          >
        {/if}
      </div>
    {/if}
  </InvSection>
{/if}

<InvSection title={tr('amend.sec.tests.title')} kicker={tr('amend.sec.tests.kicker')}>
  {#if bioassays.length === 0}
    <p class="muted">{tr('amend.tests.none')}</p>
  {:else}
    <ul class="plain">
      {#each bioassays as b (b.id)}
        <li>
          {tr(b.result === 'damage' ? 'amend.tests.damage' : 'amend.tests.noDamage', {
            date: fmt.day(b.testedAt)
          })}
          {b.blockName
            ? tr('amend.tests.onBlock', { block: b.blockName })
            : tr('amend.tests.thisBatch')}{b.note ? `. ${b.note}` : ''}
          {#if canDeleteInputs}
            <button class="ghost" type="button" disabled={busy} onclick={() => removeTest(b.id)}>
              {tr('amend.tests.remove')}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if canEdit}
    <BioassayForm target={{ batchId: batch.id }} {today} onsaved={() => invalidateAll()} />
  {/if}
  <BioassayGuide />
</InvSection>

<InvSection title={tr('amend.sec.spread.title')} kicker={tr('amend.sec.spread.kicker')}>
  {#if spreads.length === 0}
    <p class="muted">{tr('amend.spread.none')}</p>
  {:else}
    <ul class="plain">
      {#each spreads as s (s.applicationId)}
        <li>
          <a class="spread-link" href={carryoverHref(s.blockId)}>{s.blockName}</a>, {fmt.day(
            s.occurredAt
          )}
        </li>
      {/each}
    </ul>
  {/if}
</InvSection>

<style>
  .spread-link {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
  }
  .detail-header {
    margin-bottom: 12px;
  }
  .kicker {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-ink-muted, #6a6f63);
  }
  h1 {
    margin: 2px 0;
    font-size: 1.4rem;
    color: var(--color-forest-deep, #1f3522);
    overflow-wrap: anywhere;
  }
  .sub,
  .muted {
    color: var(--color-ink-muted, #6a6f63);
    font-size: 0.9rem;
  }
  .sub {
    margin: 0;
  }
  .error {
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--pill-rust-bg, #f4d9cf);
    color: var(--pill-rust-fg, #7a2e14);
  }
  .state-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .state-label {
    font-weight: 600;
    margin: 8px 0 4px;
  }
  .paths {
    margin: 0;
    padding-left: 18px;
    line-height: 1.45;
  }
  .paths li {
    margin: 4px 0;
  }
  .paths li.may-carry {
    color: var(--pill-rust-fg, #7a2e14);
  }
  .advice {
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--pill-wheat-bg, #e8d9b5);
    line-height: 1.45;
  }
  .note {
    margin: 6px 0 0;
  }
  .inputs,
  .plain {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .inputs li {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    padding: 8px 0;
    border-bottom: 1px solid var(--color-divider, #e5e7e0);
  }
  .input-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .input-label {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  form {
    display: grid;
    gap: 10px;
    margin-top: 12px;
  }
  .field {
    display: grid;
    gap: 4px;
    font-size: 0.9rem;
    color: var(--color-forest-deep, #1f3522);
  }
  .field input,
  .field select,
  .field textarea {
    min-height: 48px;
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--color-divider, #e5e7e0);
    border-radius: 6px;
    background: var(--color-paper, #fff);
    font: inherit;
  }
  .close-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: end;
    margin-top: 12px;
  }
  .primary,
  .ghost {
    min-height: 48px;
    padding: 8px 16px;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }
  .primary {
    border: none;
    background: var(--color-forest, #1f5e3a);
    color: var(--color-cream, #fff8e1);
  }
  .ghost {
    border: 1px solid var(--color-forest, #1f5e3a);
    background: transparent;
    color: var(--color-forest-deep, #1f3522);
  }
  .primary:disabled,
  .ghost:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
