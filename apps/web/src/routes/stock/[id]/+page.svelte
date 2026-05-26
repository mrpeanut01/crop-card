<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { untrack } from 'svelte';
  import { ALL_STOCK_UNITS, type StockUnit } from '$lib/stock/units';

  let { data } = $props();
  const item = $derived(data.item);

  // Receive new lot
  let receiveQty = $state<number | undefined>(undefined);
  let receiveUnit = $state<StockUnit>(untrack(() => item.defaultUnit));
  let lotNumber = $state('');
  let expiresIso = $state('');
  let supplier = $state('');
  let receiving = $state(false);
  let receiveError = $state<string | null>(null);

  async function receive() {
    if (!receiveQty || receiveQty <= 0) return;
    receiving = true;
    receiveError = null;
    try {
      const res = await fetch(`/api/stock/${encodeURIComponent(item.id)}/lots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivedQuantity: receiveQty,
          unit: receiveUnit,
          lotNumber: lotNumber || undefined,
          expiresAt: expiresIso ? new Date(expiresIso).getTime() : undefined,
          supplier: supplier || undefined
        })
      });
      const out = await res.json();
      if (!res.ok) {
        receiveError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      receiveQty = undefined;
      lotNumber = '';
      expiresIso = '';
      supplier = '';
      await invalidateAll();
    } catch (e) {
      receiveError = e instanceof Error ? e.message : String(e);
    } finally {
      receiving = false;
    }
  }

  // Manual adjustment
  let adjustLotId = $state<string>(untrack(() => data.lots[0]?.id ?? ''));
  let adjustDelta = $state(0);
  let adjustUnit = $state<StockUnit>(untrack(() => item.defaultUnit));
  let adjustReason = $state<'adjustment' | 'spill' | 'expiry'>('adjustment');
  let adjustNotes = $state('');
  let adjusting = $state(false);
  let adjustError = $state<string | null>(null);

  async function adjust() {
    if (!adjustLotId || adjustDelta === 0) return;
    adjusting = true;
    adjustError = null;
    try {
      const res = await fetch('/api/stock/movements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stockLotId: adjustLotId,
          delta: adjustDelta,
          unit: adjustUnit,
          reason: adjustReason,
          notes: adjustNotes || undefined
        })
      });
      const out = await res.json();
      if (!res.ok) {
        adjustError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      adjustDelta = 0;
      adjustNotes = '';
      await invalidateAll();
    } catch (e) {
      adjustError = e instanceof Error ? e.message : String(e);
    } finally {
      adjusting = false;
    }
  }

  function fmt(ts?: number) {
    return ts ? new Date(ts).toLocaleString() : '—';
  }
  function fmtDate(ts?: number) {
    return ts ? new Date(ts).toLocaleDateString() : '—';
  }
  function lotLabel(lot: { lotNumber?: string; receivedAt: number }) {
    return lot.lotNumber ?? `received ${fmtDate(lot.receivedAt)}`;
  }

  type PlateConfig = {
    plateNumber: string;
    series?: string;
    brand?: string;
    cells?: number;
    color?: string;
    dimensions?: string;
    L?: number;
    D?: number;
    T?: number;
    shape?: string;
    seedType?: string;
    gradeSize?: string;
    seedDimensions?: { L?: number; D?: number; T?: number; tolerance?: number };
    savedAt?: string;
  };
  const plateConfig = $derived.by<PlateConfig | null>(() => {
    if (!item.metadataJson) return null;
    try {
      const parsed = JSON.parse(item.metadataJson);
      return (parsed?.planterPlateConfig as PlateConfig) ?? null;
    } catch {
      return null;
    }
  });
</script>

<svelte:head>
  <title>{item.displayName} · Stock · CropCard</title>
</svelte:head>

<header class="head">
  <a href="/stock" class="back">← Inventory</a>
  <h1>{item.displayName}</h1>
  <p class="meta">
    <span class="cat">{item.category}</span>
    {#if item.pluginId}<code>{item.pluginId}</code>{/if}
    <span class="unit">tracked in {item.defaultUnit}</span>
  </p>
</header>

<section class="card summary">
  <h2>Summary</h2>
  <dl>
    <dt>On hand</dt>
    <dd>
      <span class="big">{data.lots.reduce((acc, l) => acc + l.balance, 0).toFixed(2)}</span>
      {item.defaultUnit}
    </dd>
    {#if item.reorderThreshold !== undefined}
      <dt>Reorder threshold</dt>
      <dd>{item.reorderThreshold} {item.defaultUnit}</dd>
    {/if}
    <dt>Lot count</dt>
    <dd>{data.lots.length}</dd>
  </dl>
  {#if item.notes}<p class="notes">{item.notes}</p>{/if}
</section>

{#if item.category === 'seed'}
  <section class="card planter-plate-card" aria-labelledby="plate-h">
    <h2 id="plate-h">Planter plate</h2>
    {#if plateConfig}
      <dl class="plate-summary">
        <dt>Plate</dt>
        <dd><strong class="plate-num">{plateConfig.plateNumber}</strong></dd>
        {#if plateConfig.color}
          <dt>Color</dt>
          <dd>{plateConfig.color}</dd>
        {/if}
        {#if plateConfig.dimensions}
          <dt>Dimensions</dt>
          <dd>{plateConfig.dimensions} <small>(L-D-T, 64ths in)</small></dd>
        {/if}
        {#if plateConfig.shape}
          <dt>Shape</dt>
          <dd>{plateConfig.shape}</dd>
        {/if}
        {#if plateConfig.cells !== undefined}
          <dt>Cells</dt>
          <dd>{plateConfig.cells}</dd>
        {/if}
        {#if plateConfig.series}
          <dt>Series</dt>
          <dd>{plateConfig.series === 'B' ? 'John Deere (B)' : 'IHC (C)'}</dd>
        {/if}
        {#if plateConfig.seedDimensions && (plateConfig.seedDimensions.L ?? plateConfig.seedDimensions.D ?? plateConfig.seedDimensions.T) !== undefined}
          <dt>Seed dims used</dt>
          <dd>
            {plateConfig.seedDimensions.L ?? '—'}-{plateConfig.seedDimensions.D ?? '—'}-{plateConfig
              .seedDimensions.T ?? '—'}
            (±{plateConfig.seedDimensions.tolerance ?? 0})
          </dd>
        {/if}
      </dl>
      <a class="secondary" href="/tools/planter-plate-selector?stockId={item.id}"
        >Re-run plate selector</a
      >
    {:else}
      <p class="empty">No plate matched to this seed yet.</p>
      <a class="primary" href="/tools/planter-plate-selector?stockId={item.id}"
        >Find planter plate</a
      >
    {/if}
  </section>
{/if}

{#if data.canEdit}
  <section class="card">
    <h2>Receive new lot</h2>
    <div class="grid">
      <label>
        Quantity
        <input type="number" min="0.01" step="0.01" bind:value={receiveQty} />
      </label>
      <label>
        Unit
        <select bind:value={receiveUnit}>
          {#each ALL_STOCK_UNITS as u}<option value={u}>{u}</option>{/each}
        </select>
      </label>
      <label>
        Lot number
        <input type="text" placeholder="e.g. 2026-A-7" bind:value={lotNumber} />
      </label>
      <label>
        Expires
        <input type="date" bind:value={expiresIso} />
      </label>
      <label>
        Supplier
        <input type="text" bind:value={supplier} />
      </label>
    </div>
    <button class="primary" onclick={receive} disabled={receiving || !receiveQty}>
      {receiving ? '…' : 'Receive lot'}
    </button>
    {#if receiveError}<p class="error">{receiveError}</p>{/if}
  </section>
{/if}

<section class="card">
  <h2>Lots</h2>
  {#if data.lots.length === 0}
    <p class="empty">No lots received yet.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Lot</th>
          <th>Received</th>
          <th>Initial</th>
          <th>Balance</th>
          <th>Expires</th>
          <th>Supplier</th>
        </tr>
      </thead>
      <tbody>
        {#each data.lots as lot (lot.id)}
          <tr
            class:expiring={lot.daysUntilExpiry !== null &&
              lot.daysUntilExpiry <= 30 &&
              lot.daysUntilExpiry >= 0}
            class:expired={lot.daysUntilExpiry !== null && lot.daysUntilExpiry < 0}
          >
            <td><code>{lot.lotNumber ?? '—'}</code></td>
            <td>{fmtDate(lot.receivedAt)}</td>
            <td>{lot.receivedQuantity}</td>
            <td><strong>{lot.balance}</strong></td>
            <td>
              {fmtDate(lot.expiresAt)}
              {#if lot.daysUntilExpiry !== null}
                {#if lot.daysUntilExpiry < 0}
                  <span class="bad">(expired {Math.abs(lot.daysUntilExpiry)}d ago)</span>
                {:else if lot.daysUntilExpiry <= 30}
                  <span class="warn">({lot.daysUntilExpiry}d left)</span>
                {/if}
              {/if}
            </td>
            <td>{lot.supplier ?? '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

{#if data.canEdit && data.lots.length > 0}
  <section class="card">
    <h2>Manual adjustment</h2>
    <p class="hint">
      For spills, end-of-season audits, or reversing a mistaken auto-decrement. Positive delta adds,
      negative subtracts.
    </p>
    <div class="grid">
      <label>
        Lot
        <select bind:value={adjustLotId}>
          {#each data.lots as lot (lot.id)}
            <option value={lot.id}>{lotLabel(lot)} (balance {lot.balance})</option>
          {/each}
        </select>
      </label>
      <label>
        Delta (+/-)
        <input type="number" step="0.01" bind:value={adjustDelta} />
      </label>
      <label>
        Unit
        <select bind:value={adjustUnit}>
          {#each ALL_STOCK_UNITS as u}<option value={u}>{u}</option>{/each}
        </select>
      </label>
      <label>
        Reason
        <select bind:value={adjustReason}>
          <option value="adjustment">Adjustment</option>
          <option value="spill">Spill</option>
          <option value="expiry">Expiry write-off</option>
        </select>
      </label>
      <label>
        Notes
        <input type="text" bind:value={adjustNotes} />
      </label>
    </div>
    <button class="primary" onclick={adjust} disabled={adjusting || adjustDelta === 0}>
      {adjusting ? '…' : 'Record movement'}
    </button>
    {#if adjustError}<p class="error">{adjustError}</p>{/if}
  </section>
{/if}

<section class="card">
  <h2>Movement history ({data.movements.length})</h2>
  {#if data.movements.length === 0}
    <p class="empty">No movements yet.</p>
  {:else}
    <ul class="movements">
      {#each data.movements as m (m.id)}
        <li class="movement reason-{m.reason}">
          <header>
            <span class="reason">{m.reason}</span>
            <time>{fmt(m.occurredAt)}</time>
            <span class="delta {m.delta < 0 ? 'neg' : 'pos'}">
              {m.delta > 0 ? '+' : ''}{m.delta}
              {item.defaultUnit}
            </span>
          </header>
          {#if m.notes}<p>{m.notes}</p>{/if}
          {#if m.sprayEventId}
            <small>spray event: <code>{m.sprayEventId.slice(0, 8)}…</code></small>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .head .back {
    color: #1f5e3a;
    text-decoration: none;
    font-weight: 600;
    display: inline-block;
    margin-bottom: 0.5rem;
  }
  .head h1 {
    margin: 0 0 0.25rem;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin: 0 0 1.5rem;
  }
  .cat {
    background: #e7f1ea;
    color: #1f5e3a;
    padding: 0.05rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  .meta code {
    background: #f5f5f5;
    color: #555;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.8rem;
  }
  .unit {
    color: #555;
    font-size: 0.85rem;
  }
  .card {
    background: white;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: #1f5e3a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .summary {
    background: #f8fbf9;
    border-left: 4px solid #1f5e3a;
  }
  .planter-plate-card {
    background: #f8fbf9;
    border-left: 4px solid #4d8e36;
  }
  .planter-plate-card .plate-summary {
    margin-bottom: 0.75rem;
  }
  .planter-plate-card .plate-num {
    font-family: monospace;
    font-size: 1.1rem;
    color: #1f5e3a;
  }
  .planter-plate-card .secondary,
  .planter-plate-card .primary {
    display: inline-block;
    text-decoration: none;
    padding: 0.6rem 1rem;
    border-radius: 6px;
    font-weight: 600;
    min-height: 48px;
    line-height: 1.6;
  }
  .planter-plate-card .secondary {
    background: white;
    color: #1f5e3a;
    border: 2px solid #1f5e3a;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.4rem 1rem;
    margin: 0;
  }
  dt {
    color: #666;
  }
  dd {
    margin: 0;
  }
  .big {
    font-family: monospace;
    font-weight: 700;
    font-size: 1.5rem;
    color: #1f5e3a;
  }
  .notes {
    color: #555;
    font-size: 0.9rem;
    margin: 0.75rem 0 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 0.5rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  input[type='text'],
  input[type='number'],
  input[type='date'],
  select {
    padding: 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
    font-family: inherit;
  }
  .primary {
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.75rem 1.25rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
    margin-top: 0.5rem;
  }
  .primary:disabled {
    background: #999;
    cursor: not-allowed;
  }
  .error {
    color: #b00020;
  }
  .empty {
    color: #555;
    font-style: italic;
  }
  .hint {
    color: #555;
    font-size: 0.9rem;
    margin: 0 0 0.5rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th,
  td {
    padding: 0.5rem;
    text-align: left;
    border-bottom: 1px solid #eee;
  }
  th {
    background: #f5f7f4;
    color: #1f5e3a;
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.5px;
  }
  td code {
    background: #f5f5f5;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.8rem;
  }
  tr.expiring td {
    background: #fff8ec;
  }
  tr.expired td {
    background: #fce8e8;
    color: #b00020;
  }
  .warn {
    color: #b35900;
    font-weight: 600;
    font-size: 0.85rem;
  }
  .bad {
    color: #b00020;
    font-weight: 600;
    font-size: 0.85rem;
  }
  .movements {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .movement {
    background: #f8fbf9;
    border-left: 4px solid #1f5e3a;
    padding: 0.6rem 0.9rem;
    margin: 0.4rem 0;
    border-radius: 0 4px 4px 0;
  }
  .movement.reason-spray-event {
    border-left-color: #b35900;
    background: #fff8ec;
  }
  .movement.reason-receipt {
    border-left-color: #4d8e36;
  }
  .movement.reason-spill,
  .movement.reason-expiry {
    border-left-color: #b00020;
    background: #fef0f0;
  }
  .movement header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .reason {
    background: white;
    color: #1f5e3a;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  time {
    color: #666;
    font-size: 0.85rem;
    font-family: monospace;
  }
  .delta {
    font-family: monospace;
    font-weight: 700;
    margin-left: auto;
  }
  .delta.pos {
    color: #1f5e3a;
  }
  .delta.neg {
    color: #b00020;
  }
  .movement p {
    margin: 0.4rem 0 0;
  }
  .movement small {
    display: block;
    color: #777;
    margin-top: 0.4rem;
  }
</style>
