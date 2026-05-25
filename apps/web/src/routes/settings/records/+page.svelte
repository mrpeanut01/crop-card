<script lang="ts">
  import { Archive, FileDown, Calendar } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Records & retention · CropCard</title>
</svelte:head>

<a class="back-link" href="/settings">← All settings</a>
<header class="page-head">
  <Kicker>FR-07 · VDACS standard</Kicker>
  <h1>Records & retention</h1>
  <p class="lede">
    Spray records are immutable after the {data.retention.sprayYears}-year FR-09 window. CropCard
    enforces this server-side regardless of the UI. Export anytime for VDACS audits or your own
    records.
  </p>
</header>

<section class="card">
  <h2>Record counts</h2>
  <ul class="counts">
    <li>
      <span class="count-num">{data.counts.sprays}</span>
      <span class="count-label">Spray events (herbicide)</span>
    </li>
    <li>
      <span class="count-num">{data.counts.insecticides}</span>
      <span class="count-label">Insecticide events</span>
    </li>
    <li>
      <span class="count-num">{data.counts.fungicides}</span>
      <span class="count-label">Fungicide events</span>
    </li>
    <li>
      <span class="count-num">{data.counts.harvests}</span>
      <span class="count-label">Harvest events</span>
    </li>
  </ul>
</section>

<section class="card">
  <h2>Retention</h2>
  <p class="lede-sm">
    Default policy: <Pill tone="forest">{data.retention.sprayYears} years</Pill> per VDACS / FR-07.
    The first {data.retention.sprayInRetention} spray record{data.retention.sprayInRetention === 1
      ? ''
      : 's'} are still inside the window.
    {#if data.retention.sprayOlder > 0}
      {data.retention.sprayOlder} record{data.retention.sprayOlder === 1 ? '' : 's'} are older —
      retained but no longer legally required.
    {/if}
  </p>
  <p class="hint">
    <Calendar size={13} strokeWidth={1.75} />
    Auto-delete of older records lands when there's a real storage pressure. Default = keep
    everything.
  </p>
</section>

<section class="card">
  <h2>Bulk exports</h2>
  <ul class="export-list">
    <li>
      <a class="export-link" href="/api/spray/records/export.csv">
        <FileDown size={16} strokeWidth={1.75} />
        <div>
          <span class="el-title">Spray CSV</span>
          <span class="el-sub">Standard format — opens in Excel / Numbers</span>
        </div>
      </a>
    </li>
    <li>
      <a class="export-link" href="/api/spray/records/export.usda.csv">
        <FileDown size={16} strokeWidth={1.75} />
        <div>
          <span class="el-title">USDA / NRCS CSV</span>
          <span class="el-sub">EPA reg # + acres + rate per the NRCS cost-share schema</span>
        </div>
      </a>
    </li>
    <li>
      <a class="export-link" href="/api/spray/records/export.pdf">
        <FileDown size={16} strokeWidth={1.75} />
        <div>
          <span class="el-title">Spray PDF</span>
          <span class="el-sub">Printable; one event per page; signature block</span>
        </div>
      </a>
    </li>
    <li>
      <a class="export-link" href="/records">
        <Archive size={16} strokeWidth={1.75} />
        <div>
          <span class="el-title">Browse all records</span>
          <span class="el-sub">Searchable + filterable; export-per-page lives here</span>
        </div>
      </a>
    </li>
  </ul>
</section>

<style>
  .back-link {
    display: inline-block;
    margin-bottom: 12px;
    font-size: 13px;
    color: var(--color-forest-deep);
    text-decoration: none;
  }
  .back-link:hover {
    text-decoration: underline;
  }
  .page-head h1 {
    margin: 4px 0 8px;
    font-family: var(--font-serif, serif);
    font-size: 26px;
    color: var(--color-forest-deep);
  }
  .lede {
    margin: 0 0 18px;
    font-size: 13.5px;
    color: var(--color-ink-soft);
    line-height: 1.5;
    max-width: 60ch;
  }
  .lede-sm {
    margin: 0;
    font-size: 13px;
    color: var(--color-ink);
    line-height: 1.5;
  }
  .card {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    padding: 18px;
    margin-bottom: 16px;
  }
  .card h2 {
    margin: 0 0 12px;
    font-size: 16px;
    color: var(--color-ink);
  }
  .counts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
  }
  .counts li {
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft);
    border-radius: var(--radius-input, 6px);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .count-num {
    font-size: 22px;
    font-weight: 700;
    color: var(--color-forest-deep);
    font-family: var(--font-serif, serif);
  }
  .count-label {
    font-size: 11.5px;
    color: var(--color-ink-muted);
  }
  .hint {
    margin: 10px 0 0;
    font-size: 12.5px;
    color: var(--color-ink-muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .export-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .export-link {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 11px 14px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft);
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    color: var(--color-ink);
  }
  .export-link:hover {
    border-color: var(--color-forest-deep);
  }
  .el-title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--color-ink);
    display: block;
  }
  .el-sub {
    font-size: 12px;
    color: var(--color-ink-soft);
    display: block;
    margin-top: 2px;
  }
</style>
