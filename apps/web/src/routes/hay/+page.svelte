<script lang="ts">
  import { isUpdatingResponse, retryAfterSeconds, updatingQueuedNotice } from '$lib/updating';
  import type { ForecastDay, HayStatus, HayStep, HayViolation } from '$lib/hay';
  import { nextStep as engineNextStep } from '$lib/hay';
  import { untrack } from 'svelte';
  import { createT } from '$lib/i18n';
  import { fmt } from '$lib/prefsState.svelte';
  import { grazingTimeHref } from '$lib/animals/holdCopy';
  import HoldVoidPanel from '$lib/components/records/HoldVoidPanel.svelte';
  import HayForageSection from '$lib/components/forage/HayForageSection.svelte';
  import { invalidateAll } from '$app/navigation';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { page } from '$app/state';
  import TaskCloseNote from '$lib/components/tasks/TaskCloseNote.svelte';
  import { recordCloseMessageKey, type RecordTaskCloseStatus } from '$lib/tasks/recordClose';

  let { data } = $props();
  const tr = $derived(createT(data.locale));

  let blockId = $state(untrack(() => data.selectedBlockId));
  let year = $state(untrack(() => data.year));
  let cropPluginId = $state<string>(
    untrack(
      () =>
        data.blocks.find((b) => b.id === data.selectedBlockId)?.hayPlanting?.cropPluginId ??
        data.hayCrops[0]?.pluginId ??
        ''
    )
  );

  let busy = $state(false);
  let error = $state<string | null>(null);
  let attestHref = $state<string | null>(null);
  let banner = $state<string | null>(null);
  let taskQueued = $state(false);
  // The page reloads after a save; the task's outcome rides on the URL.
  const savedTaskLine = $derived.by(() => {
    const status = page.url.searchParams.get('taskClose') as RecordTaskCloseStatus | null;
    const key = status ? recordCloseMessageKey({ taskId: '', status }) : null;
    return key ? tr(key) : null;
  });

  // Forecast state
  let forecast = $state<ForecastDay[] | null>(null);
  let forecastSource = $state<string | null>(null);
  let forecastError = $state<string | null>(null);
  let mowViolations = $state<HayViolation[]>([]);

  // Bale form state
  let baleType = $state<'small-square' | 'large-round' | 'large-square'>('small-square');
  let baleMoisture = $state<number | null>(null);
  let balesQuantity = $state<number | null>(null);

  const selectedCrop = $derived(data.hayCrops.find((c) => c.pluginId === cropPluginId) ?? null);

  function reload(taskClose?: RecordTaskCloseStatus | null) {
    const u = new URL(window.location.href);
    u.searchParams.set('block', blockId);
    u.searchParams.set('year', String(year));
    u.searchParams.delete('taskClose');
    if (taskClose) {
      u.searchParams.delete('task');
      u.searchParams.set('taskClose', taskClose);
    }
    window.location.href = u.toString();
  }

  async function fetchForecast() {
    if (!blockId) return;
    busy = true;
    forecastError = null;
    try {
      const res = await fetch(`/api/hay/forecast?blockId=${encodeURIComponent(blockId)}`);
      const out = await res.json();
      if (!res.ok) {
        forecastError = out.error ?? tr('hayui.errForecast');
        forecast = null;
        return;
      }
      forecast = out.forecast as ForecastDay[];
      forecastSource = out.source ?? null;
      // Re-evaluate mow gate locally for instant feedback.
      if (selectedCrop?.hayOperations) {
        const window = selectedCrop.hayOperations.weatherWindowDays;
        const wet = forecast.slice(0, window).filter((d) => d.popPct > 30);
        mowViolations = wet.length
          ? [
              {
                code: 'WEATHER_RAIN_RISK',
                severity: 'danger',
                message: `${wet.length} of next ${window} day(s) have rain probability >30%`
              }
            ]
          : [];
      }
    } catch (e) {
      forecastError = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function startCutting(opts: { override?: boolean } = {}) {
    busy = true;
    error = null;
    banner = null;
    taskQueued = false;
    const body = {
      blockId,
      cropPluginId,
      year,
      forecast: forecast ?? undefined,
      overrideMowGate: opts.override,
      ...(data.taskContext ? { taskId: data.taskContext.id } : {})
    };
    try {
      // #316 (NFR-02) — offline path. Queue the cutting-start locally; the
      // sync queue replays it against /api/hay/cuttings (server re-runs the
      // mow gate) on reconnect. No reload — the server has nothing new yet.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const { enqueueRecord } = await import('$lib/client/syncQueue');
        await enqueueRecord('hay-cutting', body);
        banner = tr('hayui.queued');
        taskQueued = !!data.taskContext;
        return;
      }
      const res = await fetch('/api/hay/cuttings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (isUpdatingResponse(res)) {
        const { enqueueRecord, scheduleDrain } = await import('$lib/client/syncQueue');
        await enqueueRecord('hay-cutting', body);
        scheduleDrain((retryAfterSeconds(res) + 2) * 1000);
        banner = updatingQueuedNotice(data.locale);
        taskQueued = !!data.taskContext;
        return;
      }
      const out = await res.json();
      if (!res.ok) {
        error = out.error ?? tr('hayui.errStart');
        attestHref =
          out.ownerCanAttest && !out.askOwner && out.fieldId ? grazingTimeHref(out.fieldId) : null;
        if (out.violations) {
          mowViolations = out.violations;
        }
        return;
      }
      banner = tr('hayui.recorded', { n: out.cutting.cuttingNumber });
      reload(out.taskClose?.status ?? null);
    } catch (e) {
      // #316 — transient network failure while "online": queue instead of
      // losing the cutting.
      const msg = e instanceof Error ? e.message : String(e);
      const isNetworkErr = e instanceof TypeError && /(fetch|network|failed)/i.test(msg);
      if (isNetworkErr) {
        try {
          const { enqueueRecord } = await import('$lib/client/syncQueue');
          await enqueueRecord('hay-cutting', body);
          banner = tr('hayui.queued');
          taskQueued = !!data.taskContext;
        } catch (queueErr) {
          error = tr('hayui.errQueue', {
            msg: queueErr instanceof Error ? queueErr.message : String(queueErr)
          });
        }
      } else {
        error = msg;
      }
    } finally {
      busy = false;
    }
  }

  async function advance(
    cuttingId: string,
    step: 'ted' | 'rake' | 'bale' | 'store',
    opts: { override?: boolean } = {}
  ) {
    busy = true;
    error = null;
    try {
      const body: Record<string, unknown> = { action: 'advance', step };
      if (step === 'bale') {
        body.baleType = baleType;
        body.baleMoisturePct = baleMoisture;
        if (balesQuantity !== null) body.balesQuantity = balesQuantity;
        if (opts.override) body.overrideBaleGate = true;
      }
      const res = await fetch(`/api/hay/cuttings/${cuttingId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const out = await res.json();
      if (!res.ok) {
        attestHref =
          out.ownerCanAttest && !out.askOwner && out.fieldId ? grazingTimeHref(out.fieldId) : null;
        error = out.violations
          ? `${out.error}: ${out.violations.map((v: HayViolation) => v.message).join(' • ')}`
          : (out.error ?? tr('hayui.errAdvance'));
        return;
      }
      reload();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function abortCutting(cuttingId: string) {
    if (!confirm(tr('hayui.abortConfirm'))) return;
    busy = true;
    error = null;
    try {
      const res = await fetch(`/api/hay/cuttings/${cuttingId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'abort' })
      });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        error = out.error ?? tr('hayui.errAdvance');
        return;
      }
      reload();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  const DEFAULT_HAY_STEPS: readonly HayStep[] = ['mow', 'ted', 'rake', 'bale', 'store'];
  function stepsFor(c: { cropPluginId: string }): readonly HayStep[] {
    return (
      data.hayCrops.find((h) => h.pluginId === c.cropPluginId)?.hayOperations?.steps ??
      DEFAULT_HAY_STEPS
    );
  }

  function nextStep(c: {
    status: string;
    cropPluginId: string;
  }): 'ted' | 'rake' | 'bale' | 'store' | null {
    const step = engineNextStep(stepsFor(c), c.status as HayStatus);
    return step === null || step === 'mow' ? null : step;
  }

  const STATUS_KEY = {
    mowing: 'hayui.status.mowing',
    tedding: 'hayui.status.tedding',
    raking: 'hayui.status.raking',
    baling: 'hayui.status.baling',
    complete: 'hayui.status.complete',
    aborted: 'hayui.status.aborted'
  } as const;
  function statusLabel(s: string): string {
    return s in STATUS_KEY ? tr(STATUS_KEY[s as keyof typeof STATUS_KEY]) : s;
  }
  const STEP_KEY = {
    ted: 'hayui.step.ted',
    rake: 'hayui.step.rake',
    bale: 'hayui.step.bale',
    store: 'hayui.step.store'
  } as const;

  function fmtTs(ms: number | undefined): string {
    return ms ? fmt.instant(ms, 'datetime') : '—';
  }
</script>

<h1>{tr('hayui.title')}</h1>
<p class="lede">
  {tr('hayui.lede')}
</p>

<form
  class="filter"
  onsubmit={(e) => {
    e.preventDefault();
    reload();
  }}
>
  <label>
    {tr('hayui.block')}
    <select bind:value={blockId}>
      {#each data.blocks as b (b.id)}
        <option value={b.id}>
          {b.name}{b.hayPlanting ? ` — ${b.hayPlanting.varietyDisplayName}` : ''}
        </option>
      {/each}
    </select>
  </label>
  <label>
    {tr('hayui.year')}
    <input type="number" min="1900" max="3000" bind:value={year} />
  </label>
  <label>
    {tr('hayui.variety')}
    <select bind:value={cropPluginId}>
      {#each data.hayCrops as c (c.pluginId)}
        <option value={c.pluginId}>{c.displayName}</option>
      {/each}
    </select>
  </label>
  <button type="submit" class="primary">{tr('hayui.load')}</button>
</form>

{#if banner}<p class="success" role="status" aria-live="polite">{banner}</p>{/if}
{#if savedTaskLine}
  <p class="success" data-testid="task-close-note" role="status">{savedTaskLine}</p>
{/if}
{#if error}<p class="error" role="alert" aria-live="polite">{error}</p>{/if}
{#if error && attestHref}
  <a class="attest-link" href={attestHref}>{tr('hayui.attestLink')}</a>
{/if}

<section class="card">
  <h2>{tr('hayui.mowDecision')}</h2>
  {#if !selectedCrop}
    <p>{tr('hayui.selectVariety')}</p>
  {:else}
    {@const planted = data.blocks.find((b) => b.id === blockId)?.hayPlanting}
    {#if planted && planted.cropPluginId !== selectedCrop.pluginId}
      <p class="hint" data-testid="hay-thresholds-note">
        {tr('hayui.thresholdsNote', {
          crop: selectedCrop.displayName,
          planted: planted.varietyDisplayName
        })}
      </p>
    {/if}
    <p class="hint">
      {tr('hayui.mowTrigger')} <strong>{selectedCrop.hayOperations?.mowTrigger ?? '—'}</strong>{tr(
        'hayui.dryWindow',
        { days: selectedCrop.hayOperations?.weatherWindowDays ?? '' }
      )}
    </p>
    <button class="secondary" onclick={fetchForecast} disabled={busy || !blockId}>
      {busy ? tr('hayui.fetching') : tr('hayui.checkForecast')}
    </button>
    {#if forecastError}<p class="error">{forecastError}</p>{/if}
    {#if forecast}
      {#if forecastSource === 'farm'}
        <p class="hint">{tr('hayui.forecastFarm')}</p>
      {:else if forecastSource === 'farm-block'}
        <p class="hint">
          {tr('hayui.forecastNearest')}
        </p>
      {/if}
      <table class="forecast">
        <thead>
          <tr>
            <th>{tr('hayui.th.date')}</th>
            <th>{tr('hayui.th.hi', { unit: fmt.unit('temperature') })}</th>
            <th>{tr('hayui.th.lo', { unit: fmt.unit('temperature') })}</th>
            <th>{tr('hayui.th.rain')}</th>
            <th>{tr('hayui.th.wind')}</th>
            <th>{tr('hayui.th.note')}</th>
          </tr>
        </thead>
        <tbody>
          {#each forecast.slice(0, 5) as d (d.date)}
            <tr class:wet={d.popPct > 30}>
              <td>{fmt.day(d.date, 'date', { weekday: 'short' })}</td>
              <td>{fmt.qty(d.highF, 'temperature', { bare: true })}</td>
              <td>{fmt.qty(d.lowF, 'temperature', { bare: true })}</td>
              <td>{d.popPct}%</td>
              <td>{d.windMph !== undefined ? fmt.qty(d.windMph, 'speed') : '—'}</td>
              <td>{d.shortForecast ?? ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    {#if mowViolations.length > 0}
      <div
        class="banner danger"
        role="alert"
        aria-live="assertive"
        lang="en"
        data-english-only="safety"
      >
        <strong>STOP</strong> — {mowViolations[0].message}
      </div>
    {/if}
    <div class="row">
      <button
        class="primary"
        onclick={() => startCutting()}
        disabled={busy || !blockId || !cropPluginId}
      >
        {busy ? tr('hayui.saving') : tr('hayui.recordCutting')}
      </button>
      {#if mowViolations.length > 0}
        <button
          class="secondary danger"
          onclick={() => startCutting({ override: true })}
          disabled={busy}
        >
          {busy ? tr('hayui.saving') : 'Override + record anyway'}
        </button>
      {/if}
    </div>
    <TaskCloseNote task={data.taskContext} record={{ blockId, cropPluginId }} queued={taskQueued} />
  {/if}
</section>

<section class="card">
  <h2>
    {tr('hayui.cuttingsHeading', {
      block: data.blocks.find((b) => b.id === blockId)?.name ?? tr('hayui.pickBlock'),
      year
    })}
  </h2>
  {#if data.cuttings.length === 0}
    <p>{tr('hayui.noCuttings')}</p>
  {:else}
    {#each data.cuttings as c (c.id)}
      <article
        class="cutting"
        class:complete={c.status === 'complete'}
        class:aborted={c.status === 'aborted'}
      >
        <header>
          <strong>{tr('hayui.cuttingN', { n: c.cuttingNumber })}</strong>
          <span class="status status-{c.status}">{statusLabel(c.status)}</span>
        </header>
        <ul class="timeline">
          <li>{tr('hayui.tl.mow', { ts: fmtTs(c.mowAt) })}</li>
          {#if stepsFor(c).includes('ted')}
            <li>{tr('hayui.tl.ted', { ts: fmtTs(c.tedAt) })}</li>
          {/if}
          <li>{tr('hayui.tl.rake', { ts: fmtTs(c.rakeAt) })}</li>
          <li>
            {tr('hayui.tl.bale', { ts: fmtTs(c.baleAt) })}{c.baleType
              ? ` (${c.baleType}, ${c.baleMoisturePct ?? '?'}%)`
              : ''}
          </li>
          <li>{tr('hayui.tl.store', { ts: fmtTs(c.storedAt) })}</li>
        </ul>
        {#if c.status === 'baling' || nextStep(c) === 'bale'}
          <fieldset class="bale-form">
            <legend>{tr('hayui.baleStep')}</legend>
            <label>
              {tr('hayui.baleType')}
              <select bind:value={baleType}>
                <option value="small-square">{tr('hayui.baleSmallSquare')}</option>
                <option value="large-round">{tr('hayui.baleLargeRound')}</option>
                <option value="large-square">{tr('hayui.baleLargeSquare')}</option>
              </select>
            </label>
            <label>
              {tr('hayui.moisture')}
              <input type="number" min="0" max="100" step="0.1" bind:value={baleMoisture} />
            </label>
            <label>
              {tr('hayui.bales')}
              <input type="number" min="0" bind:value={balesQuantity} />
            </label>
          </fieldset>
        {/if}
        {#if nextStep(c)}
          <div class="row">
            <button class="primary" onclick={() => advance(c.id, nextStep(c)!)} disabled={busy}>
              {busy
                ? tr('hayui.saving')
                : tr('hayui.advance', { step: tr(STEP_KEY[nextStep(c)!]) })}
            </button>
            {#if nextStep(c) === 'bale'}
              <button
                class="secondary danger"
                onclick={() => advance(c.id, 'bale', { override: true })}
                disabled={busy}
              >
                {busy ? tr('hayui.saving') : 'Override bale gate'}
              </button>
            {/if}
            <button class="secondary" onclick={() => abortCutting(c.id)} disabled={busy}>
              {tr('hayui.abort')}
            </button>
          </div>
        {/if}
        {#if c.notes}<p class="hint">{c.notes}</p>{/if}
        {#each c.offFarm as n (n.productName)}
          <div class="off-farm" role="note" data-testid="hay-off-farm">
            <p>{n.text}</p>
            <p class="hint">
              {tr('forage.hay.sprayed', { date: n.appliedOn })}{n.source
                ? ` ${tr('forage.hay.labelSource', { source: n.source })}`
                : ''}
              <Provenance source="plugin" detail={tr('forage.hay.labelData')} compact />
            </p>
          </div>
        {/each}
        {#if data.canStockBales && (c.status === 'storing' || c.status === 'complete')}
          <a
            class="bales-link"
            href="/inventory/feed/add?hayCuttingId={encodeURIComponent(c.id)}"
            data-testid="bales-to-feed">{tr('hayui.balesToFeed')}</a
          >
        {/if}
        <HayForageSection
          cuttingId={c.id}
          canRecord={data.forage.canRecord}
          canAttach={data.forage.canAttach}
        />
        <HoldVoidPanel
          url="/api/hay/cuttings/{c.id}/void"
          canVoidHolds={data.canVoidHolds}
          voidableUntilMs={c.voidableUntilMs}
          onVoided={async () => {
            banner = tr('hayui.voided', { n: c.cuttingNumber });
            await invalidateAll();
          }}
        />
      </article>
    {/each}
  {/if}
</section>

<style>
  .off-farm {
    margin: 0.5rem 0;
    padding: 0.6rem 0.75rem;
    border-radius: 6px;
    background: var(--pill-wheat-bg, #fbf3dc);
    border: 1px solid var(--pill-wheat-bd, #e7d39a);
    overflow-wrap: anywhere;
  }
  .off-farm p {
    margin: 0;
  }
  .bales-link {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    color: var(--color-forest, #1f5e3a);
    font-weight: 600;
  }
  .attest-link {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
  }
  h1 {
    margin: 0 0 0.5rem;
  }
  .lede {
    color: #555;
  }
  .card {
    background: white;
    padding: 1.25rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
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
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  input,
  select {
    padding: 0.55rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
  }
  table.forecast {
    width: 100%;
    border-collapse: collapse;
    margin: 0.5rem 0;
  }
  table.forecast th,
  table.forecast td {
    text-align: left;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid #e5e5e5;
  }
  tr.wet {
    background: #fce4e4;
  }
  .banner.danger {
    background: #b71c1c;
    color: white;
    padding: 0.75rem 1rem;
    border-radius: 4px;
    margin: 0.5rem 0;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.75rem;
  }
  .primary,
  .secondary {
    padding: 0.7rem 1.2rem;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    min-height: 48px;
  }
  .primary {
    background: #1f5e3a;
    color: white;
  }
  .secondary {
    background: #f0f3f0;
    color: #1f5e3a;
    border: 2px solid #1f5e3a;
  }
  .secondary.danger {
    border-color: #b71c1c;
    color: #b71c1c;
    background: #fff;
  }
  .primary:disabled,
  .secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .cutting {
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    padding: 0.9rem;
    margin-bottom: 0.75rem;
  }
  .cutting.complete {
    background: #e7f1ea;
    border-color: #1f5e3a;
  }
  .cutting.aborted {
    background: #f5f5f5;
    color: #888;
  }
  .cutting header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  .status {
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  .status-mowing,
  .status-tedding,
  .status-raking {
    background: #fff8e1;
    color: #b35900;
  }
  .status-baling {
    background: #fff3cd;
    color: #b35900;
  }
  .status-complete {
    background: #1f5e3a;
    color: white;
  }
  .status-aborted {
    background: #ddd;
    color: #555;
  }
  .timeline {
    list-style: none;
    padding: 0;
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    color: #444;
  }
  .timeline li {
    padding: 0.15rem 0;
  }
  fieldset.bale-form {
    border: 1px solid #d0d7d0;
    border-radius: 6px;
    padding: 0.6rem 0.75rem;
    margin: 0.5rem 0;
  }
  legend {
    color: #1f5e3a;
    font-weight: 600;
    padding: 0 0.5rem;
  }
  .hint {
    color: #666;
    font-size: 0.85rem;
    margin: 0.4rem 0;
  }
  .success {
    background: #e7f1ea;
    color: #1f5e3a;
    padding: 0.6rem;
    border-radius: 4px;
  }
  .error {
    background: #fdecea;
    color: #a23a3a;
    padding: 0.6rem;
    border-radius: 4px;
  }
</style>
