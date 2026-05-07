<script lang="ts">
  let { data } = $props();

  let blockId = $state(data.selectedBlockId);
  let year = $state(data.year);
  let busy = $state(false);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);

  // Application form
  let appSource = $state('10-10-10');
  let appRate = $state(200);
  let appUnit = $state('lb-per-acre');
  let appN = $state(20);
  let appP = $state(20);
  let appK = $state(20);

  // Credit form
  let creditSource = $state('cover-crop:crimson-clover-cover');
  let creditPlugin = $state('crimson-clover-cover');
  let creditN = $state<number | null>(null);
  let creditUseDefaults = $state(true);

  // Soil-test form
  let stPh = $state<number | null>(null);
  let stOM = $state<number | null>(null);
  let stNO3 = $state<number | null>(null);
  let stP = $state<number | null>(null);
  let stK = $state<number | null>(null);

  async function reload() {
    const url = new URL(window.location.href);
    url.searchParams.set('block', blockId);
    url.searchParams.set('year', String(year));
    window.location.href = url.toString();
  }

  async function recordApplication(e: Event) {
    e.preventDefault();
    busy = true;
    error = null;
    message = null;
    try {
      const res = await fetch('/api/fertility/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          blockId,
          source: appSource,
          ratePerAcre: appRate,
          rateUnit: appUnit,
          nLbPerAcre: appN,
          pLbPerAcre: appP,
          kLbPerAcre: appK
        })
      });
      const out = await res.json();
      if (!res.ok) {
        error = out.error ?? 'failed';
        return;
      }
      message = 'Application recorded.';
      reload();
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
        error = out.error ?? 'failed';
        return;
      }
      message = 'Credit recorded.';
      reload();
    } catch (e2) {
      error = e2 instanceof Error ? e2.message : String(e2);
    } finally {
      busy = false;
    }
  }

  async function recordSoilTest(e: Event) {
    e.preventDefault();
    busy = true;
    error = null;
    try {
      const res = await fetch('/api/fertility/soil-tests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          blockId,
          ph: stPh ?? undefined,
          organicMatterPct: stOM ?? undefined,
          nitratePpm: stNO3 ?? undefined,
          phosphorusPpm: stP ?? undefined,
          potassiumPpm: stK ?? undefined
        })
      });
      const out = await res.json();
      if (!res.ok) {
        error = out.error ?? 'failed';
        return;
      }
      message = 'Soil test recorded.';
      reload();
    } catch (e2) {
      error = e2 instanceof Error ? e2.message : String(e2);
    } finally {
      busy = false;
    }
  }
</script>

<h1>Fertility</h1>
<p class="lede">
  Per-block N / P / K budget. Applications + cover-crop credits + soil tests roll into a yearly
  delivered total. Crop demand comes from the planting plugin or operator override.
</p>

<form class="filter" on:submit|preventDefault={reload}>
  <label>
    Block
    <select bind:value={blockId}>
      {#each data.blocks as b (b.id)}
        <option value={b.id}>{b.name}{b.acres ? ` — ${b.acres} ac` : ''}</option>
      {/each}
    </select>
  </label>
  <label>
    Year
    <input type="number" min="1900" max="3000" bind:value={year} />
  </label>
  <button type="submit" class="primary">Load</button>
</form>

{#if data.budget}
  <section class="card budget">
    <h2>Year {data.budget.year} budget</h2>
    <table>
      <thead>
        <tr>
          <th></th>
          <th>N (lb/ac)</th>
          <th>P₂O₅ (lb/ac)</th>
          <th>K₂O (lb/ac)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Applications</th>
          <td>{data.budget.nDeliveredLbPerAcre.toFixed(1)}</td>
          <td>{data.budget.pDeliveredLbPerAcre.toFixed(1)}</td>
          <td>{data.budget.kDeliveredLbPerAcre.toFixed(1)}</td>
        </tr>
        <tr>
          <th scope="row">Cover-crop / residual credits</th>
          <td>{data.budget.nCreditedLbPerAcre.toFixed(1)}</td>
          <td>{data.budget.pCreditedLbPerAcre.toFixed(1)}</td>
          <td>{data.budget.kCreditedLbPerAcre.toFixed(1)}</td>
        </tr>
        <tr class="total">
          <th scope="row">Total available</th>
          <td>{data.budget.totalNLbPerAcre.toFixed(1)}</td>
          <td>{data.budget.totalPLbPerAcre.toFixed(1)}</td>
          <td>{data.budget.totalKLbPerAcre.toFixed(1)}</td>
        </tr>
      </tbody>
    </table>
  </section>
{/if}

{#if message}<p class="success">{message}</p>{/if}
{#if error}<p class="error">{error}</p>{/if}

<details class="card">
  <summary><h2>Record fertilizer application</h2></summary>
  <form on:submit={recordApplication}>
    <label>Source <input type="text" bind:value={appSource} /></label>
    <label>Rate <input type="number" min="0" step="any" bind:value={appRate} /></label>
    <label>Unit <input type="text" bind:value={appUnit} /></label>
    <label>N delivered (lb/ac) <input type="number" min="0" step="any" bind:value={appN} /></label>
    <label
      >P₂O₅ delivered (lb/ac) <input type="number" min="0" step="any" bind:value={appP} /></label
    >
    <label>K₂O delivered (lb/ac) <input type="number" min="0" step="any" bind:value={appK} /></label
    >
    <button type="submit" class="primary" disabled={busy}>Record</button>
  </form>
</details>

<details class="card">
  <summary><h2>Record cover-crop / residual credit</h2></summary>
  <form on:submit={recordCredit}>
    <label>Source <input type="text" bind:value={creditSource} /></label>
    <label>Cover-crop plugin id <input type="text" bind:value={creditPlugin} /></label>
    <label class="checkbox">
      <input type="checkbox" bind:checked={creditUseDefaults} />
      Use default credit table for this plugin
    </label>
    <label
      >Override N credit (lb/ac, optional) <input
        type="number"
        min="0"
        step="any"
        bind:value={creditN}
      /></label
    >
    <button type="submit" class="primary" disabled={busy}>Record credit</button>
  </form>
</details>

<details class="card">
  <summary><h2>Record soil test</h2></summary>
  <form on:submit={recordSoilTest}>
    <label>pH <input type="number" min="0" max="14" step="0.1" bind:value={stPh} /></label>
    <label
      >Organic matter % <input
        type="number"
        min="0"
        max="100"
        step="0.1"
        bind:value={stOM}
      /></label
    >
    <label>Nitrate (ppm) <input type="number" min="0" bind:value={stNO3} /></label>
    <label>Phosphorus (ppm) <input type="number" min="0" bind:value={stP} /></label>
    <label>Potassium (ppm) <input type="number" min="0" bind:value={stK} /></label>
    <button type="submit" class="primary" disabled={busy}>Record soil test</button>
  </form>
</details>

<section class="card">
  <h2>History — applications</h2>
  {#if data.applications.length === 0}
    <p>No applications recorded for this block.</p>
  {:else}
    <ul>
      {#each data.applications as a (a.id)}
        <li>
          {new Date(a.occurredAt).toLocaleDateString()} —
          {a.source} · {a.ratePerAcre}
          {a.rateUnit}
          ({a.nLbPerAcre?.toFixed(0) ?? 0} N · {a.pLbPerAcre?.toFixed(0) ?? 0} P ·
          {a.kLbPerAcre?.toFixed(0) ?? 0} K lb/ac)
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="card">
  <h2>History — cover-crop credits</h2>
  {#if data.credits.length === 0}
    <p>No credits recorded.</p>
  {:else}
    <ul>
      {#each data.credits as c (c.id)}
        <li>
          {c.appliesToYear} — {c.source}
          ({c.nLbPerAcre?.toFixed(0) ?? 0} N · {c.pLbPerAcre?.toFixed(0) ?? 0} P ·
          {c.kLbPerAcre?.toFixed(0) ?? 0} K lb/ac)
          {#if c.notes}<br /><em class="hint">{c.notes}</em>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="card">
  <h2>History — soil tests</h2>
  {#if data.soilTests.length === 0}
    <p>No soil tests yet.</p>
  {:else}
    <ul>
      {#each data.soilTests as t (t.id)}
        <li>
          {new Date(t.sampledAt).toLocaleDateString()} — pH {t.ph?.toFixed(1) ?? '?'}, OM {t.organicMatterPct?.toFixed(
            1
          ) ?? '?'}%, NO₃ {t.nitratePpm ?? '?'} ppm
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
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
