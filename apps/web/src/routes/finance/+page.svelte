<script lang="ts">
  import { invalidateAll } from '$app/navigation';
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
  import { formatCalendarDate, ymdInZone } from '$lib/prefs';

  const { data } = $props();

  const profit = $derived(data.profit);
  const rate = $derived(profit.labourRateCentsPerHour);
  const q = (extra: Record<string, string> = {}) =>
    '?' + new URLSearchParams({ year: String(data.year), ...extra }).toString();

  function day(ms: number): string {
    return formatCalendarDate(ymdInZone(ms, data.timeZone), 'date');
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
      rowError = body.error ?? 'That did not save. Try again.';
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
      rateError = 'Type an amount like 15.00, or leave it empty.';
      return;
    }
    const res = await fetch('/api/finance/labour-rate', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ centsPerHour: cents })
    });
    if (!res.ok) {
      rateError = 'That rate did not save. Try again.';
      return;
    }
    rateSaved = true;
    await invalidateAll();
  }
</script>

<svelte:head><title>Money · CropCard</title></svelte:head>

<div class="fin-page">
  <header class="fin-header">
    <div>
      <Kicker>Money · owner only</Kicker>
      <h1 class="serif">Money for {data.year}.</h1>
      <p class="fin-lede">
        What came in and went out, and what each crop and animal group cost you. Only you see this
        page. Helpers never see money.
      </p>
    </div>
    {#if data.canWrite}
      <div class="fin-actions">
        <a class="fin-primary" href="/finance/new{q({ kind: 'expense' })}">Add expense</a>
        <a class="fin-ghost" href="/finance/new{q({ kind: 'income' })}">Add income</a>
      </div>
    {/if}
  </header>

  <nav class="years" aria-label="Season">
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
    <h2 id="cash-title">Cash this season</h2>
    <dl class="cash">
      <div>
        <dt>Income</dt>
        <dd class="fin-money">{formatMoney(profit.cash.incomeCents)}</dd>
      </div>
      <div>
        <dt>Expenses</dt>
        <dd class="fin-money">{formatMoney(profit.cash.expenseCents)}</dd>
      </div>
      <div>
        <dt>Net cash</dt>
        <dd class="fin-money" data-testid="net-cash">{formatMoney(profit.cash.netCents)}</dd>
      </div>
    </dl>
    {#if profit.lotPurchaseCents > 0}
      <p class="fin-help">
        {formatMoney(profit.lotPurchaseCents)} of the expenses bought stock. Those lots count toward each
        crop or animal only as they are used, so nothing is counted twice.
      </p>
    {/if}
    <div class="fin-actions links">
      <a class="fin-ghost" href="/finance/profit/{data.year}">Season profit card</a>
      <a class="fin-ghost" href="/api/finance/export.csv{q()}" download>Download CSV</a>
    </div>
  </section>

  <section class="fin-panel" aria-labelledby="ent-title">
    <h2 id="ent-title">By crop, animal and Area</h2>
    <p class="fin-help">
      Inputs used come from your stock records times what each lot cost
      <Provenance source="data" compact />. Labour is an estimate from time logged on tasks.
    </p>
    {#if profit.enterprises.length === 0 && !hasUnallocated(profit)}
      <p class="empty">Nothing recorded for {data.year} yet.</p>
    {:else}
      <ul class="enterprises">
        {#each profit.enterprises as e (e.key)}
          <li class="ent">
            <h3>{e.label}</h3>
            <dl>
              <div>
                <dt>Income</dt>
                <dd class="fin-money">{formatMoney(e.incomeCents)}</dd>
              </div>
              <div>
                <dt>Direct costs</dt>
                <dd class="fin-money">{formatMoney(e.directExpenseCents)}</dd>
              </div>
              <div>
                <dt>Inputs used</dt>
                <dd>
                  {inputCostText(e)}{#if e.includesAreaInputs}<span class="fin-help">
                      Some sprays or feed were not tied to one planting.</span
                    >{/if}
                </dd>
              </div>
              <div>
                <dt>Labour</dt>
                <dd>{labourText(e, rate)}</dd>
              </div>
              <div class="net">
                <dt>{netLabel(e)}</dt>
                <dd class="fin-money">{formatMoney(e.netCents)}</dd>
              </div>
              {#if e.netAfterLabourCents !== null}
                <div>
                  <dt>Net after labour estimate</dt>
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
                <dt>Income</dt>
                <dd class="fin-money">{formatMoney(profit.unallocated.incomeCents)}</dd>
              </div>
              <div>
                <dt>Direct costs</dt>
                <dd class="fin-money">{formatMoney(profit.unallocated.directExpenseCents)}</dd>
              </div>
              {#if profit.unallocated.labourMinutes > 0}
                <div>
                  <dt>Time logged</dt>
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
      <h2 id="rate-title">Labour rate</h2>
      <form class="rate" onsubmit={saveRate}>
        <label class="fin-label">
          Dollars an hour, one rate for everyone
          <input
            class="fin-input"
            inputmode="decimal"
            autocomplete="off"
            placeholder="Not set"
            bind:value={rateText}
          />
        </label>
        <button class="fin-ghost" type="submit">Save rate</button>
      </form>
      <p class="fin-help">
        {data.labourRateCents === null
          ? 'Labour rate not set. Hours still show; cost does not.'
          : 'Labour cost is an estimate: time logged times this rate.'}
      </p>
      {#if rateError}<p class="fin-error" role="alert">{rateError}</p>{/if}
      {#if rateSaved}<p class="fin-help" role="status">Rate saved.</p>{/if}
    </section>
  {/if}

  <section class="fin-panel" aria-labelledby="entries-title">
    <h2 id="entries-title">{data.showDeleted ? 'Deleted entries' : 'Entries'}</h2>
    <div class="fin-segment" role="group" aria-label="Which entries">
      <a class="fin-ghost" class:on={!data.showDeleted} href={q()}>Entries</a>
      <a class="fin-ghost" class:on={data.showDeleted} href={q({ show: 'deleted' })}>Deleted</a>
    </div>
    {#if rowError}<p class="fin-error" role="alert">{rowError}</p>{/if}
    {#if data.entries.length === 0}
      <p class="empty">
        {data.showDeleted ? 'No deleted entries.' : `No entries for ${data.year} yet.`}
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
                    onclick={() => act(e.id, 'restore')}>Restore</button
                  >
                {:else}
                  <a class="fin-ghost" href="/finance/entries/{e.id}">Edit</a>
                  <button
                    class="fin-danger"
                    type="button"
                    disabled={busy === e.id}
                    onclick={() => act(e.id, 'delete')}>Delete</button
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
