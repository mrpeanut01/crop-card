<script lang="ts">
  import { fmt } from '$lib/prefsState.svelte';
  import { headCountText, type YearAnimalSection } from '$lib/records/yearSummaryAnimals';

  const {
    section,
    year,
    canExportLog
  }: { section: YearAnimalSection; year: number; canExportLog: boolean } = $props();

  const speciesName = (id: string) => section.speciesNames[id] ?? 'Unknown species';
  const range = $derived(`from=${year}-01-01&to=${year}-12-31`);
</script>

<section class="animal-review" aria-labelledby="animal-review-heading">
  <h3 id="animal-review-heading">Animals</h3>
  <p class="note">From records on file.</p>

  <div class="grid">
    <article class="card">
      <h4>Head count</h4>
      {#if section.headCounts.length}
        <table>
          <thead>
            <tr
              ><th>Species</th><th class="num">Start of {year}</th><th class="num">End of {year}</th
              ></tr
            >
          </thead>
          <tbody>
            {#each section.headCounts as h (h.speciesId)}
              <tr>
                <td>{speciesName(h.speciesId)}</td>
                <td class="num">{headCountText(h.atStart)}</td>
                <td class="num">{headCountText(h.atEnd)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="empty">No animals on file this year.</p>
      {/if}
    </article>

    <article class="card">
      <h4>Arrivals and departures</h4>
      {#if section.movements.length}
        <table>
          <thead><tr><th>Species</th><th>What happened</th><th class="num">Head</th></tr></thead>
          <tbody>
            {#each section.movements as m (`${m.speciesId}:${m.kind}`)}
              <tr>
                <td>{speciesName(m.speciesId)}</td>
                <td>{m.label}</td>
                <td class="num">{headCountText(m.head)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="empty">No arrivals or departures recorded this year.</p>
      {/if}
    </article>

    <article class="card">
      <h4>Treatments by product</h4>
      {#if section.treatments.length}
        <table>
          <thead><tr><th>Product</th><th class="num">Doses</th><th>Given to</th></tr></thead>
          <tbody>
            {#each section.treatments as t (t.product)}
              <tr>
                <td>{t.product}</td>
                <td class="num">{t.doses}</td>
                <td>{t.subjects.join(', ')}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="empty">No treatments, vaccines or wormers recorded this year.</p>
      {/if}
    </article>

    <article class="card">
      <h4>Eggs and milk</h4>
      {#if section.production.length}
        <table>
          <thead
            ><tr><th>Food</th><th>Use</th><th class="num">Total</th><th class="num">Logs</th></tr
            ></thead
          >
          <tbody>
            {#each section.production as p (`${p.food}:${p.use}:${p.unit}`)}
              <tr>
                <td>{p.food === 'eggs' ? 'Eggs' : 'Milk'}</td>
                <td>{p.useLabel}</td>
                <td class="num">{p.quantity} {p.unit}</td>
                <td class="num">{p.logs}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="empty">No eggs or milk logged this year.</p>
      {/if}
    </article>

    <article class="card wide">
      <h4>Food or sales inside a hold</h4>
      {#if section.covered.length}
        <table>
          <thead><tr><th>Date</th><th>Animal or group</th><th>What</th><th>Hold</th></tr></thead>
          <tbody>
            {#each section.covered as c (`${c.atMs}:${c.subject}:${c.what}:${c.use}`)}
              <tr>
                <td>{fmt.instant(c.atMs, 'date')}</td>
                <td>{c.subject}</td>
                <td>{c.what}, {c.use.toLowerCase()}</td>
                <td>{c.basisText}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="empty">No food or sale on file fell inside a hold this year.</p>
      {/if}
    </article>
  </div>

  {#if canExportLog}
    <div class="actions">
      <a
        class="btn"
        href="/api/animals/treatments.csv?{range}"
        download
        data-testid="treatment-log-csv">Treatment log CSV</a
      >
      <a
        class="btn"
        href="/api/animals/treatments.pdf?{range}"
        download
        data-testid="treatment-log-pdf">Treatment log PDF</a
      >
    </div>
  {/if}
</section>

<style>
  .animal-review {
    margin-top: 14px;
  }
  h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--color-forest-deep, #1f3a28);
  }
  .note {
    margin: 2px 0 8px;
    font-size: 12px;
    color: var(--color-ink-soft, #4a4f46);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
    gap: 10px;
  }
  .card {
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 8px);
    padding: 12px 14px;
    background: var(--color-paper);
    min-width: 0;
    overflow-x: auto;
  }
  .card.wide {
    grid-column: 1 / -1;
  }
  h4 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 700;
    color: var(--color-forest-deep, #1f3a28);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th {
    text-align: left;
    font-weight: 600;
    color: var(--color-ink-soft, #4a4f46);
    padding: 3px 6px;
    border-bottom: 1px solid var(--color-divider);
  }
  td {
    padding: 3px 6px;
    border-bottom: 1px solid var(--color-divider);
    overflow-wrap: anywhere;
  }
  .num {
    text-align: right;
    white-space: nowrap;
  }
  .empty {
    color: var(--color-ink-soft, #4a4f46);
    font-style: italic;
    font-size: 12px;
    margin: 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    padding: 0 16px;
    border-radius: var(--radius-input, 8px);
    border: 1px solid var(--color-forest, #2d5a3d);
    color: var(--color-forest-deep, #1f3a28);
    background: var(--color-paper, #fff);
    font-weight: 600;
    font-size: 14px;
    text-decoration: none;
  }
</style>
