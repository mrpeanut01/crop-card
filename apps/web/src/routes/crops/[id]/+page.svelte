<script lang="ts">
  let { data } = $props();

  let busy = $state(false);
  let actionError = $state<string | null>(null);

  function fmt(ms: number): string {
    return new Date(ms).toLocaleDateString();
  }

  function fmtDateTime(ms: number): string {
    return new Date(ms).toLocaleString();
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
        actionError = out.error ?? 'failed';
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
    if (
      !confirm(
        `Delete crop "${data.crop.varietyDisplayName}" and all attached events? This cascades through every spray, harvest, insecticide, hay cutting, and fertility application tied to this crop, plus all tasks. This cannot be undone.`
      )
    ) {
      return;
    }
    busy = true;
    actionError = null;
    try {
      const res = await fetch(`/api/crops/${data.crop.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        actionError = out.error ?? 'delete failed';
        return;
      }
      window.location.href = '/crops';
    } catch (e) {
      actionError = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<header class="crop-header">
  <div>
    <h1>{data.crop.varietyDisplayName}</h1>
    <p class="meta">
      Block <strong>{data.block.name}</strong>
      {#if data.block.acres}— {data.block.acres} ac{/if}
      {#if data.crop.plantingDate}· Planted {fmt(data.crop.plantingDate)}{:else}· Planned — no date set{/if}
    </p>
  </div>
  <div class="status-row">
    <span class="status status-{data.crop.status}">{data.crop.status}</span>
  </div>
</header>

{#if actionError}
  <p class="error" role="alert">{actionError}</p>
{/if}

<section class="card actions">
  <h2>Status</h2>
  {#if data.crop.status === 'active'}
    <div class="row">
      <button class="primary" onclick={() => changeStatus('mark-harvested')} disabled={busy}>
        ✓ Mark harvested
      </button>
      <button class="secondary" onclick={() => changeStatus('mark-failed')} disabled={busy}>
        Mark failed
      </button>
      <button class="secondary" onclick={() => changeStatus('archive')} disabled={busy}>
        Archive
      </button>
    </div>
  {:else if data.crop.status === 'planned'}
    <div class="row">
      <button class="primary" onclick={() => changeStatus('reactivate')} disabled={busy}>
        Activate (move to active)
      </button>
      <button class="secondary" onclick={() => changeStatus('archive')} disabled={busy}>
        Archive
      </button>
    </div>
  {:else}
    <div class="row">
      <button class="secondary" onclick={() => changeStatus('reactivate')} disabled={busy}>
        Re-activate
      </button>
      {#if data.crop.status !== 'archived'}
        <button class="secondary" onclick={() => changeStatus('archive')} disabled={busy}>
          Archive
        </button>
      {/if}
    </div>
  {/if}
  {#if data.crop.harvestedAt}
    <p class="meta-row">Harvested: {fmtDateTime(data.crop.harvestedAt)}</p>
  {/if}
  {#if data.crop.archivedAt}
    <p class="meta-row">Archived: {fmtDateTime(data.crop.archivedAt)}</p>
  {/if}
  <hr />
  <details class="danger-zone">
    <summary>⚠ Danger zone</summary>
    <p class="hint">
      Permanently deletes this crop AND every event attached to it (spray records, insecticide
      records, harvest events, hay cuttings, fertility apps, tasks, plus stock movements that cite
      those events). Block-level data (the block itself, soil tests, fertility credits) is not
      affected.
    </p>
    <button class="danger" onclick={deleteCrop} disabled={busy}>
      🗑 Delete crop + all attached events
    </button>
  </details>
</section>

{#if data.cropPlugin?.daysToMaturity}
  <section class="card metrics">
    <h2>Plan</h2>
    <dl>
      <dt>Variety plugin</dt>
      <dd>{data.cropPlugin.displayName}</dd>
      <dt>Family</dt>
      <dd>{data.cropPlugin.cropFamily}</dd>
      <dt>Days to maturity</dt>
      <dd>{data.cropPlugin.daysToMaturity.min}–{data.cropPlugin.daysToMaturity.max} d</dd>
    </dl>
  </section>
{/if}

<section class="card section">
  <header>
    <h2>Tasks ({data.tasks.length})</h2>
    <a class="add" href="/today">+ Schedule from /today</a>
  </header>
  {#if data.tasks.length === 0}
    <p class="hint">No tasks attached. Schedule one from /today's calendar suggestions.</p>
  {:else}
    <ul>
      {#each data.tasks as t (t.id)}
        <li>
          <span class="when">{fmtDateTime(t.scheduledFor)}</span>
          <strong>{t.title}</strong>
          <span class="kind-chip">{t.kind}</span>
          {#if t.completedAt}<span class="status status-harvested">done</span>{/if}
          {#if t.abortedAt}<span class="status status-failed">aborted</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="card section">
  <header>
    <h2>Spray events ({data.sprays.length})</h2>
    <a class="add" href={deepLink('/spray')}>+ Record spray</a>
  </header>
  {#if data.sprays.length === 0}
    <p class="hint">No sprays for this crop yet.</p>
  {:else}
    <ul>
      {#each data.sprays as s (s.id)}
        <li>
          <span class="when">{fmt(s.occurredAt)}</span>
          <strong>{s.products.map((p) => p.pluginId).join(', ')}</strong>
          <small>chemistry: {s.products.flatMap((p) => p.chemistryClasses).join(' / ')}</small>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="card section">
  <header>
    <h2>Insecticide events ({data.insecticides.length})</h2>
    <a class="add" href={deepLink('/insecticides')}>+ Record</a>
  </header>
  {#if data.insecticides.length === 0}
    <p class="hint">No insecticide events.</p>
  {:else}
    <ul>
      {#each data.insecticides as e (e.id)}
        <li>
          <span class="when">{fmt(e.occurredAt)}</span>
          <strong>{e.products.map((p) => p.displayName).join(', ')}</strong>
          {#if e.scoutObservation}<small>(triggered by {e.scoutObservation.pest})</small>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="card section">
  <header>
    <h2>Fertility applications ({data.fertilityApps.length})</h2>
    <a class="add" href={deepLink('/fertility')}>+ Record</a>
  </header>
  {#if data.fertilityApps.length === 0}
    <p class="hint">No fertility applications.</p>
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
      <h2>Hay cuttings ({data.cuttings.length})</h2>
      <a class="add" href={deepLink('/hay')}>+ Record cutting</a>
    </header>
    {#if data.cuttings.length === 0}
      <p class="hint">No cuttings recorded for this crop.</p>
    {:else}
      <ul>
        {#each data.cuttings as c (c.id)}
          <li>
            <strong>Cutting #{c.cuttingNumber} ({c.year})</strong>
            <span class="status status-{c.status}">{c.status}</span>
            {#if c.balesQuantity}<small>{c.balesQuantity} bales</small>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<section class="card section">
  <header>
    <h2>Harvest events ({data.harvests.length})</h2>
    <a class="add" href={deepLink('/harvest')}>+ Record</a>
  </header>
  {#if data.harvests.length === 0}
    <p class="hint">No harvest events.</p>
  {:else}
    <ul>
      {#each data.harvests as h (h.id)}
        <li>
          <span class="when">{fmt(h.occurredAt)}</span>
          {#if h.quantity}<strong>{h.quantity}</strong>{/if}
          {#if h.lotNumber}<small>lot {h.lotNumber}</small>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="card section">
  <header>
    <h2>Soil tests ({data.soilTests.length})</h2>
    <small class="hint">Block-scoped — shared across all crops on the block.</small>
  </header>
  {#if data.soilTests.length === 0}
    <p class="hint">No soil tests for this block.</p>
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
    <h2>Projected ({data.projected.length})</h2>
    <p class="hint">
      From the calendar engine — not yet promoted to tasks. Visit /today to schedule.
    </p>
    <ul>
      {#each data.projected as p (p.kind + p.startMs + p.title)}
        <li>
          <span class="when">{fmt(p.startMs)}</span>
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
    margin: 0 0 0.25rem;
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
    min-height: 36px;
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
    min-height: 44px;
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
