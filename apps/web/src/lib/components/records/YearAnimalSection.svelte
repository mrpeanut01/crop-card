<script lang="ts">
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { fmt } from '$lib/prefsState.svelte';
  import { headCountText, type YearAnimalSection } from '$lib/records/yearSummaryAnimals';
  import type { MessageKey } from '$lib/i18n';

  const {
    section,
    year,
    canExportLog
  }: { section: YearAnimalSection; year: number; canExportLog: boolean } = $props();

  const tr = $derived(createT(page.data?.locale));
  const speciesName = (id: string) => section.speciesNames[id] ?? tr('recui.year.unknownSpecies');
  const MOVE_KEY: Record<string, MessageKey> = {
    arrived: 'recui.year.move.arrived',
    sold: 'recui.year.move.sold',
    'sold-for-meat': 'recui.year.move.soldForMeat',
    slaughtered: 'recui.year.move.slaughtered',
    died: 'recui.year.move.died',
    culled: 'recui.year.move.culled',
    rehomed: 'recui.year.move.rehomed'
  };
  const USE_KEY: Record<string, MessageKey> = {
    food: 'recui.year.use.food',
    sale: 'recui.year.use.sale',
    discard: 'recui.year.use.discard',
    'feed-to-animals': 'recui.year.use.feed',
    unknown: 'recui.year.use.unknown'
  };
  const moveLabel = (kind: string, label: string) => (MOVE_KEY[kind] ? tr(MOVE_KEY[kind]) : label);
  const useLabel = (use: string, label: string) => (USE_KEY[use] ? tr(USE_KEY[use]) : label);
  const countText = (n: number | null) =>
    n === null ? tr('recui.year.countUnknown') : headCountText(n);
  const range = $derived(`from=${year}-01-01&to=${year}-12-31`);
</script>

<section class="animal-review" aria-labelledby="animal-review-heading">
  <h3 id="animal-review-heading">{tr('recui.year.animals')}</h3>
  <p class="note">{tr('recui.year.fromRecords')}</p>

  <div class="grid">
    <article class="card">
      <h4>{tr('recui.year.headCount')}</h4>
      {#if section.headCounts.length}
        <table>
          <thead>
            <tr
              ><th>{tr('recui.year.species')}</th><th class="num"
                >{tr('recui.year.startOf', { year })}</th
              ><th class="num">{tr('recui.year.endOf', { year })}</th></tr
            >
          </thead>
          <tbody>
            {#each section.headCounts as h (h.speciesId)}
              <tr>
                <td>{speciesName(h.speciesId)}</td>
                <td class="num">{countText(h.atStart)}</td>
                <td class="num">{countText(h.atEnd)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="empty">{tr('recui.year.noAnimals')}</p>
      {/if}
    </article>

    <article class="card">
      <h4>{tr('recui.year.arrivals')}</h4>
      {#if section.movements.length}
        <table>
          <thead
            ><tr
              ><th>{tr('recui.year.species')}</th><th>{tr('recui.year.whatHappened')}</th><th
                class="num">{tr('recui.year.head')}</th
              ></tr
            ></thead
          >
          <tbody>
            {#each section.movements as m (`${m.speciesId}:${m.kind}`)}
              <tr>
                <td>{speciesName(m.speciesId)}</td>
                <td>{moveLabel(m.kind, m.label)}</td>
                <td class="num">{countText(m.head)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="empty">{tr('recui.year.noArrivals')}</p>
      {/if}
    </article>

    <article class="card">
      <h4>{tr('recui.year.treatments')}</h4>
      {#if section.treatments.length}
        <table>
          <thead
            ><tr
              ><th>{tr('recui.year.product')}</th><th class="num">{tr('recui.year.doses')}</th><th
                >{tr('recui.year.givenTo')}</th
              ></tr
            ></thead
          >
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
        <p class="empty">{tr('recui.year.noTreatments')}</p>
      {/if}
    </article>

    <article class="card">
      <h4>{tr('recui.year.eggsMilk')}</h4>
      {#if section.production.length}
        <table>
          <thead
            ><tr
              ><th>{tr('recui.year.food')}</th><th>{tr('recui.year.use')}</th><th class="num"
                >{tr('recui.year.total')}</th
              ><th class="num">{tr('recui.year.logs')}</th></tr
            ></thead
          >
          <tbody>
            {#each section.production as p (`${p.food}:${p.use}:${p.unit}`)}
              <tr>
                <td>{p.food === 'eggs' ? tr('recui.year.eggs') : tr('recui.year.milk')}</td>
                <td>{useLabel(p.use, p.useLabel)}</td>
                <td class="num">{p.quantity} {p.unit}</td>
                <td class="num">{p.logs}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="empty">{tr('recui.year.noEggsMilk')}</p>
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
        data-testid="treatment-log-csv">{tr('recui.year.logCsv')}</a
      >
      <a
        class="btn"
        href="/api/animals/treatments.pdf?{range}"
        download
        data-testid="treatment-log-pdf">{tr('recui.year.logPdf')}</a
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
