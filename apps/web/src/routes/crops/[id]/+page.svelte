<script lang="ts">
  import { ChevronRight } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import { fmt as prefsFmt } from '$lib/prefsState.svelte';
  import { createT } from '$lib/i18n';

  const { data } = $props();
  const tr = $derived(createT(data.locale));

  const STATUS_KEY = {
    planned: 'crops.status.planned',
    active: 'crops.status.active',
    harvested: 'crops.status.harvested',
    failed: 'crops.status.failed',
    archived: 'crops.status.archived'
  } as const;
  const statusLabel = (s: string) =>
    s in STATUS_KEY ? tr(STATUS_KEY[s as keyof typeof STATUS_KEY]) : s;

  const blockHref = $derived(`/plan?block=${encodeURIComponent(data.block.id)}`);
  const kicker = $derived(
    [
      tr('crops.kickerPlanting'),
      data.cropPlugin?.displayName ?? data.crop.cropPluginId,
      data.crop.plantingDate
        ? new Date(data.crop.plantingDate).toISOString().slice(0, 4)
        : tr('crops.kickerPlanned')
    ].join(' · ')
  );

  let busy = $state(false);
  let actionError = $state<string | null>(null);

  function fmtDay(ms: number): string {
    return prefsFmt.day(ms);
  }

  function fmt(ms: number): string {
    return prefsFmt.instant(ms, 'date');
  }

  function fmtDateTime(ms: number): string {
    return prefsFmt.instant(ms);
  }

  async function changeStatus(action: 'mark-harvested' | 'archive' | 'mark-failed' | 'reactivate') {
    busy = true;
    actionError = null;
    try {
      const res = await fetch(`/api/crops/${data.crop.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        actionError = out.error ?? tr('crops.failed');
        return;
      }
      window.location.reload();
    } catch (e) {
      actionError = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function deepLink(path: string): string {
    const params = new URLSearchParams();
    params.set('crop', data.crop.id);
    return `${path}?${params.toString()}`;
  }

  async function deleteCrop() {
    if (!confirm(tr('crops.confirmDelete', { name: data.crop.varietyDisplayName }))) {
      return;
    }
    busy = true;
    actionError = null;
    try {
      const res = await fetch(`/api/crops/${data.crop.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        actionError = out.error ?? tr('crops.deleteFailed');
        return;
      }
      window.location.href = blockHref;
    } catch (e) {
      actionError = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{data.crop.varietyDisplayName} · CropCard</title>
</svelte:head>

<nav class="breadcrumb" aria-label={tr('crops.breadcrumb')}>
  <a href="/plan">{tr('crops.plan')}</a>
  <ChevronRight size={13} aria-hidden="true" />
  <a href={blockHref}>{data.block.name}</a>
  <ChevronRight size={13} aria-hidden="true" />
  <span aria-current="page">{data.crop.varietyDisplayName}</span>
</nav>

<header class="crop-header">
  <div>
    <Kicker>{kicker}</Kicker>
    <h1 class="serif">{data.crop.varietyDisplayName}</h1>
    <p class="meta">
      {tr('crops.block')} <strong>{data.block.name}</strong>
      {#if data.block.acres}— {prefsFmt.qty(data.block.acres, 'area')}{/if}
      {#if data.crop.plantingDate}· {tr('crops.planted', {
          date: fmtDay(data.crop.plantingDate)
        })}{:else}· {tr('crops.plannedNoDate')}{/if}
    </p>
  </div>
  <div class="status-row">
    <span class="status status-{data.crop.status}">{statusLabel(data.crop.status)}</span>
  </div>
</header>

{#if actionError}
  <p class="error" role="alert">{actionError}</p>
{/if}

<section class="card actions">
  <h2>{tr('crops.statusTitle')}</h2>
  {#if data.crop.status === 'active'}
    <div class="row">
      <button class="primary" onclick={() => changeStatus('mark-harvested')} disabled={busy}>
        {tr('crops.markHarvested')}
      </button>
      <button class="secondary" onclick={() => changeStatus('mark-failed')} disabled={busy}>
        {tr('crops.markFailed')}
      </button>
      <button class="secondary" onclick={() => changeStatus('archive')} disabled={busy}>
        {tr('crops.archive')}
      </button>
    </div>
  {:else if data.crop.status === 'planned'}
    <div class="row">
      <button class="primary" onclick={() => changeStatus('reactivate')} disabled={busy}>
        {tr('crops.activate')}
      </button>
      <button class="secondary" onclick={() => changeStatus('archive')} disabled={busy}>
        {tr('crops.archive')}
      </button>
    </div>
  {:else}
    <div class="row">
      <button class="secondary" onclick={() => changeStatus('reactivate')} disabled={busy}>
        {tr('crops.reactivate')}
      </button>
      {#if data.crop.status !== 'archived'}
        <button class="secondary" onclick={() => changeStatus('archive')} disabled={busy}>
          {tr('crops.archive')}
        </button>
      {/if}
    </div>
  {/if}
  {#if data.crop.harvestedAt}
    <p class="meta-row">{tr('crops.harvestedAt', { when: fmtDateTime(data.crop.harvestedAt) })}</p>
  {/if}
  {#if data.crop.archivedAt}
    <p class="meta-row">{tr('crops.archivedAt', { when: fmtDateTime(data.crop.archivedAt) })}</p>
  {/if}
  <hr />
  <details class="danger-zone">
    <summary>{tr('crops.dangerZone')}</summary>
    <p class="hint">{tr('crops.dangerHint')}</p>
    <button class="danger" onclick={deleteCrop} disabled={busy}>
      {tr('crops.deleteCrop')}
    </button>
  </details>
</section>

{#if data.cropPlugin?.daysToMaturity}
  <section class="card metrics">
    <h2>{tr('crops.plan')}</h2>
    <dl>
      <dt>{tr('crops.variety')}</dt>
      <dd>{data.cropPlugin.displayName}</dd>
      <dt>{tr('crops.family')}</dt>
      <dd>{data.cropPlugin.cropFamily}</dd>
      <dt>{tr('crops.dtm')}</dt>
      <dd>{data.cropPlugin.daysToMaturity.min}–{data.cropPlugin.daysToMaturity.max} d</dd>
    </dl>
  </section>
{/if}

<section class="card section">
  <header>
    <h2>{tr('crops.tasks', { count: data.tasks.length })}</h2>
    <a class="add" href="/today">{tr('crops.scheduleFromToday')}</a>
  </header>
  {#if data.tasks.length === 0}
    <p class="hint">{tr('crops.noTasks')}</p>
  {:else}
    <ul>
      {#each data.tasks as t (t.id)}
        <li>
          <span class="when">{fmtDay(t.scheduledFor)}</span>
          <strong>{t.title}</strong>
          <span class="kind-chip">{t.kind}</span>
          {#if t.completedAt}<span class="status status-harvested">{tr('crops.done')}</span>{/if}
          {#if t.abortedAt}<span class="status status-failed">{tr('crops.aborted')}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="card section">
  <header>
    <h2>{tr('crops.sprays', { count: data.sprays.length })}</h2>
    <a class="add" href={deepLink('/spray')}>{tr('crops.recordSpray')}</a>
  </header>
  {#if data.sprays.length === 0}
    <p class="hint">{tr('crops.noSprays')}</p>
  {:else}
    <ul>
      {#each data.sprays as s (s.id)}
        <li>
          <span class="when">{fmt(s.occurredAt)}</span>
          <strong>{s.products.map((p) => p.pluginId).join(', ')}</strong>
          <small
            >{tr('crops.chemistry', {
              list: s.products.flatMap((p) => p.chemistryClasses).join(' / ')
            })}</small
          >
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="card section">
  <header>
    <h2>{tr('crops.insecticides', { count: data.insecticides.length })}</h2>
    <a class="add" href={deepLink('/spray/insecticide')}>{tr('crops.record')}</a>
  </header>
  {#if data.insecticides.length === 0}
    <p class="hint">{tr('crops.noInsecticides')}</p>
  {:else}
    <ul>
      {#each data.insecticides as e (e.id)}
        <li>
          <span class="when">{fmt(e.occurredAt)}</span>
          <strong>{e.products.map((p) => p.displayName).join(', ')}</strong>
          {#if e.scoutObservation}<small
              >{tr('crops.triggeredBy', { pest: e.scoutObservation.pest })}</small
            >{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="card section">
  <header>
    <h2>{tr('crops.fertility', { count: data.fertilityApps.length })}</h2>
    <a class="add" href={deepLink('/fertility')}>{tr('crops.record')}</a>
  </header>
  {#if data.fertilityApps.length === 0}
    <p class="hint">{tr('crops.noFertility')}</p>
  {:else}
    <ul>
      {#each data.fertilityApps as f (f.id)}
        <li>
          <span class="when">{fmt(f.occurredAt)}</span>
          <strong>{f.source}</strong>
          <small
            >{f.ratePerAcre}
            {f.rateUnit} · N {f.nLbPerAcre?.toFixed(0) ?? 0} P {f.pLbPerAcre?.toFixed(0) ?? 0} K {f.kLbPerAcre?.toFixed(
              0
            ) ?? 0}</small
          >
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if data.cropPlugin?.hayOperations}
  <section class="card section">
    <header>
      <h2>{tr('crops.hay', { count: data.cuttings.length })}</h2>
      <a class="add" href={deepLink('/hay')}>{tr('crops.recordCutting')}</a>
    </header>
    {#if data.cuttings.length === 0}
      <p class="hint">{tr('crops.noCuttings')}</p>
    {:else}
      <ul>
        {#each data.cuttings as c (c.id)}
          <li>
            <strong>{tr('crops.cutting', { n: c.cuttingNumber, year: c.year })}</strong>
            <span class="status status-{c.status}">{c.status}</span>
            {#if c.balesQuantity}<small>{tr('crops.bales', { n: c.balesQuantity })}</small>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<section class="card section">
  <header>
    <h2>{tr('crops.harvests', { count: data.harvests.length })}</h2>
    <a class="add" href={deepLink('/harvest')}>{tr('crops.record')}</a>
  </header>
  {#if data.harvests.length === 0}
    <p class="hint">{tr('crops.noHarvests')}</p>
  {:else}
    <ul>
      {#each data.harvests as h (h.id)}
        <li>
          <span class="when">{fmt(h.occurredAt)}</span>
          {#if h.quantity}<strong>{h.quantity}</strong>{/if}
          {#if h.lotNumber}<small>{tr('crops.lot', { lot: h.lotNumber })}</small>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="card section">
  <header>
    <h2>{tr('crops.soilTests', { count: data.soilTests.length })}</h2>
    <small class="hint">{tr('crops.soilScope')}</small>
  </header>
  {#if data.soilTests.length === 0}
    <p class="hint">{tr('crops.noSoilTests')}</p>
  {:else}
    <ul>
      {#each data.soilTests as t (t.id)}
        <li>
          <span class="when">{fmt(t.sampledAt)}</span>
          {#if t.ph}<small>pH {t.ph.toFixed(1)}</small>{/if}
          {#if t.organicMatterPct}<small>OM {t.organicMatterPct.toFixed(1)}%</small>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if data.projected.length > 0}
  <section class="card section projected">
    <h2>{tr('crops.projected', { count: data.projected.length })}</h2>
    <p class="hint">{tr('crops.projectedHint')}</p>
    <ul>
      {#each data.projected as p (p.kind + p.startMs + p.title)}
        <li>
          <span class="when">{fmtDay(p.startMs)}</span>
          <strong>{p.title}</strong>
          <span class="kind-chip">{p.kind}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .crop-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 1rem;
    margin: 0 0 1rem;
  }
  .crop-header h1 {
    margin: 6px 0 0.25rem;
    font-family: var(--font-serif, serif);
    font-size: 30px;
    color: var(--color-forest-deep);
    letter-spacing: -0.02em;
  }
  .breadcrumb {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 13px;
    color: var(--color-ink-muted);
    margin-bottom: 8px;
  }
  .breadcrumb a {
    color: var(--color-forest);
    text-decoration: none;
    min-height: 48px;
    display: inline-flex;
    align-items: center;
  }
  .breadcrumb a:hover {
    text-decoration: underline;
  }
  .meta {
    color: #555;
    margin: 0;
  }
  .card {
    background: white;
    padding: 1rem 1.25rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.5rem;
  }
  .card header h2 {
    margin: 0;
  }
  .add {
    color: #1f5e3a;
    text-decoration: none;
    font-weight: 600;
    font-size: 0.85rem;
    padding: 0.4rem 0.75rem;
    border: 1px solid #1f5e3a;
    border-radius: 4px;
    min-height: 48px;
    display: inline-flex;
    align-items: center;
  }
  .add:hover {
    background: #e7f1ea;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .primary,
  .secondary {
    border: none;
    cursor: pointer;
    border-radius: 4px;
    font-weight: 600;
    padding: 0.55rem 1rem;
    min-height: 48px;
  }
  .primary {
    background: #1f5e3a;
    color: white;
  }
  .secondary {
    background: white;
    border: 1px solid #1f5e3a;
    color: #1f5e3a;
  }
  .primary:disabled,
  .secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    padding: 0.4rem 0;
    border-top: 1px solid #eee;
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    flex-wrap: wrap;
  }
  li:first-child {
    border-top: none;
  }
  .when {
    color: #888;
    font-size: 0.85rem;
    min-width: 6rem;
  }
  small {
    color: #666;
    font-size: 0.8rem;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.4rem 1rem;
    margin: 0;
  }
  dt {
    color: #666;
    font-size: 0.85rem;
  }
  dd {
    margin: 0;
  }
  .meta-row {
    color: #555;
    font-size: 0.85rem;
    margin: 0.5rem 0 0;
  }
  .hint {
    color: #777;
    font-size: 0.9rem;
    margin: 0.4rem 0;
  }
  .status {
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  .status-active {
    background: #e7f1ea;
    color: #1f5e3a;
  }
  .status-harvested {
    background: #fff8e1;
    color: #b35900;
  }
  .status-planned {
    background: #e3edf9;
    color: #1f3a5e;
  }
  .status-failed {
    background: #fce4e4;
    color: #b00020;
  }
  .status-archived {
    background: #ddd;
    color: #555;
  }
  .status-mowing,
  .status-tedding,
  .status-raking,
  .status-baling,
  .status-storing {
    background: #fff8e1;
    color: #b35900;
  }
  .status-complete {
    background: #1f5e3a;
    color: white;
  }
  .kind-chip {
    background: #f0f3f0;
    color: #555;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    text-transform: uppercase;
  }
  .error {
    background: #fce4e4;
    color: #b00020;
    padding: 0.6rem;
    border-radius: 4px;
  }
  .projected {
    border-left: 4px solid #1f5e3a;
  }
  hr {
    border: none;
    border-top: 1px solid #eee;
    margin: 1rem 0 0.5rem;
  }
  .danger-zone summary {
    cursor: pointer;
    color: #b00020;
    font-weight: 600;
  }
  .danger-zone .hint {
    margin: 0.6rem 0;
  }
  .danger {
    background: #b00020;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.7rem 1.2rem;
    font-weight: 700;
    cursor: pointer;
    min-height: 48px;
  }
  .danger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
