<script lang="ts">
  import { fmt } from '$lib/prefsState.svelte';
  import { invalidateAll } from '$app/navigation';
  import { createT } from '$lib/i18n';
  import '$lib/components/finance/finance.css';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { categoryLabel } from '$lib/finance/categories';
  import { formatMoney, centsToInput, parseMoneyInput } from '$lib/finance/money';
  import {
    formatMinutes,
    hasUnallocated,
    inputCostText,
    labourText,
    netLabel
  } from '$lib/finance/format';
  import { NOT_TIED_LABEL } from '$lib/finance/profit';
  import { ymdInZone } from '$lib/prefs';

  const { data } = $props();
  const tr = $derived(createT(data.locale));

  const profit = $derived(data.profit);
  const rate = $derived(profit.labourRateCentsPerHour);
  const q = (extra: Record<string, string> = {}) =>
    '?' + new URLSearchParams({ year: String(data.year), ...extra }).toString();

  function day(ms: number): string {
    return fmt.day(ymdInZone(ms, data.timeZone), 'date');
  }

  let busy = $state<string | null>(null);
  let rowError = $state<string | null>(null);

  async function act(id: string, how: 'delete' | 'restore') {
    busy = id;
    rowError = null;
    const res = await fetch(
      how === 'delete'
        ? `/api/finance/entries/${encodeURIComponent(id)}`
        : `/api/finance/entries/${encodeURIComponent(id)}/restore`,
      { method: how === 'delete' ? 'DELETE' : 'POST' }
    );
    busy = null;
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      rowError = body.error ?? tr('finance.errSave');
      return;
    }
    await invalidateAll();
  }

  let rateText = $derived(centsToInput(data.labourRateCents));
  let rateError = $state<string | null>(null);
  let rateSaved = $state(false);

  async function saveRate(e: SubmitEvent) {
    e.preventDefault();
    rateError = null;
    rateSaved = false;
    const text = rateText.trim();
    const cents = text === '' ? null : parseMoneyInput(text);
    if (text !== '' && cents === null) {
      rateError = tr('finance.rate.errType');
      return;
    }
    const res = await fetch('/api/finance/labour-rate', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ centsPerHour: cents })
    });
    if (!res.ok) {
      rateError = tr('finance.rate.errSave');
      return;
    }
    rateSaved = true;
    await invalidateAll();
  }
</script>

<svelte:head><title>{tr('finance.pageTitle')}</title></svelte:head>

<div class="fin-page">
  <header class="fin-header">
    <div>
      <Kicker>{tr('finance.kicker')}</Kicker>
      <h1 class="serif">{tr('finance.h1', { year: data.year })}</h1>
      <p class="fin-lede">
        {tr('finance.lede')}
      </p>
    </div>
    {#if data.canWrite}
      <div class="fin-actions">
        <a class="fin-primary" href="/finance/new{q({ kind: 'expense' })}"
          >{tr('finance.addExpense')}</a
        >
        <a class="fin-ghost" href="/finance/new{q({ kind: 'income' })}">{tr('finance.addIncome')}</a
        >
      </div>
    {/if}
  </header>

  <nav class="years" aria-label={tr('finance.seasonNav')}>
    {#each data.years as y (y)}
      <a
        class="fin-ghost"
        class:on={y === data.year}
        aria-current={y === data.year ? 'page' : undefined}
        href="?year={y}">{y}</a
      >
    {/each}
  </nav>

  <section class="fin-panel" aria-labelledby="cash-title">
    <h2 id="cash-title">{tr('finance.cash.title')}</h2>
    <dl class="cash">
      <div>
        <dt>{tr('finance.cash.income')}</dt>
        <dd class="fin-money">{formatMoney(profit.cash.incomeCents)}</dd>
      </div>
      <div>
        <dt>{tr('finance.cash.expenses')}</dt>
        <dd class="fin-money">{formatMoney(profit.cash.expenseCents)}</dd>
      </div>
      <div>
        <dt>{tr('finance.cash.net')}</dt>
        <dd class="fin-money" data-testid="net-cash">{formatMoney(profit.cash.netCents)}</dd>
      </div>
    </dl>
    {#if profit.lotPurchaseCents > 0}
      <p class="fin-help">
        {tr('finance.lotPurchase', { amount: formatMoney(profit.lotPurchaseCents) })}
      </p>
    {/if}
    <div class="fin-actions links">
      <a class="fin-ghost" href="/finance/profit/{data.year}">{tr('finance.profitCard')}</a>
      <a class="fin-ghost" href="/api/finance/export.csv{q()}" download
        >{tr('finance.downloadCsv')}</a
      >
    </div>
  </section>

  <section class="fin-panel" aria-labelledby="ent-title">
    <h2 id="ent-title">{tr('finance.ent.title')}</h2>
    <p class="fin-help">
      {tr('finance.ent.help1')}
      <Provenance source="data" compact />{tr('finance.ent.help2')}
    </p>
    {#if profit.enterprises.length === 0 && !hasUnallocated(profit)}
      <p class="empty">{tr('finance.ent.empty', { year: data.year })}</p>
    {:else}
      <ul class="enterprises">
        {#each profit.enterprises as e (e.key)}
          <li class="ent">
            <h3>{e.label}</h3>
            <dl>
              <div>
                <dt>{tr('finance.ent.income')}</dt>
                <dd class="fin-money">{formatMoney(e.incomeCents)}</dd>
              </div>
              <div>
                <dt>{tr('finance.ent.direct')}</dt>
                <dd class="fin-money">{formatMoney(e.directExpenseCents)}</dd>
              </div>
              <div>
                <dt>{tr('finance.ent.inputs')}</dt>
                <dd>
                  {inputCostText(e)}{#if e.includesAreaInputs}<span class="fin-help">
                      {tr('finance.ent.notTied')}</span
                    >{/if}
                </dd>
              </div>
              <div>
                <dt>{tr('finance.ent.labour')}</dt>
                <dd>{labourText(e, rate)}</dd>
              </div>
              <div class="net">
                <dt>{netLabel(e)}</dt>
                <dd class="fin-money">{formatMoney(e.netCents)}</dd>
              </div>
              {#if e.netAfterLabourCents !== null}
                <div>
                  <dt>{tr('finance.ent.netAfter')}</dt>
                  <dd class="fin-money">{formatMoney(e.netAfterLabourCents)}</dd>
                </div>
              {/if}
            </dl>
          </li>
        {/each}
        {#if hasUnallocated(profit)}
          <li class="ent">
            <h3>{NOT_TIED_LABEL}</h3>
            <dl>
              <div>
                <dt>{tr('finance.ent.income')}</dt>
                <dd class="fin-money">{formatMoney(profit.unallocated.incomeCents)}</dd>
              </div>
              <div>
                <dt>{tr('finance.ent.direct')}</dt>
                <dd class="fin-money">{formatMoney(profit.unallocated.directExpenseCents)}</dd>
              </div>
              {#if profit.unallocated.labourMinutes > 0}
                <div>
                  <dt>{tr('finance.ent.timeLogged')}</dt>
                  <dd>{formatMinutes(profit.unallocated.labourMinutes)}</dd>
                </div>
              {/if}
            </dl>
          </li>
        {/if}
      </ul>
    {/if}
  </section>

  {#if data.canWrite}
    <section class="fin-panel" aria-labelledby="rate-title">
      <h2 id="rate-title">{tr('finance.rate.title')}</h2>
      <form class="rate" onsubmit={saveRate}>
        <label class="fin-label">
          {tr('finance.rate.label')}
          <input
            class="fin-input"
            inputmode="decimal"
            autocomplete="off"
            placeholder={tr('finance.rate.notSet')}
            bind:value={rateText}
          />
        </label>
        <button class="fin-ghost" type="submit">{tr('finance.rate.save')}</button>
      </form>
      <p class="fin-help">
        {data.labourRateCents === null ? tr('finance.rate.helpUnset') : tr('finance.rate.helpSet')}
      </p>
      {#if rateError}<p class="fin-error" role="alert">{rateError}</p>{/if}
      {#if rateSaved}<p class="fin-help" role="status">{tr('finance.rate.saved')}</p>{/if}
    </section>
  {/if}

  <section class="fin-panel" aria-labelledby="entries-title">
    <h2 id="entries-title">
      {data.showDeleted ? tr('finance.deletedEntries') : tr('finance.entries')}
    </h2>
    <div class="fin-segment" role="group" aria-label={tr('finance.which')}>
      <a class="fin-ghost" class:on={!data.showDeleted} href={q()}>{tr('finance.entries')}</a>
      <a class="fin-ghost" class:on={data.showDeleted} href={q({ show: 'deleted' })}
        >{tr('finance.deleted')}</a
      >
    </div>
    {#if rowError}<p class="fin-error" role="alert">{rowError}</p>{/if}
    {#if data.entries.length === 0}
      <p class="empty">
        {data.showDeleted ? tr('finance.noDeleted') : tr('finance.noEntries', { year: data.year })}
      </p>
    {:else}
      <ul class="entries">
        {#each data.entries as e (e.id)}
          <li class="entry" data-testid="ledger-entry">
            <div class="entry-main">
              <span class="entry-date">{day(e.occurredAt)}</span>
              <span class="entry-what">
                <strong>{e.description ?? categoryLabel(e.category)}</strong>
                <span class="fin-help"
                  >{categoryLabel(e.category)}{e.linkedTo ? ` · ${e.linkedTo}` : ''}{e.quantity
                    ? ` · ${e.quantity} ${e.unit ?? ''}`
                    : ''}</span
                >
              </span>
              <span class="entry-amount fin-money {e.kind}">
                {e.kind === 'income' ? '+' : '-'}{formatMoney(e.amountCents)}
              </span>
            </div>
            {#if data.canWrite}
              <div class="entry-actions">
                {#if data.showDeleted}
                  <button
                    class="fin-ghost"
                    type="button"
                    disabled={busy === e.id}
                    onclick={() => act(e.id, 'restore')}>{tr('finance.restore')}</button
                  >
                {:else}
                  <a class="fin-ghost" href="/finance/entries/{e.id}">{tr('finance.edit')}</a>
                  <button
                    class="fin-danger"
                    type="button"
                    disabled={busy === e.id}
                    onclick={() => act(e.id, 'delete')}>{tr('finance.delete')}</button
                  >
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .years {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .years .on,
  .fin-segment .on {
    border-color: var(--color-forest);
    background: var(--pill-forest-bg);
  }
  .cash {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-3);
    margin: 0 0 var(--space-2);
  }
  .cash dt {
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .cash dd {
    margin: 0;
    font-size: 1.4rem;
    font-weight: 700;
  }
  .links {
    margin-top: var(--space-2);
  }
  .enterprises,
  .entries {
    list-style: none;
    margin: var(--space-2) 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .ent {
    border-top: 1px solid var(--color-divider);
    padding-top: var(--space-2);
  }
  .ent h3 {
    margin: 0 0 var(--space-1, 4px);
    font-size: 1rem;
  }
  .ent dl {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--space-2);
    margin: 0;
  }
  .ent dt {
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .ent dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .ent .net dd {
    font-weight: 700;
  }
  .rate {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .rate label {
    flex: 1 1 200px;
  }
  .entry {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    border-top: 1px solid var(--color-divider);
    padding-top: var(--space-2);
  }
  .entry-main {
    display: grid;
    grid-template-columns: 7.5rem minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    flex: 1 1 320px;
    min-width: 0;
  }
  .entry-what {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .entry-amount {
    font-weight: 700;
  }
  .entry-amount.income {
    color: var(--color-forest-deep);
  }
  .entry-actions {
    display: flex;
    gap: var(--space-2);
  }
  .empty {
    margin: var(--space-2) 0 0;
    color: var(--color-ink-soft);
  }
  @media (max-width: 640px) {
    .entry-main {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .entry-date {
      grid-column: 1 / -1;
      font-size: var(--font-size-caption);
      color: var(--color-ink-soft);
    }
    .entry-actions {
      width: 100%;
    }
    .entry-actions > * {
      flex: 1;
    }
  }
</style>
