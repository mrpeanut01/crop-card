<script lang="ts">
  import { goto } from '$app/navigation';
  import { ChevronRight } from 'lucide-svelte';
  import type { PageData } from './$types';
  import Kicker from '$lib/components/ui/Kicker.svelte';

  let { data }: { data: PageData } = $props();

  let submitting = $state(false);
  let applyError = $state<string | null>(null);
  let applied = $state(false);

  const s = $derived(data.preview.summary);

  function fmtDate(ms: number | null): string {
    if (ms === null) return 'no date';
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  async function applyPrep() {
    submitting = true;
    applyError = null;
    try {
      const res = await fetch('/api/season/carry-forward', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromYear: data.fromYear, toYear: data.toYear, apply: true })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        applyError = body?.message ?? `Prep failed (${res.status}).`;
        return;
      }
      applied = true;
    } catch (e) {
      applyError = e instanceof Error ? e.message : 'Network error.';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Prep next season · CropCard</title>
</svelte:head>

<main class="cf-page">
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <a href="/settings">Settings</a>
    <ChevronRight size={13} aria-hidden="true" />
    <a href="/settings/season">Season</a>
    <ChevronRight size={13} aria-hidden="true" />
    <span>Prep next season</span>
  </nav>
  <header class="page-header">
    <Kicker>Season {data.toYear} · Carry-forward</Kicker>
    <h1 class="serif">Prep the {data.toYear} season.</h1>
    <p class="hint">
      Deterministic carry-forward from {data.fromYear}: rotation checks, surviving stock, a
      pre-seeded planting draft, and a calibration hand-off. Nothing is AI-generated — review, then
      apply.
    </p>
  </header>

  {#if applied}
    <p class="success" role="status">
      {data.toYear} prep applied. Expired stock cleared and a carry-forward draft seeded.
      <a href="/plan">Open the Plan wizard →</a>
    </p>
  {/if}

  <section class="summary-strip" aria-label="Carry-forward summary">
    <div class="stat"><span class="n">{s.blocksWithRotationWarnings}</span> rotation flags</div>
    <div class="stat"><span class="n">{s.lotsRolled}</span> lots roll</div>
    <div class="stat"><span class="n">{s.lotsFlagged}</span> expiring soon</div>
    <div class="stat"><span class="n">{s.lotsExpired}</span> expired</div>
    <div class="stat"><span class="n">{s.plantingsCloned}</span> plantings cloned</div>
    <div class="stat"><span class="n">{s.sprayersNeedingRecalibration}</span> recalibrate</div>
  </section>

  <!-- 1. Rotation advisor -->
  <section class="card" aria-labelledby="rot-h">
    <h2 id="rot-h">Rotation advisor</h2>
    {#if data.preview.rotation.length === 0}
      <p class="hint">No blocks on record.</p>
    {:else}
      <ul class="rows">
        {#each data.preview.rotation as r (r.blockId)}
          <li class="row sev-{r.severity}">
            <span class="row-title">{r.blockName}</span>
            <span class="row-body">{r.message}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- 2. Stock roll-forward -->
  <section class="card" aria-labelledby="stock-h">
    <h2 id="stock-h">Surviving-stock roll-forward</h2>
    {#if data.preview.stock.length === 0}
      <p class="hint">No stock on hand to carry.</p>
    {:else}
      <ul class="rows">
        {#each data.preview.stock as d (d.lotId)}
          <li class="row disp-{d.disposition}">
            <span class="row-title">{d.displayName}</span>
            <span class="row-body">{d.balance} {d.unit} · {d.reason}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- 3. Planting-template clone -->
  <section class="card" aria-labelledby="clone-h">
    <h2 id="clone-h">Planting-template clone <span class="tag">carry-forward</span></h2>
    {#if data.preview.clonedPlantings.length === 0}
      <p class="hint">No prior plantings to clone.</p>
    {:else}
      <ul class="rows">
        {#each data.preview.clonedPlantings as c (`${c.blockId}-${c.cropPluginId}`)}
          <li class="row">
            <span class="row-title">{c.varietyDisplayName}</span>
            <span class="row-body">
              {fmtDate(c.plantingDateMs)}
              {#if c.clamped}<span class="chip">date re-checked</span>{/if}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- 4. Calibration hand-off -->
  <section class="card" aria-labelledby="cal-h">
    <h2 id="cal-h">Calibration hand-off</h2>
    {#if data.preview.calibration.length === 0}
      <p class="hint">No sprayers on record.</p>
    {:else}
      <ul class="rows">
        {#each data.preview.calibration as c (c.sprayerId)}
          <li class="row" class:sev-warn={c.needsRecalibration}>
            <span class="row-title">{c.name}</span>
            <span class="row-body">
              {#if c.needsRecalibration}
                Recalibrate before first spray ({c.reason}) —
                <a href="/calibrate">run UC-10 →</a>
              {:else}
                Calibration current.
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- 5. Cover-crop N-credit -->
  {#if data.preview.nCredits.some((n) => n.nCreditLbPerAcre > 0)}
    <section class="card" aria-labelledby="ncred-h">
      <h2 id="ncred-h">Cover-crop N-credit (from actual terminations)</h2>
      <ul class="rows">
        {#each data.preview.nCredits.filter((n) => n.nCreditLbPerAcre > 0) as n (n.blockId)}
          <li class="row">
            <span class="row-title">Block {n.blockId.slice(0, 8)}</span>
            <span class="row-body"
              >{n.nCreditLbPerAcre} lb-N/ac from {n.sourcePluginIds.join(', ')}</span
            >
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if applyError}
    <p class="error" role="alert">{applyError}</p>
  {/if}

  <div class="actions">
    <button type="button" class="secondary" onclick={() => goto('/settings/season')}>Back</button>
    <button type="button" class="primary" disabled={submitting || applied} onclick={applyPrep}>
      {#if applied}Applied ✓{:else if submitting}Applying…{:else}Apply {data.toYear} prep →{/if}
    </button>
  </div>
</main>

<style>
  .cf-page {
    max-width: 820px;
    margin: 0 auto;
    padding: 1.5rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--color-ink-muted);
  }
  .breadcrumb a {
    color: var(--color-forest);
    text-decoration: none;
  }
  .breadcrumb a:hover {
    text-decoration: underline;
  }
  .page-header {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .page-header h1 {
    margin: 6px 0 0;
    font-family: var(--font-serif, serif);
    font-size: 30px;
    color: var(--color-forest-deep);
    letter-spacing: -0.02em;
  }
  .hint {
    margin: 0;
    color: #4a5a4a;
    font-size: 0.9rem;
    line-height: 1.45;
  }
  .summary-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .summary-strip .stat {
    background: #f3efe1;
    border: 1px solid #d8cfae;
    border-radius: 8px;
    padding: 0.5rem 0.9rem;
    font-size: 0.85rem;
    color: #4a5a4a;
  }
  .summary-strip .n {
    font-weight: 700;
    color: var(--color-forest-deep, #1f5e3a);
    font-size: 1.1rem;
    margin-right: 0.25rem;
  }
  .card {
    border: 1px solid #d8cfae;
    border-radius: 10px;
    padding: 1rem 1.1rem;
    background: #fffdf6;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .card h2 {
    margin: 0;
    font-size: 1.05rem;
    color: #1f5e3a;
  }
  .tag {
    font-size: 0.65rem;
    background: #e7eefb;
    color: #2b4a86;
    border-radius: 6px;
    padding: 2px 6px;
    vertical-align: middle;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0.5rem 0.6rem;
    border-radius: 6px;
    background: #f7f4ea;
    border-left: 3px solid transparent;
  }
  .row.sev-suggest {
    border-left-color: #b8860b;
  }
  .row.sev-warn,
  .row.disp-expired {
    border-left-color: #8a3b34;
    background: #f8eeec;
  }
  .row.disp-flag-expiring {
    border-left-color: #b8860b;
  }
  .row.disp-roll {
    border-left-color: #1f5e3a;
  }
  .row-title {
    font-weight: 600;
    color: #2a2a22;
    font-size: 0.9rem;
  }
  .row-body {
    font-size: 0.82rem;
    color: #4a5a4a;
  }
  .row-body a {
    color: #8a3b34;
  }
  .chip {
    display: inline-block;
    font-size: 0.68rem;
    background: #f4e6c8;
    color: #8a5a12;
    border-radius: 5px;
    padding: 1px 5px;
    margin-left: 4px;
  }
  .actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    padding-top: 0.5rem;
  }
  .actions button {
    min-height: 48px;
    padding: 0.55rem 1.35rem;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    border: none;
  }
  .actions .primary {
    background: #1f5e3a;
    color: white;
  }
  .actions .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .actions .secondary {
    background: transparent;
    color: #1f5e3a;
    border: 1px solid #1f5e3a;
  }
  .success {
    margin: 0;
    padding: 0.7rem 1rem;
    background: #e7f4ec;
    border: 1px solid #1f5e3a;
    border-radius: 6px;
    color: #1f5e3a;
    font-size: 0.92rem;
  }
  .success a {
    color: #1f5e3a;
    font-weight: 600;
  }
  .error {
    margin: 0;
    padding: 0.6rem 1rem;
    background: #f8eeec;
    border: 1px solid #8a3b34;
    border-radius: 6px;
    color: #8a3b34;
    font-size: 0.9rem;
  }
</style>
