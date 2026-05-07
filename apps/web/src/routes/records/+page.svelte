<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  let { data } = $props();

  let pendingCount = $state<number | null>(null);

  onMount(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    (async () => {
      try {
        const { pendingCount: count } = await import('$lib/client/syncQueue');
        const refresh = async () => {
          try {
            pendingCount = await count();
          } catch {
            pendingCount = null;
          }
        };
        await refresh();
        interval = setInterval(refresh, 4000);
      } catch {
        // IndexedDB unavailable — leave pendingCount null.
      }
    })();
    return () => {
      if (interval) clearInterval(interval);
    };
  });

  const exportQuery = $derived.by(() => {
    const params = new URLSearchParams();
    if (data.activeSprayerId) params.set('sprayerId', data.activeSprayerId);
    if (data.activeBlockId) params.set('blockId', data.activeBlockId);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  });

  function applyFilter(field: 'sprayerId' | 'blockId', value: string) {
    const params = new URLSearchParams();
    if (data.activeSprayerId && field !== 'sprayerId')
      params.set('sprayerId', data.activeSprayerId);
    if (data.activeBlockId && field !== 'blockId') params.set('blockId', data.activeBlockId);
    if (value) params.set(field, value);
    const qs = params.toString();
    goto(qs ? `/records?${qs}` : '/records', { invalidateAll: true });
  }
</script>

<header class="head">
  <h1>Spray records</h1>
  <p class="lede">
    {data.records.length} record{data.records.length === 1 ? '' : 's'}
    {data.activeSprayerId || data.activeBlockId ? 'matching filter' : 'on file'}. Records lock 48
    hours after occurrence (FR-09). Retention 2 years (NFR-05).
  </p>
  <div class="filters" role="group" aria-label="Filters">
    <label>
      Sprayer
      <select
        value={data.activeSprayerId ?? ''}
        onchange={(e) => applyFilter('sprayerId', (e.target as HTMLSelectElement).value)}
      >
        <option value="">All sprayers</option>
        {#each data.sprayers as s (s.id)}
          <option value={s.id}>{s.label} ({s.id})</option>
        {/each}
      </select>
    </label>
    <label>
      Block
      <select
        value={data.activeBlockId ?? ''}
        onchange={(e) => applyFilter('blockId', (e.target as HTMLSelectElement).value)}
      >
        <option value="">All blocks</option>
        {#each data.blocks as b (b.id)}
          <option value={b.id}>{b.name}</option>
        {/each}
      </select>
    </label>
  </div>
  <div class="actions">
    <a class="btn" href="/api/spray/records/export.csv{exportQuery}" download>Download CSV</a>
    <a class="btn" href="/api/spray/records/export.pdf{exportQuery}" download>Download PDF</a>
    <a
      class="btn-secondary"
      class:has-pending={pendingCount && pendingCount > 0}
      href="/records/pending"
    >
      Pending sync queue
      {#if pendingCount && pendingCount > 0}
        <span class="pending-badge">{pendingCount}</span>
      {/if}
    </a>
  </div>
</header>

{#if data.approachingRetention.length > 0}
  <section class="alert">
    ⚠ {data.approachingRetention.length} record(s) approaching the 2-year retention horizon. Confirm with
    owner before any deletion.
  </section>
{/if}

{#if data.records.length === 0}
  <section class="empty">
    <h2>No records yet</h2>
    <p>Plan a spray on the <a href="/spray">/spray</a> page and confirm to record an event.</p>
  </section>
{:else}
  <table>
    <thead>
      <tr>
        <th>When</th>
        <th>Block</th>
        <th>Sprayer</th>
        <th>Products</th>
        <th>Chemistry</th>
        <th>Wind / Temp / Rain</th>
        <th>Rules</th>
        <th>State</th>
      </tr>
    </thead>
    <tbody>
      {#each data.records as r (r.id)}
        <tr>
          <td>{new Date(r.occurredAt).toLocaleString()}</td>
          <td><code>{r.blockId}</code></td>
          <td><code>{r.sprayerId}</code></td>
          <td>
            {#each r.products as p (p.pluginId)}
              <div>{p.pluginId}</div>
            {/each}
          </td>
          <td>
            {Array.from(new Set(r.products.flatMap((p) => p.chemistryClasses))).join(', ')}
          </td>
          <td class="cond">
            {r.conditions.windMph} mph / {r.conditions.tempF}°F / {r.conditions
              .rainForecastMmNext24h}mm
          </td>
          <td><code>{r.rulesVersion}</code></td>
          <td>
            {#if r.locked}
              <span class="locked">🔒 locked</span>
            {:else}
              <span class="mutable">editable</span>
            {/if}
            {#if r.customRateOverride}
              <span class="override">custom rate</span>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .head h1 {
    margin: 0;
  }
  .lede {
    color: #555;
    margin: 0.25rem 0 1rem;
  }
  .actions {
    margin-bottom: 1rem;
  }
  .btn {
    display: inline-block;
    background: #1f5e3a;
    color: white;
    padding: 0.75rem 1.25rem;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
    min-height: 48px;
    line-height: 1.4;
    margin-right: 0.5rem;
  }
  .btn-secondary {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background: white;
    color: #1f5e3a;
    border: 2px solid #1f5e3a;
    padding: 0.6rem 1.1rem;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
    min-height: 48px;
    line-height: 1.4;
  }
  .btn-secondary.has-pending {
    background: #fff3cd;
    border-color: #4a2900;
    color: #4a2900;
  }
  .pending-badge {
    background: #b71c1c;
    color: white;
    border-radius: 999px;
    padding: 0.1rem 0.55rem;
    font-size: 0.85rem;
    min-width: 1.8rem;
    text-align: center;
  }
  .filters {
    display: flex;
    gap: 0.75rem;
    margin: 0.75rem 0;
    flex-wrap: wrap;
  }
  .filters label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
    color: #555;
    flex: 1 1 200px;
  }
  .filters select {
    padding: 0.5rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 44px;
    font-family: inherit;
  }
  .alert {
    background: #fff3cd;
    color: #b35900;
    padding: 0.75rem 1rem;
    border-radius: 4px;
    margin-bottom: 1rem;
    border-left: 4px solid #b35900;
  }
  .empty {
    background: white;
    padding: 2rem;
    border-radius: 8px;
    text-align: center;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    background: white;
    border-radius: 8px;
    overflow: hidden;
    font-size: 0.9rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.6rem;
    border-bottom: 1px solid #eee;
    vertical-align: top;
  }
  th {
    background: #f5f7f4;
    color: #1f5e3a;
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.5px;
  }
  code {
    background: #f5f5f5;
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    font-size: 0.8rem;
  }
  .cond {
    font-family: monospace;
    font-size: 0.85rem;
  }
  .locked {
    color: #b00020;
    font-weight: 600;
  }
  .mutable {
    color: #1f5e3a;
  }
  .override {
    background: #fff3cd;
    color: #b35900;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 600;
    margin-left: 0.4rem;
  }
</style>
