<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { createT, type MessageKey } from '$lib/i18n';
  import UnitInput from '$lib/components/ui/UnitInput.svelte';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';
  import SetupSheet from '$lib/components/setup/SetupSheet.svelte';
  import SetupSoilTest from '$lib/components/setup/SetupSoilTest.svelte';
  import type { SetupSoilTestResult } from '$lib/fertility/soilTestForm';
  import DocumentAttach from '$lib/components/documents/DocumentAttach.svelte';
  import OrganicInputNotice from '$lib/components/organic/OrganicInputNotice.svelte';
  import { organicInputClass } from '$lib/organic/inputCompliance';
  import CarryoverConfirm from '$lib/components/amendments/CarryoverConfirm.svelte';
  import type { CarryoverConfirmBody } from '$lib/amendments/spreadPrompt';
  import { page } from '$app/state';
  import TaskCloseNote from '$lib/components/tasks/TaskCloseNote.svelte';
  import { recordCloseMessageKey, type RecordTaskCloseStatus } from '$lib/tasks/recordClose';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { formatRateText, formatStockQuantity } from '$lib/stock/units';
  import {
    FERTILITY_RATE_UNITS,
    nutrientsFromAnalysis,
    type Analysis
  } from '$lib/fertility/applicationMath';

  let { data } = $props();
  const tr = $derived(createT(data.locale));

  let blockId = $state(untrack(() => data.selectedBlockId));
  let year = $state(untrack(() => data.year));
  let busy = $state(false);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);
  // The page reloads after a save; the task's outcome rides on the URL.
  const savedTaskLine = $derived.by(() => {
    const status = page.url.searchParams.get('taskClose') as RecordTaskCloseStatus | null;
    const key = status ? recordCloseMessageKey({ taskId: '', status }) : null;
    return key ? tr(key) : null;
  });

  // Application form. Nothing is prefilled as a value (#738): a nutrient
  // the farmer leaves blank is saved as not known.
  const FLASH_KEY = 'cropcard.fertility.flash';
  let appSource = $state('');
  let appStockId = $state('');
  let appDate = $state(untrack(() => data.today));
  let appRate = $state<number | null>(null);
  let appUnit = $state<string>('lb-per-acre');
  let appUnitOther = $state('');
  let appN = $state<number | null>(null);
  let appP = $state<number | null>(null);
  let appK = $state<number | null>(null);
  let npkTyped = $state(false);
  let npkFromAnalysis = $state(false);
  let appBatch = $state('');
  let stockNotes = $state<string[]>([]);

  onMount(() => {
    try {
      const raw = sessionStorage.getItem(FLASH_KEY);
      if (raw) {
        sessionStorage.removeItem(FLASH_KEY);
        const notes = JSON.parse(raw) as unknown;
        if (Array.isArray(notes)) stockNotes = notes.filter((n) => typeof n === 'string');
      }
    } catch {
      /* storage can be blocked; the notes are a convenience */
    }
  });

  const pickedStock = $derived(data.fertilizerStock.find((i) => i.id === appStockId) ?? null);
  const analysisFor = $derived.by((): { label: string; analysis: Analysis } | null => {
    const byId = (id: string | null | undefined) =>
      id ? data.fertilizers.find((f) => f.id === id) : undefined;
    const typed = appSource.trim().toLowerCase();
    const plugin =
      byId(pickedStock?.pluginId) ??
      (typed
        ? data.fertilizers.find(
            (f) => f.id.toLowerCase() === typed || f.displayName.toLowerCase() === typed
          )
        : undefined);
    if (!plugin?.analysis) return null;
    const a = plugin.analysis;
    return { label: `${a.n}-${a.p}-${a.k}`, analysis: a };
  });
  const rateUnitCode = $derived(appUnit === 'other' ? appUnitOther.trim() : appUnit);
  const computedNpk = $derived(
    analysisFor ? nutrientsFromAnalysis(appRate, rateUnitCode, analysisFor.analysis) : null
  );

  $effect(() => {
    const c = computedNpk;
    if (untrack(() => npkTyped)) return;
    appN = c?.n ?? null;
    appP = c?.p ?? null;
    appK = c?.k ?? null;
    npkFromAnalysis = c !== null;
  });

  function pickStock() {
    const item = pickedStock;
    if (item) appSource = item.displayName;
  }

  function markNpkTyped() {
    npkTyped = true;
    npkFromAnalysis = false;
  }

  function occurredAtFor(ymd: string): number | undefined {
    if (!ymd || ymd === data.today) return undefined;
    const ms = new Date(`${ymd}T12:00`).getTime();
    return Number.isFinite(ms) ? Math.min(ms, Date.now()) : undefined;
  }
  let confirmFacts = $state<CarryoverConfirmBody | null>(null);

  // Credit form
  let creditSource = $state('cover-crop:crimson-clover-cover');
  let creditPlugin = $state('crimson-clover-cover');
  let creditN = $state<number | null>(null);
  let creditUseDefaults = $state(true);

  let soilSheetOpen = $state(false);

  const organicProducts = $derived.by(() => {
    const source = appSource.trim();
    if (!source) return [];
    const mark =
      (pickedStock?.pluginId ? data.fertilizerMarks[pickedStock.pluginId] : undefined) ??
      data.fertilizerMarks[source] ??
      Object.values(data.fertilizerMarks).find((m) => m.displayName === source);
    return [
      {
        name: mark?.displayName ?? source,
        inputClass: mark
          ? organicInputClass({ type: 'fertilizer', complianceFlags: mark.complianceFlags })
          : ('not-marked' as const)
      }
    ];
  });
  const UNIT_KEYS: Record<(typeof FERTILITY_RATE_UNITS)[number], MessageKey> = {
    'lb-per-acre': 'fert.unit.lb-per-acre',
    'oz-per-acre': 'fert.unit.oz-per-acre',
    'gal-per-acre': 'fert.unit.gal-per-acre',
    'qt-per-acre': 'fert.unit.qt-per-acre',
    'pt-per-acre': 'fert.unit.pt-per-acre',
    'fl-oz-per-acre': 'fert.unit.fl-oz-per-acre'
  };

  const rateUnit = $derived(fmt.unit('weightPerArea'));
  const npk = (v: number | null | undefined) =>
    v === null || v === undefined
      ? tr('fert.notKnown')
      : fmt.qty(v, 'weightPerArea', { digits: 0, bare: true });
  const perAc = (v: number) => fmt.qty(v, 'weightPerArea', { digits: 1, bare: true });
  const budgetCell = (v: number, unknown: number) =>
    unknown === 0
      ? perAc(v)
      : v > 0
        ? tr('fert.atLeast', { value: perAc(v) })
        : tr('fert.notKnown');

  async function reload(taskClose?: RecordTaskCloseStatus | null) {
    const url = new URL(window.location.href);
    url.searchParams.set('block', blockId);
    url.searchParams.set('year', String(year));
    url.searchParams.delete('taskClose');
    if (taskClose) {
      url.searchParams.delete('task');
      url.searchParams.set('taskClose', taskClose);
    }
    window.location.href = url.toString();
  }

  async function recordApplication(e: Event) {
    e.preventDefault();
    if (appRate === null || !Number.isFinite(appRate)) {
      error = tr('fert.err.rateRequired');
      return;
    }
    await postApplication(undefined);
  }

  async function postApplication(confirmCarryover: string | undefined) {
    busy = true;
    error = null;
    message = null;
    try {
      const res = await fetch('/api/fertility/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          blockId,
          source: appSource.trim(),
          ...(appStockId ? { stockItemId: appStockId } : {}),
          ...(occurredAtFor(appDate) !== undefined ? { occurredAt: occurredAtFor(appDate) } : {}),
          ratePerAcre: appRate,
          rateUnit: rateUnitCode,
          nLbPerAcre: appN,
          pLbPerAcre: appP,
          kLbPerAcre: appK,
          amendmentBatchId: appBatch || undefined,
          confirmCarryover,
          ...(data.taskContext ? { taskId: data.taskContext.id } : {})
        })
      });
      const out = await res.json();
      if (res.status === 409 && out.error === 'CARRYOVER_CONFIRM') {
        confirmFacts = out as CarryoverConfirmBody;
        return;
      }
      if (!res.ok) {
        error = out.message ?? out.error ?? tr('fert.errFailed');
        return;
      }
      confirmFacts = null;
      message = tr('fert.msgApp');
      const notes: string[] = Array.isArray(out.stock?.notes) ? out.stock.notes : [];
      if (notes.length) {
        try {
          sessionStorage.setItem(FLASH_KEY, JSON.stringify(notes));
        } catch {
          /* the notes are a convenience */
        }
      }
      reload(out.taskClose?.status ?? null);
    } catch (e2) {
      error = e2 instanceof Error ? e2.message : String(e2);
    } finally {
      busy = false;
    }
  }

  async function recordCredit(e: Event) {
    e.preventDefault();
    busy = true;
    error = null;
    try {
      const res = await fetch('/api/fertility/credits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          blockId,
          appliesToYear: year,
          source: creditSource,
          cropPluginId: creditPlugin || undefined,
          nLbPerAcre: creditN ?? undefined,
          useDefaults: creditUseDefaults
        })
      });
      const out = await res.json();
      if (!res.ok) {
        error = out.error ?? tr('fert.errFailed');
        return;
      }
      message = tr('fert.msgCredit');
      reload();
    } catch (e2) {
      error = e2 instanceof Error ? e2.message : String(e2);
    } finally {
      busy = false;
    }
  }

  let labReports = $state<Record<string, string | null>>({});

  function labReportOf(t: { id: string; documentId?: string | null }): string | null {
    return t.id in labReports ? labReports[t.id] : (t.documentId ?? null);
  }

  async function setLabReport(soilTestId: string, documentId: string | null): Promise<boolean> {
    error = null;
    message = null;
    try {
      const res = await fetch(`/api/fertility/soil-tests/${encodeURIComponent(soilTestId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId })
      });
      if (!res.ok) {
        error = tr('fert.errLabSave');
        return false;
      }
      labReports[soilTestId] = documentId;
      message = documentId ? tr('fert.msgLabAttached') : tr('fert.msgLabRemoved');
      return true;
    } catch {
      error = tr('fert.errLabOffline');
      return false;
    }
  }

  function onSoilTestSaved(r: SetupSoilTestResult) {
    soilSheetOpen = false;
    blockId = r.blockId;
    message = tr('fert.msgSoilSaved');
    reload();
  }
</script>

<h1>{tr('fert.title')}</h1>
<p class="lede">
  {tr('fert.lede')}
</p>

<form
  class="filter"
  onsubmit={(e) => {
    e.preventDefault();
    reload();
  }}
>
  <label>
    {tr('fert.block')}
    <select bind:value={blockId}>
      {#each data.blocks as b (b.id)}
        <option value={b.id}
          >{b.name}{b.acres ? ` — ${fmt.area(b.acres, { digits: 2 })}` : ''}</option
        >
      {/each}
    </select>
  </label>
  <label>
    {tr('fert.year')}
    <input type="number" min="1900" max="3000" bind:value={year} />
  </label>
  <button type="submit" class="primary">{tr('fert.load')}</button>
</form>

{#if data.budget}
  <section class="card budget">
    <h2>{tr('fert.budgetTitle', { year: data.budget.year })}</h2>
    <table>
      <thead>
        <tr>
          <th></th>
          <th>N ({rateUnit})</th>
          <th>{tr('inv.fert.p2o5')} ({rateUnit})</th>
          <th>{tr('inv.fert.k2o')} ({rateUnit})</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">{tr('fert.applications')}</th>
          <td>{budgetCell(data.budget.nDeliveredLbPerAcre, data.budget.nUnknownApplications)}</td>
          <td>{budgetCell(data.budget.pDeliveredLbPerAcre, data.budget.pUnknownApplications)}</td>
          <td>{budgetCell(data.budget.kDeliveredLbPerAcre, data.budget.kUnknownApplications)}</td>
        </tr>
        <tr>
          <th scope="row">{tr('fert.credits')}</th>
          <td>{perAc(data.budget.nCreditedLbPerAcre)}</td>
          <td>{perAc(data.budget.pCreditedLbPerAcre)}</td>
          <td>{perAc(data.budget.kCreditedLbPerAcre)}</td>
        </tr>
        <tr class="total">
          <th scope="row">{tr('fert.total')}</th>
          <td>{budgetCell(data.budget.totalNLbPerAcre, data.budget.nUnknownApplications)}</td>
          <td>{budgetCell(data.budget.totalPLbPerAcre, data.budget.pUnknownApplications)}</td>
          <td>{budgetCell(data.budget.totalKLbPerAcre, data.budget.kUnknownApplications)}</td>
        </tr>
      </tbody>
    </table>
    {#if data.budget.nUnknownApplications + data.budget.pUnknownApplications + data.budget.kUnknownApplications > 0}
      <p class="hint" data-testid="fertility-budget-unknown">{tr('fert.budgetUnknown')}</p>
    {/if}
  </section>
{/if}

{#if message}<p class="success">{message}</p>{/if}
{#each stockNotes as note, i (i)}
  <p class="success" role="status" data-testid="fertility-stock-note">{note}</p>
{/each}
{#if savedTaskLine}
  <p class="success" data-testid="task-close-note" role="status">{savedTaskLine}</p>
{/if}
{#if error}<p class="error">{error}</p>{/if}

<details class="card" open={!!data.taskContext}>
  <summary><h2>{tr('fert.recordApp')}</h2></summary>
  <form onsubmit={recordApplication}>
    <label
      >{tr('fert.date')}
      <input
        type="date"
        required
        max={data.today}
        bind:value={appDate}
        data-testid="fertility-date"
      /></label
    >
    {#if data.fertilizerStock.length}
      <label
        >{tr('fert.fromStock')}
        <select bind:value={appStockId} onchange={pickStock} data-testid="fertility-stock">
          <option value="">{tr('fert.fromStockNone')}</option>
          {#each data.fertilizerStock as item (item.id)}
            <option value={item.id}
              >{item.displayName} ({tr('fert.onHand', {
                amount: formatStockQuantity(item.onHand, item.defaultUnit, currentPrefs())
              })})</option
            >
          {/each}
        </select>
      </label>
    {/if}
    <label
      >{tr('fert.source')}
      <input
        type="text"
        required
        bind:value={appSource}
        placeholder={tr('fert.sourcePlaceholder')}
        list="fertilizer-plugins"
        data-testid="fertility-source"
      /></label
    >
    <datalist id="fertilizer-plugins">
      {#each data.fertilizers as f (f.id)}
        <option value={f.displayName}></option>
      {/each}
    </datalist>
    <label
      >{tr('fert.rate')}
      <input
        type="number"
        min="0"
        step="any"
        required
        placeholder={tr('fert.ratePlaceholder')}
        bind:value={appRate}
        data-testid="fertility-rate"
      /></label
    >
    <label
      >{tr('fert.unit')}
      <select bind:value={appUnit} data-testid="fertility-unit">
        {#each FERTILITY_RATE_UNITS as u (u)}
          <option value={u}>{tr(UNIT_KEYS[u])}</option>
        {/each}
        <option value="other">{tr('fert.unitOther')}</option>
      </select>
    </label>
    {#if appUnit === 'other'}
      <label
        >{tr('fert.unitOtherText')}
        <input type="text" required maxlength="40" bind:value={appUnitOther} /></label
      >
    {/if}
    <p class="hint">{tr('fert.npkHint')}</p>
    {#if npkFromAnalysis && analysisFor}
      <p class="hint" data-testid="fertility-npk-from-analysis">
        <Provenance source="plugin" />
        {tr('fert.npkFromAnalysis', { analysis: analysisFor.label })}
      </p>
    {:else if analysisFor && !npkTyped && appRate !== null}
      <p class="hint">{tr('fert.npkNoAnalysis', { analysis: analysisFor.label })}</p>
    {/if}
    <label oninput={markNpkTyped}
      >{tr('fert.nDelivered', { unit: rateUnit })}
      <UnitInput quantity="weightPerArea" min={0} suffix={false} bind:value={appN} /></label
    >
    <label oninput={markNpkTyped}
      >{tr('fert.pDelivered', { unit: rateUnit })}
      <UnitInput quantity="weightPerArea" min={0} suffix={false} bind:value={appP} /></label
    >
    <label oninput={markNpkTyped}
      >{tr('fert.kDelivered', { unit: rateUnit })}
      <UnitInput quantity="weightPerArea" min={0} suffix={false} bind:value={appK} /></label
    >
    {#if data.amendmentBatches.length}
      <label
        >{tr('fert.batch')}
        <select bind:value={appBatch} data-testid="fertility-batch">
          <option value="">{tr('fert.batchNone')}</option>
          {#each data.amendmentBatches as b (b.id)}
            <option value={b.id}>{b.name} ({b.stateText})</option>
          {/each}
        </select>
      </label>
    {/if}
    <OrganicInputNotice
      organicBlocks={data.organicBlocks}
      selectedBlockIds={blockId ? [blockId] : []}
      products={organicProducts}
      blockNames={Object.fromEntries(data.blocks.map((b) => [b.id, b.name]))}
    />
    <button type="submit" class="primary" disabled={busy}>{tr('fert.record')}</button>
    <TaskCloseNote task={data.taskContext} record={{ blockId }} />
  </form>
</details>

<details class="card">
  <summary><h2>{tr('fert.recordCredit')}</h2></summary>
  <form onsubmit={recordCredit}>
    <label>{tr('fert.source')} <input type="text" bind:value={creditSource} /></label>
    <label>{tr('fert.coverPluginId')} <input type="text" bind:value={creditPlugin} /></label>
    <label class="checkbox">
      <input type="checkbox" bind:checked={creditUseDefaults} />
      {tr('fert.useDefaults')}
    </label>
    <label
      >{tr('fert.overrideN', { unit: rateUnit })}
      <UnitInput quantity="weightPerArea" min={0} suffix={false} bind:value={creditN} /></label
    >
    <button type="submit" class="primary" disabled={busy}>{tr('fert.recordCreditBtn')}</button>
  </form>
</details>

<section class="card">
  <h2>{tr('fert.soil.title')}</h2>
  <p>{tr('fert.soil.copy')}</p>
  <button type="button" class="primary" onclick={() => (soilSheetOpen = true)}>
    {tr('fert.soil.add')}
  </button>
</section>

<SetupSheet
  open={soilSheetOpen}
  kicker={tr('fert.sheetKicker')}
  title={tr('fert.soil.add')}
  onClose={() => (soilSheetOpen = false)}
  onDone={onSoilTestSaved}
>
  {#snippet children(done)}
    <SetupSoilTest
      places={data.blocks.map((b) => ({ id: b.id, name: b.name }))}
      canEdit={data.canAddSoilTest}
      initialBlockId={blockId}
      onDone={done}
    />
  {/snippet}
</SetupSheet>

<CarryoverConfirm
  open={confirmFacts !== null}
  facts={confirmFacts}
  {busy}
  onConfirm={(hash) => postApplication(hash)}
  onClose={() => (confirmFacts = null)}
/>

<section class="card">
  <h2>{tr('fert.hist.apps')}</h2>
  {#if data.carryoverHref && data.applications.some((a) => a.batchName)}
    <p><a class="carry-link" href={data.carryoverHref}>{tr('fert.carryoverLink')}</a></p>
  {/if}
  {#if data.applications.length === 0}
    <p>{tr('fert.hist.noApps')}</p>
  {:else}
    <ul>
      {#each data.applications as a (a.id)}
        <li>
          {fmt.instant(a.occurredAt, 'date')} —
          {a.source} · {formatRateText(a.ratePerAcre, a.rateUnit, currentPrefs())}
          (N {npk(a.nLbPerAcre)} · P {npk(a.pLbPerAcre)} · K {npk(a.kLbPerAcre)}
          {rateUnit})
          {#if a.batchName}
            <br /><em class="hint"
              >{a.confirmed
                ? tr('fert.spreadConfirmed', { batch: a.batchName })
                : tr('fert.spread', { batch: a.batchName })}</em
            >
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="card">
  <h2>{tr('fert.hist.credits')}</h2>
  {#if data.credits.length === 0}
    <p>{tr('fert.hist.noCredits')}</p>
  {:else}
    <ul>
      {#each data.credits as c (c.id)}
        <li>
          {c.appliesToYear} — {c.source}
          ({npk(c.nLbPerAcre)} N · {npk(c.pLbPerAcre)} P ·
          {npk(c.kLbPerAcre)} K {rateUnit})
          {#if c.notes}<br /><em class="hint">{c.notes}</em>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="card">
  <h2>{tr('fert.hist.soil')}</h2>
  {#if data.soilTests.length === 0}
    <p>{tr('fert.hist.noSoil')}</p>
  {:else}
    <ul>
      {#each data.soilTests as t (t.id)}
        <li>
          {fmt.instant(t.sampledAt, 'date')} — {tr('fert.soilLine', {
            ph: t.ph?.toFixed(1) ?? '?',
            om: t.organicMatterPct?.toFixed(1) ?? '?',
            no3: t.nitratePpm ?? '?',
            p: t.phosphorusPpm ?? '?',
            k: t.potassiumPpm ?? '?'
          })}
          {t.unitsBasis === 'lb-per-acre' ? 'lb/A' : 'ppm'}
          {#if labReportOf(t) || data.canAddSoilTest}
            <div class="lab-report" data-testid="soil-test-lab-report">
              <span class="lab-report-label">{tr('fert.labReport')}</span>
              <DocumentAttach
                documentId={labReportOf(t)}
                kind="lab-report"
                canEdit={data.canAddSoilTest}
                onchange={(id) => setLabReport(t.id, id)}
              />
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .carry-link {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
  }
  .lab-report {
    margin: var(--space-2) 0 var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .lab-report-label {
    font-weight: 600;
    font-size: var(--font-size-caption);
  }
  .card {
    background: white;
    padding: 1.25rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card.budget {
    border-left: 4px solid #1f5e3a;
  }
  details summary {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: center;
    min-height: 48px;
  }
  details summary h2 {
    display: inline-block;
    margin: 0;
    font-size: 1.05rem;
  }
  .lede {
    color: #555;
  }
  .filter {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin: 0 0 1rem;
    align-items: end;
  }
  label {
    display: flex;
    flex-direction: column;
    font-size: 0.85rem;
    gap: 0.25rem;
  }
  label.checkbox {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }
  input,
  label :global(.unit-input input),
  select {
    padding: 0.55rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    text-align: left;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid #e5e5e5;
  }
  tr.total {
    font-weight: 700;
    background: #f5f7f4;
  }
  .primary {
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.7rem 1.2rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  .primary:disabled {
    background: #999;
  }
  .success {
    background: #e7f1ea;
    color: #1f5e3a;
    padding: 0.6rem;
    border-radius: 4px;
  }
  .error {
    background: #fce4e4;
    color: #b00020;
    padding: 0.6rem;
    border-radius: 4px;
  }
  .hint {
    color: #555;
    font-size: 0.85rem;
  }
</style>
