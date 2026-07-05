<script lang="ts">
  import type { ForecastDay, HayViolation } from '$lib/hay';
  import { untrack } from 'svelte';

  let { data } = $props();

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
  let banner = $state<string | null>(null);

  // Forecast state
  let forecast = $state<ForecastDay[] | null>(null);
  let forecastError = $state<string | null>(null);
  let mowViolations = $state<HayViolation[]>([]);

  // Bale form state
  let baleType = $state<'small-square' | 'large-round' | 'large-square'>('small-square');
  let baleMoisture = $state<number | null>(null);
  let balesQuantity = $state<number | null>(null);

  const selectedCrop = $derived(data.hayCrops.find((c) => c.pluginId === cropPluginId) ?? null);

  function reload() {
    const u = new URL(window.location.href);
    u.searchParams.set('block', blockId);
    u.searchParams.set('year', String(year));
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
        forecastError = out.error ?? 'forecast fetch failed';
        forecast = null;
        return;
      }
      forecast = out.forecast as ForecastDay[];
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
    const body = {
      blockId,
      cropPluginId,
      year,
      forecast: forecast ?? undefined,
      overrideMowGate: opts.override
    };
    try {
      // #316 (NFR-02) — offline path. Queue the cutting-start locally; the
      // sync queue replays it against /api/hay/cuttings (server re-runs the
      // mow gate) on reconnect. No reload — the server has nothing new yet.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const { enqueueRecord } = await import('$lib/client/syncQueue');
        await enqueueRecord('hay-cutting', body);
        banner = '☁ Offline — cutting queued. Will sync when the connection returns.';
        return;
      }
      const res = await fetch('/api/hay/cuttings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const out = await res.json();
      if (!res.ok) {
        error = out.error ?? 'failed to start cutting';
        if (out.violations) {
          mowViolations = out.violations;
        }
        return;
      }
      banner = `Cutting #${out.cutting.cuttingNumber} recorded.`;
      reload();
    } catch (e) {
      // #316 — transient network failure while "online": queue instead of
      // losing the cutting.
      const msg = e instanceof Error ? e.message : String(e);
      const isNetworkErr = e instanceof TypeError && /(fetch|network|failed)/i.test(msg);
      if (isNetworkErr) {
        try {
          const { enqueueRecord } = await import('$lib/client/syncQueue');
          await enqueueRecord('hay-cutting', body);
          banner = '☁ Offline — cutting queued. Will sync when the connection returns.';
        } catch (queueErr) {
          error = `offline queue failed: ${
            queueErr instanceof Error ? queueErr.message : queueErr
          }`;
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
        error = out.violations
          ? `${out.error}: ${out.violations.map((v: HayViolation) => v.message).join(' • ')}`
          : (out.error ?? 'advance failed');
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
    if (!confirm('Abort this cutting? Use only if mow → bale was scrapped.')) return;
    busy = true;
    try {
      await fetch(`/api/hay/cuttings/${cuttingId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'abort' })
      });
      reload();
    } finally {
      busy = false;
    }
  }

  function nextStep(c: { status: string }): 'ted' | 'rake' | 'bale' | 'store' | null {
    const map: Record<string, 'ted' | 'rake' | 'bale' | 'store' | null> = {
      mowing: 'ted',
      tedding: 'rake',
      raking: 'bale',
      baling: 'store',
      complete: null,
      aborted: null
    };
    return map[c.status] ?? null;
  }

  function fmtTs(ms: number | undefined): string {
    return ms ? new Date(ms).toLocaleString() : '—';
  }
</script>

<h1>Hay & Forage</h1>
<p class="lede">
  Multi-step cutting workflow with weather-window gate and bale-moisture safety check (FR-19, FR-21,
  FR-22). Each cutting records mow → ted → rake → bale → store; the kernel enforces the plugin's
  moisture thresholds at the bale step.
</p>

<form
  class="filter"
  onsubmit={(e) => {
    e.preventDefault();
    reload();
  }}
>
  <label>
    Block
    <select bind:value={blockId}>
      {#each data.blocks as b (b.id)}
        <option value={b.id}>
          {b.name}{b.hayPlanting ? ` — ${b.hayPlanting.varietyDisplayName}` : ''}
        </option>
      {/each}
    </select>
  </label>
  <label>
    Year
    <input type="number" min="1900" max="3000" bind:value={year} />
  </label>
  <label>
    Hay variety
    <select bind:value={cropPluginId}>
      {#each data.hayCrops as c (c.pluginId)}
        <option value={c.pluginId}>{c.displayName}</option>
      {/each}
    </select>
  </label>
  <button type="submit" class="primary">Load</button>
</form>

{#if banner}<p class="success">{banner}</p>{/if}
{#if error}<p class="error">{error}</p>{/if}

<section class="card">
  <h2>1 — Mow decision</h2>
  {#if !selectedCrop}
    <p>Select a hay variety above.</p>
  {:else}
    <p class="hint">
      Mow trigger: <strong>{selectedCrop.hayOperations?.mowTrigger ?? '—'}</strong>. Plugin requires
      a {selectedCrop.hayOperations?.weatherWindowDays}-day dry window.
    </p>
    <button class="secondary" onclick={fetchForecast} disabled={busy || !blockId}>
      {busy ? 'Fetching…' : 'Check NOAA forecast'}
    </button>
    {#if forecastError}<p class="error">{forecastError}</p>{/if}
    {#if forecast}
      <table class="forecast">
        <thead>
          <tr>
            <th>Date</th>
            <th>Hi °F</th>
            <th>Lo °F</th>
            <th>Rain %</th>
            <th>Wind</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {#each forecast.slice(0, 5) as d (d.date)}
            <tr class:wet={d.popPct > 30}>
              <td>{d.date}</td>
              <td>{d.highF}</td>
              <td>{d.lowF}</td>
              <td>{d.popPct}%</td>
              <td>{d.windMph !== undefined ? `${d.windMph} mph` : '—'}</td>
              <td>{d.shortForecast ?? ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    {#if mowViolations.length > 0}
      <div class="banner danger">
        <strong>STOP</strong> — {mowViolations[0].message}
      </div>
    {/if}
    <div class="row">
      <button
        class="primary"
        onclick={() => startCutting()}
        disabled={busy || !blockId || !cropPluginId}
      >
        Record cutting now (mow done)
      </button>
      {#if mowViolations.length > 0}
        <button
          class="secondary danger"
          onclick={() => startCutting({ override: true })}
          disabled={busy}
        >
          Override + record anyway
        </button>
      {/if}
    </div>
  {/if}
</section>

<section class="card">
  <h2>Cuttings — block {blockId} / {year}</h2>
  {#if data.cuttings.length === 0}
    <p>No cuttings recorded for this block + year.</p>
  {:else}
    {#each data.cuttings as c (c.id)}
      <article
        class="cutting"
        class:complete={c.status === 'complete'}
        class:aborted={c.status === 'aborted'}
      >
        <header>
          <strong>Cutting #{c.cuttingNumber}</strong>
          <span class="status status-{c.status}">{c.status}</span>
        </header>
        <ul class="timeline">
          <li>Mow: {fmtTs(c.mowAt)}</li>
          {#if selectedCrop?.hayOperations?.steps.includes('ted')}
            <li>Ted: {fmtTs(c.tedAt)}</li>
          {/if}
          <li>Rake: {fmtTs(c.rakeAt)}</li>
          <li>
            Bale: {fmtTs(c.baleAt)}{c.baleType
              ? ` (${c.baleType}, ${c.baleMoisturePct ?? '?'}%)`
              : ''}
          </li>
          <li>Store: {fmtTs(c.storedAt)}</li>
        </ul>
        {#if c.status === 'baling' || nextStep(c) === 'bale'}
          <fieldset class="bale-form">
            <legend>Bale step — moisture gate</legend>
            <label>
              Bale type
              <select bind:value={baleType}>
                <option value="small-square">small square</option>
                <option value="large-round">large round</option>
                <option value="large-square">large square</option>
              </select>
            </label>
            <label>
              Moisture %
              <input type="number" min="0" max="100" step="0.1" bind:value={baleMoisture} />
            </label>
            <label>
              Bales
              <input type="number" min="0" bind:value={balesQuantity} />
            </label>
          </fieldset>
        {/if}
        {#if nextStep(c)}
          <div class="row">
            <button class="primary" onclick={() => advance(c.id, nextStep(c)!)} disabled={busy}>
              Advance — {nextStep(c)}
            </button>
            {#if nextStep(c) === 'bale'}
              <button
                class="secondary danger"
                onclick={() => advance(c.id, 'bale', { override: true })}
                disabled={busy}
              >
                Override bale gate
              </button>
            {/if}
            <button class="secondary" onclick={() => abortCutting(c.id)} disabled={busy}>
              Abort
            </button>
          </div>
        {/if}
        {#if c.notes}<p class="hint">{c.notes}</p>{/if}
      </article>
    {/each}
  {/if}
</section>

<style>
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
    background: #fce4e4;
    color: #b00020;
    padding: 0.6rem;
    border-radius: 4px;
  }
</style>
