<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { ChevronRight, FileText, Lock, Calendar, Plus, ArrowRight } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import LockPill from '$lib/components/ui/LockPill.svelte';
  import { KIND_LABEL, KIND_TONE, RECORD_KINDS, type RecordKind } from '$lib/db/recordKinds';

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
        // IndexedDB unavailable.
      }
    })();
    return () => {
      if (interval) clearInterval(interval);
    };
  });

  const isAllKinds = $derived(data.activeKinds.length === RECORD_KINDS.length);

  const exportQuery = $derived.by(() => {
    const params = new URLSearchParams();
    if (data.activeSprayerId) params.set('sprayerId', data.activeSprayerId);
    if (data.activeBlockId) params.set('blockId', data.activeBlockId);
    if (data.activeFromIso) params.set('from', data.activeFromIso);
    if (data.activeToIso) params.set('to', data.activeToIso);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  });

  function urlFor(
    next: Partial<{
      sprayerId: string | null;
      blockId: string | null;
      kinds: RecordKind[] | null;
      from: string | null;
      to: string | null;
    }>
  ): string {
    const params = new URLSearchParams();
    const sprayerId = next.sprayerId !== undefined ? next.sprayerId : data.activeSprayerId;
    const blockId = next.blockId !== undefined ? next.blockId : data.activeBlockId;
    const kinds = next.kinds !== undefined ? next.kinds : data.activeKinds;
    const from = next.from !== undefined ? next.from : data.activeFromIso;
    const to = next.to !== undefined ? next.to : data.activeToIso;
    if (sprayerId) params.set('sprayerId', sprayerId);
    if (blockId) params.set('blockId', blockId);
    if (kinds && kinds.length > 0 && kinds.length < RECORD_KINDS.length) {
      params.set('kinds', kinds.join(','));
    }
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return qs ? `/records?${qs}` : '/records';
  }

  function toggleKind(kind: RecordKind) {
    const set = new Set(isAllKinds ? [] : data.activeKinds);
    if (set.has(kind)) set.delete(kind);
    else set.add(kind);
    const next = set.size === 0 ? [...RECORD_KINDS] : (Array.from(set) as RecordKind[]);
    goto(urlFor({ kinds: next }), { invalidateAll: true, keepFocus: true });
  }

  function applyFilter(field: 'sprayerId' | 'blockId', value: string) {
    goto(urlFor({ [field]: value || null }), { invalidateAll: true });
  }

  function applyDateRange(field: 'from' | 'to', value: string) {
    goto(urlFor({ [field]: value || null }), { invalidateAll: true });
  }

  function clearDateRange() {
    goto(urlFor({ from: null, to: null }), { invalidateAll: true });
  }

  function fmtTimestamp(ms: number): string {
    const d = new Date(ms);
    return d.toLocaleString('sv-SE', { hour12: false }).slice(0, 16);
  }

  function fmtDate(ms: number | null): string {
    return ms
      ? new Date(ms).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        })
      : '—';
  }

  const summary = $derived(data.summary);

  // UC-46 — Year in review.
  const yearSummary = $derived(data.yearSummary);
  const PHILOSOPHY_LABELS: Record<string, string> = {
    conventional: 'Conventional',
    'non-gmo': 'Non-GMO',
    'organic-transitioning': 'Organic (transitioning)',
    'certified-organic': 'Certified organic'
  };

  function changeYear(value: string) {
    const params = new URLSearchParams(exportQuery.replace(/^\?/, ''));
    params.set('year', value);
    goto(`/records?${params.toString()}`, { invalidateAll: true, keepFocus: true });
  }

  function fmtCents(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }

  function fmtAcres(acres: number): string {
    return acres.toFixed(2);
  }

  function fmtMoisture(m: { min: number | null; mean: number | null; max: number | null }): string {
    return m.mean === null ? '—' : `${m.min}% / ${m.mean}% / ${m.max}%`;
  }
</script>

<svelte:head><title>Records · CropCard</title></svelte:head>

<header class="page-header">
  <Kicker>Records & audit trail</Kicker>
  <h1 class="serif">Records.</h1>
  <p class="lede">
    <strong>{summary.total} records</strong> · {summary.locked} locked · {summary.ytd} this year. Retained
    through <span class="mono">{fmtDate(summary.retentionUntilMs)}</span>.
  </p>
  <div class="actions">
    <a class="btn-ghost" href="/api/spray/records/export.csv{exportQuery}" download>
      <FileText size={13} /> CSV
    </a>
    <a class="btn-ghost" href="/api/spray/records/export.pdf{exportQuery}" download>
      <FileText size={13} /> PDF
    </a>
    <a
      class="btn-primary"
      href="/api/records/export.vdacs.pdf{exportQuery}"
      download
      title="VDACS-formatted audit pack: spray + insecticide + fungicide records, owner identity, integrity hash"
    >
      <Lock size={13} /> VDACS audit PDF
    </a>
    <a class="btn-ghost" href="/api/spray/records/export.usda.csv{exportQuery}" download>
      <FileText size={13} /> USDA / NRCS CSV
    </a>
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

<section class="year-review" aria-labelledby="year-review-heading">
  <div class="year-review-head">
    <div>
      <Kicker>Year in review</Kicker>
      <h2 id="year-review-heading" class="serif">{yearSummary.year} season summary.</h2>
      <p class="year-lede">
        Deterministic roll-up of every recorded application, harvest, and input for the season.
        Read-only.
      </p>
    </div>
    <div class="year-actions">
      <label class="year-select">
        <span class="visually-hidden">Season year</span>
        <Calendar size={13} />
        <select
          value={String(data.selectedYear)}
          onchange={(e) => changeYear((e.target as HTMLSelectElement).value)}
        >
          {#each data.availableYears as y (y)}
            <option value={String(y)}>{y}</option>
          {/each}
        </select>
      </label>
      <a class="btn-primary" href="/api/records/year-summary.pdf?year={yearSummary.year}" download>
        <FileText size={13} /> Year summary PDF
      </a>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi">
      <span class="kpi-num mono">{yearSummary.totals.totalApplications}</span>
      <span class="kpi-label">Applications</span>
    </div>
    <div class="kpi">
      <span class="kpi-num mono">{yearSummary.totals.harvestEvents}</span>
      <span class="kpi-label">Harvest events</span>
    </div>
    <div class="kpi">
      <span class="kpi-num mono">{yearSummary.totals.blocksTreated}</span>
      <span class="kpi-label">Blocks treated</span>
    </div>
    <div class="kpi">
      <span class="kpi-num mono">{fmtCents(yearSummary.inputCosts.totalCents)}</span>
      <span class="kpi-label">Input costs</span>
    </div>
    <div class="kpi">
      <span class="kpi-num mono">{yearSummary.scoutFunnel.spraysAvoided}</span>
      <span class="kpi-label">Sprays avoided</span>
    </div>
  </div>

  <div class="review-cards">
    <article class="review-card">
      <h3>Applications by product</h3>
      {#if yearSummary.productAcreage.length}
        <table class="mini-table">
          <thead>
            <tr
              ><th>Product</th><th>Class</th><th class="num">Apps</th><th class="num">Acres</th></tr
            >
          </thead>
          <tbody>
            {#each yearSummary.productAcreage.slice(0, 12) as p (p.productId)}
              <tr>
                <td>{p.displayName}</td>
                <td class="muted">{p.classes.join(', ') || '—'}</td>
                <td class="num mono">{p.applicationCount}</td>
                <td class="num mono">{fmtAcres(p.acresTreated)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="empty">No applications recorded this year.</p>
      {/if}
    </article>

    <article class="review-card">
      <h3>By chemistry class</h3>
      {#if yearSummary.chemistryClassAcreage.length}
        <table class="mini-table">
          <thead>
            <tr><th>Class</th><th class="num">Apps</th><th class="num">Acres</th></tr>
          </thead>
          <tbody>
            {#each yearSummary.chemistryClassAcreage as c (c.className)}
              <tr>
                <td>{c.className}</td>
                <td class="num mono">{c.applicationCount}</td>
                <td class="num mono">{fmtAcres(c.acresTreated)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="empty">No chemistry classes recorded.</p>
      {/if}
    </article>

    <article class="review-card">
      <h3>Philosophy compliance</h3>
      <p class="philosophy-line">
        Evaluated against <strong
          >{PHILOSOPHY_LABELS[yearSummary.philosophy.philosophy] ??
            yearSummary.philosophy.philosophy}</strong
        >.
      </p>
      <ul class="stat-list">
        <li>
          <Pill tone="forest">{yearSummary.philosophy.compliantApplications}</Pill> compliant
        </li>
        <li>
          <Pill tone="rust">{yearSummary.philosophy.nonCompliantApplications}</Pill> non-compliant
        </li>
        <li>
          <Pill tone="neutral">{yearSummary.philosophy.unknownApplications}</Pill> unclassified
        </li>
      </ul>
    </article>

    <article class="review-card">
      <h3>Harvest by archetype</h3>
      {#if yearSummary.harvestByArchetype.length}
        <table class="mini-table">
          <thead>
            <tr><th>Archetype</th><th class="num">Events</th><th>Moisture min/mean/max</th></tr>
          </thead>
          <tbody>
            {#each yearSummary.harvestByArchetype as h (h.archetype)}
              <tr>
                <td>{h.archetype}</td>
                <td class="num mono">{h.eventCount}</td>
                <td class="mono muted">{fmtMoisture(h.moisture)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="empty">No harvest events recorded this year.</p>
      {/if}
    </article>

    <article class="review-card">
      <h3>Scout → spray funnel</h3>
      <ul class="stat-list">
        <li>
          <strong class="mono">{yearSummary.scoutFunnel.scoutObservations}</strong> observations
        </li>
        <li>
          <strong class="mono">{yearSummary.scoutFunnel.thresholdTriggeredApplications}</strong>
          threshold-triggered
        </li>
        <li>
          <strong class="mono">{yearSummary.scoutFunnel.spraysAvoided}</strong> sprays avoided
        </li>
      </ul>
    </article>

    <article class="review-card">
      <h3>Decon + calibration</h3>
      <ul class="stat-list">
        <li>
          <strong class="mono"
            >{yearSummary.compliance.calibratedSprayerCount}/{yearSummary.compliance
              .sprayerCount}</strong
          > sprayers calibrated
        </li>
        <li>
          <strong class="mono">{yearSummary.compliance.calibratedThisYear}</strong> calibrated this year
        </li>
        <li>
          <strong class="mono">{yearSummary.compliance.deconEventsThisYear}</strong> decon events
        </li>
      </ul>
    </article>
  </div>
</section>

<section class="filter-card">
  <div class="filter-row chip-row" role="group" aria-label="Record kind filters">
    <span class="filter-label">Filter</span>
    {#each RECORD_KINDS as kind (kind)}
      {@const active = data.activeKinds.includes(kind)}
      {@const count = summary.countsByKind[kind] ?? 0}
      <button
        type="button"
        class="kind-chip"
        class:active
        onclick={() => toggleKind(kind)}
        aria-pressed={active}
      >
        <Pill tone={KIND_TONE[kind]}>{KIND_LABEL[kind]}</Pill>
        <span class="kind-count mono">{count}</span>
      </button>
    {/each}
    <span class="sep" aria-hidden="true"></span>
    <label class="inline-input">
      <Calendar size={12} />
      <span class="visually-hidden">From date</span>
      <input
        type="date"
        value={data.activeFromIso ?? ''}
        onchange={(e) => applyDateRange('from', (e.target as HTMLInputElement).value)}
        aria-label="From date"
      />
    </label>
    <span class="arrow" aria-hidden="true">→</span>
    <label class="inline-input">
      <span class="visually-hidden">To date</span>
      <input
        type="date"
        value={data.activeToIso ?? ''}
        onchange={(e) => applyDateRange('to', (e.target as HTMLInputElement).value)}
        aria-label="To date"
      />
    </label>
    {#if data.activeFromIso || data.activeToIso}
      <button type="button" class="clear-range" onclick={clearDateRange}>clear dates</button>
    {/if}
    <span class="filter-spacer"></span>
    <span class="count-mono mono">{data.records.length} of {summary.total}</span>
  </div>

  <div class="filter-row select-row">
    <label class="inline-select">
      Block
      <select
        value={data.activeBlockId ?? ''}
        onchange={(e) => applyFilter('blockId', (e.target as HTMLSelectElement).value)}
      >
        <option value="">All blocks</option>
        {#each data.blocks as b (b.id)}
          <option value={b.id}>{b.blockLabel ?? b.name}</option>
        {/each}
      </select>
    </label>
    <label class="inline-select">
      Sprayer
      <select
        value={data.activeSprayerId ?? ''}
        onchange={(e) => applyFilter('sprayerId', (e.target as HTMLSelectElement).value)}
      >
        <option value="">All sprayers</option>
        {#each data.sprayers as s (s.id)}
          <option value={s.id}>{s.label}</option>
        {/each}
      </select>
    </label>
  </div>

  <div class="retention-strip">
    <Lock size={13} />
    <span>
      <strong>{summary.locked}/{summary.total}</strong> records locked under the 48-hour FR-09 rule.
      Oldest record: <span class="mono">{fmtDate(summary.oldestMs)}</span>.
    </span>
  </div>

  {#if data.records.length === 0}
    <div class="empty">
      <h2>No records match these filters</h2>
      <p>
        Toggle a kind chip above to widen the view, or
        <a href="/spray">plan a spray</a>,
        <a href="/scout">log a scout observation</a>, or
        <a href="/harvest">record a harvest</a>.
      </p>
    </div>
  {:else}
    <div class="ledger-scroll">
      <table class="ledger" aria-label="Records ledger">
        <thead>
          <tr>
            <th scope="col">Timestamp</th>
            <th scope="col">Kind</th>
            <th scope="col">Block · planting</th>
            <th scope="col">Detail</th>
            <th scope="col">By</th>
            <th scope="col">Hash</th>
            <th scope="col" aria-label="Open"></th>
          </tr>
        </thead>
        <tbody>
          {#each data.records as r (r.id)}
            <tr>
              <td class="mono ts">{fmtTimestamp(r.occurredAt)}</td>
              <td>
                <Pill tone={KIND_TONE[r.kind]}>{KIND_LABEL[r.kind]}</Pill>
              </td>
              <td>
                <div class="block-name">{r.blockLabel ?? '—'}</div>
                {#if r.cropPluginId}
                  <div class="block-sub">{r.cropPluginId}</div>
                {/if}
              </td>
              <td class="detail-cell">
                {r.detail}
                {#if r.customRateOverride}
                  <span class="override-pill">custom rate</span>
                {/if}
              </td>
              <td class="performer">{r.performerLabel ?? '—'}</td>
              <td>
                <LockPill locked={r.locked} hash={r.hash} />
              </td>
              <td class="open-cell">
                <a
                  class="drill"
                  href={`/records/${r.kind}/${r.rowId}`}
                  aria-label={`Open ${KIND_LABEL[r.kind]} record from ${fmtTimestamp(r.occurredAt)}`}
                >
                  <ChevronRight size={14} />
                </a>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

{#if data.approachingRetention.length > 0}
  <section class="alert" role="status">
    ⚠ {data.approachingRetention.length} record(s) approaching the 2-year retention horizon. Confirm with
    owner before any deletion.
  </section>
{/if}

<section class="footer-cards">
  <article class="reassurance">
    <div class="reassurance-kicker">Integrity hash</div>
    <p>
      Each record carries per-plugin content hashes, and every export prints a SHA-256 of its
      canonical row set. Re-exporting the same records reproduces the same hash; a change after the
      FR-09 lock alters it.
    </p>
    <a class="reassurance-link" href="/api/records/export.vdacs.pdf{exportQuery}" download>
      Download VDACS audit pack <ArrowRight size={12} />
    </a>
  </article>
  <article class="reassurance">
    <div class="reassurance-kicker">Inspector access</div>
    <p>
      Invite a VDACS inspector or CSA member as a read-only inspector. They sign in with their own
      account and see this view without edit access.
    </p>
    <a class="reassurance-link ghost" href="/settings/helpers">
      <Plus size={12} /> Invite an inspector
    </a>
  </article>
</section>

<style>
  .page-header {
    margin-bottom: 14px;
  }

  /* ── UC-46 Year in review ─────────────────────────────────────────── */
  .year-review {
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 12px);
    background: var(--color-paper);
    padding: 18px 18px 20px;
    margin-bottom: 18px;
  }
  .year-review-head {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: space-between;
    align-items: flex-start;
  }
  .year-review-head h2 {
    margin: 4px 0 0;
    font-size: 22px;
  }
  .year-lede {
    color: var(--color-ink-soft, #4a4f46);
    margin: 4px 0 0;
    font-size: 13px;
    max-width: 46ch;
  }
  .year-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .year-select {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    min-height: 36px;
  }
  .year-select select {
    border: none;
    background: transparent;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-ink);
  }
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px;
    margin: 16px 0;
  }
  .kpi {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 8px);
    background: var(--color-cream, #f6efdf);
  }
  .kpi-num {
    font-size: 22px;
    font-weight: 700;
    color: var(--color-forest-deep, #1f3a28);
  }
  .kpi-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-ink-soft, #4a4f46);
  }
  .review-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 12px;
  }
  .review-card {
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 8px);
    padding: 12px 14px;
    background: var(--color-paper);
  }
  .review-card h3 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 700;
    color: var(--color-forest-deep, #1f3a28);
  }
  .mini-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .mini-table th {
    text-align: left;
    font-weight: 600;
    color: var(--color-ink-soft, #4a4f46);
    padding: 3px 6px;
    border-bottom: 1px solid var(--color-divider);
  }
  .mini-table td {
    padding: 3px 6px;
    border-bottom: 1px solid var(--color-divider);
  }
  .mini-table .num {
    text-align: right;
  }
  .mini-table .muted,
  .philosophy-line {
    color: var(--color-ink-soft, #4a4f46);
  }
  .philosophy-line {
    font-size: 13px;
    margin: 0 0 8px;
  }
  .stat-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
  }
  .review-card .empty {
    color: var(--color-ink-soft, #4a4f46);
    font-style: italic;
    font-size: 12px;
    margin: 0;
  }
  .lede {
    color: var(--color-ink-soft, #4a4f46);
    margin: 6px 0 14px;
    font-size: 14px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .btn-ghost,
  .btn-primary,
  .btn-secondary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 13px;
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    min-height: 36px;
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
  }
  .btn-primary {
    background: var(--color-forest-deep, #1f3a28);
    color: var(--color-paper, #fdfaf2);
    border-color: var(--color-forest-deep, #1f3a28);
  }
  .btn-primary:hover,
  .btn-ghost:hover,
  .btn-secondary:hover {
    filter: brightness(1.05);
    border-color: var(--color-forest-deep, #1f3a28);
  }
  .btn-secondary.has-pending {
    background: var(--pill-wheat-bg);
    border-color: #8a6722;
    color: #8a6722;
  }
  .pending-badge {
    background: var(--color-rust, #a64a2a);
    color: white;
    border-radius: 999px;
    padding: 0 7px;
    font-size: 11px;
    min-width: 1.6rem;
    text-align: center;
    margin-left: 4px;
  }

  .filter-card {
    background: var(--color-paper, #fdfaf2);
    border: 1px solid var(--color-divider, #d9cfb7);
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 16px;
  }
  .filter-row {
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-divider-soft, #e9dfcc);
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .filter-label {
    font-size: 11px;
    color: var(--color-ink-muted, #7a7f75);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .kind-chip {
    background: transparent;
    border: 0;
    padding: 0;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border-radius: 99px;
    transition: opacity 120ms ease;
    opacity: 0.55;
  }
  .kind-chip.active {
    opacity: 1;
  }
  .kind-chip:hover {
    opacity: 1;
  }
  .kind-chip:focus-visible {
    outline: 2px solid var(--color-forest-deep, #1f3a28);
    outline-offset: 2px;
  }
  .kind-count {
    font-size: 10.5px;
    color: var(--color-ink-muted, #7a7f75);
  }
  .sep {
    width: 1px;
    height: 22px;
    background: var(--color-divider, #d9cfb7);
  }
  .inline-input {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    border: 1px solid var(--color-divider, #d9cfb7);
    border-radius: var(--radius-input, 6px);
    background: var(--color-cream, #f8f3e8);
    font-size: 12px;
    color: var(--color-ink-soft, #4a4f46);
  }
  .inline-input input {
    border: 0;
    background: transparent;
    font-family: inherit;
    font-size: 12px;
    color: inherit;
  }
  .inline-input input:focus {
    outline: 0;
  }
  .clear-range {
    background: transparent;
    border: 0;
    color: var(--color-rust, #a64a2a);
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
  }
  .arrow {
    color: var(--color-ink-muted, #7a7f75);
  }
  .filter-spacer {
    flex: 1;
  }
  .count-mono {
    font-size: 12px;
    color: var(--color-ink-muted, #7a7f75);
  }
  .select-row {
    background: var(--color-cream, #f8f3e8);
  }
  .inline-select {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--color-ink-muted, #7a7f75);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
  }
  .inline-select select {
    padding: 5px 8px;
    border: 1px solid var(--color-divider, #d9cfb7);
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 13px;
    background: var(--color-paper);
    color: var(--color-ink);
    text-transform: none;
    letter-spacing: 0;
  }

  .retention-strip {
    padding: 8px 16px;
    background: #eff6e9;
    border-bottom: 1px solid var(--color-divider-soft, #e9dfcc);
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12.5px;
    color: var(--color-forest-deep, #1f3a28);
  }

  /* Wrap the table so narrow viewports get horizontal scroll instead
     of a clipped 7-column layout. `.filter-card` has `overflow: hidden`
     for rounded corners, so the scroll lives one level in. */
  .ledger-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .ledger {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  .ledger thead tr {
    background: var(--color-cream, #f8f3e8);
    color: var(--color-ink-muted, #7a7f75);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
  }
  .ledger th,
  .ledger td {
    text-align: left;
    padding: 9px 14px;
    border-top: 1px solid var(--color-divider-soft, #e9dfcc);
    vertical-align: top;
  }
  .ledger thead th {
    border-top: 0;
  }
  .ledger tbody tr:hover {
    background: var(--color-cream, #f8f3e8);
  }
  .ts {
    color: var(--color-ink-soft, #4a4f46);
    font-size: 11.5px;
    white-space: nowrap;
  }
  .block-name {
    font-size: 12px;
    color: var(--color-ink, #1a1f1a);
    font-weight: 500;
  }
  .block-sub {
    font-size: 11px;
    color: var(--color-ink-muted, #7a7f75);
    margin-top: 2px;
  }
  .detail-cell {
    font-size: 12px;
    color: var(--color-ink-soft, #4a4f46);
    max-width: 360px;
  }
  .performer {
    color: var(--color-ink-muted, #7a7f75);
    font-size: 11.5px;
  }
  .override-pill {
    background: var(--pill-wheat-bg);
    color: var(--pill-wheat-fg);
    padding: 1px 6px;
    border-radius: 99px;
    font-size: 10px;
    text-transform: uppercase;
    margin-left: 6px;
    font-weight: 600;
  }
  .open-cell {
    text-align: right;
  }
  .drill {
    color: var(--color-ink-muted, #7a7f75);
    display: inline-flex;
    align-items: center;
    padding: 4px;
    border-radius: 4px;
  }
  .drill:hover,
  .drill:focus-visible {
    color: var(--color-forest-deep, #1f3a28);
    background: var(--color-cream, #f8f3e8);
  }

  .empty {
    padding: 32px;
    text-align: center;
    color: var(--color-ink-soft, #4a4f46);
    background: var(--color-cream, #f8f3e8);
  }
  .empty h2 {
    margin: 0 0 8px;
    font-size: 16px;
    color: var(--color-forest-deep, #1f3a28);
  }

  .alert {
    background: var(--pill-wheat-bg);
    color: var(--pill-wheat-fg, #8a6722);
    padding: 9px 14px;
    border-radius: 4px;
    margin: 0 0 16px;
    border-left: 4px solid #b8893c;
    font-size: 13px;
  }

  .footer-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-top: 8px;
  }
  .reassurance {
    background: var(--color-paper, #fdfaf2);
    border: 1px solid var(--color-divider, #d9cfb7);
    border-radius: 8px;
    padding: 16px 18px;
  }
  .reassurance-kicker {
    font-size: 11px;
    color: var(--color-ink-muted, #7a7f75);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .reassurance p {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--color-ink-soft, #4a4f46);
    line-height: 1.55;
  }
  .reassurance-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: 10px;
    font-size: 12.5px;
    color: var(--color-forest-deep, #1f3a28);
    font-weight: 600;
    text-decoration: none;
  }
  .reassurance-link:hover {
    text-decoration: underline;
  }

  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }

  @media (max-width: 760px) {
    .footer-cards {
      grid-template-columns: 1fr;
    }
    .filter-row {
      gap: 6px;
    }
    .ledger {
      font-size: 11.5px;
    }
    .detail-cell {
      max-width: 220px;
    }
  }
</style>
