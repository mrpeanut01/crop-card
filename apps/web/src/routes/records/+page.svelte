<script lang="ts">
  import { createT } from '$lib/i18n';
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, tick } from 'svelte';
  import CardPrintSheet from '$lib/components/cards/CardPrintSheet.svelte';
  import RecordCardPanel from '$lib/components/records/RecordCardPanel.svelte';
  import YearAnimalSection from '$lib/components/records/YearAnimalSection.svelte';
  import SoilTestNudge from '$lib/components/setup/SoilTestNudge.svelte';
  import type { CardModel, CardPrintLayout } from '$lib/cards/model';
  import { ChevronRight, FileText, Lock, Calendar, Plus, ArrowRight } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import LockPill from '$lib/components/ui/LockPill.svelte';
  import { lateLabel } from '$lib/records/lateLabel';
  import { KIND_TONE, RECORD_KINDS, type RecordKind } from '$lib/db/recordKinds';
  import { kindLabel } from '$lib/components/records/kindLabel';
  import { archetypeLabel } from '$lib/plugins/familyLabel';
  import { currentPrefs, fmt } from '$lib/prefsState.svelte';
  import { localStamp } from '$lib/exports/localTime';

  let { data } = $props();
  const tr = $derived(createT(data.locale));
  const archetypeShown = (a: string) =>
    data.locale && data.locale !== 'en' ? archetypeLabel(a, data.locale) : a;

  let pendingCount = $state<number | null>(null);
  let openCards = $state<string[]>([]);
  let voidedNote = $state<string | null>(null);
  let printJob = $state<{
    cards: CardModel[];
    layout: CardPrintLayout;
    origin: string | null;
  } | null>(null);

  function toggleCard(id: string) {
    openCards = openCards.includes(id) ? openCards.filter((x) => x !== id) : [...openCards, id];
  }

  async function printCards(job: NonNullable<typeof printJob>) {
    printJob = job;
    await tick();
    const previous = document.title;
    document.title = tr('recui.printTitle');
    try {
      window.print();
    } finally {
      document.title = previous;
    }
  }

  onMount(() => {
    const clear = () => (printJob = null);
    window.addEventListener('afterprint', clear);
    return () => window.removeEventListener('afterprint', clear);
  });

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

  const wateringHref = $derived.by(() => {
    const params = new URLSearchParams(page.url.searchParams);
    if (data.watering.active) params.delete('watering');
    else params.set('watering', '1');
    const qs = params.toString();
    return qs ? `/records?${qs}` : '/records';
  });

  function wateringAmount(w: {
    inches: number | null;
    gallons: number | null;
    durationMin: number | null;
  }): string {
    if (w.inches !== null) return `${w.inches} in`;
    if (w.gallons !== null) return `${w.gallons} gal`;
    if (w.durationMin !== null) return tr('records.watering.minNoAmount', { n: w.durationMin });
    return tr('records.watering.noAmount');
  }

  const loadMoreHref = $derived.by(() => {
    if (data.nextShow === null) return null;
    const params = new URLSearchParams(page.url.searchParams);
    params.set('show', String(data.nextShow));
    return `/records?${params.toString()}`;
  });
  const hiddenCount = $derived(data.filteredTotal - data.records.length);
  const loadMoreCount = $derived(
    data.nextShow === null ? 0 : Math.min(hiddenCount, data.nextShow - data.records.length)
  );

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
    return localStamp(ms, currentPrefs());
  }

  function fmtRowTime(r: { kind: RecordKind; occurredAt: number }): string {
    return r.kind === 'planting'
      ? new Date(r.occurredAt).toISOString().slice(0, 10)
      : fmtTimestamp(r.occurredAt);
  }

  function fmtDate(ms: number | null): string {
    return ms ? fmt.instant(ms, 'date') : '—';
  }

  const summary = $derived(data.summary);

  // UC-46 — Year in review.
  const yearSummary = $derived(data.yearSummary);
  const PHILOSOPHY_LABELS = $derived<Record<string, string>>({
    conventional: tr('records.philosophy.conventional'),
    'no-till': tr('records.philosophy.noTill'),
    'non-gmo': tr('records.philosophy.nonGmo'),
    'organic-transitioning': tr('records.philosophy.organicTransitioning'),
    'certified-organic': tr('records.philosophy.certifiedOrganic')
  });

  function changeYear(value: string) {
    const params = new URLSearchParams(exportQuery.replace(/^\?/, ''));
    params.set('year', value);
    goto(`/records?${params.toString()}`, { invalidateAll: true, keepFocus: true });
  }

  function fmtCents(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }

  function fmtAcres(acres: number): string {
    return fmt.qty(acres, 'area', { digits: 2, bare: true });
  }

  function fmtMoisture(m: { min: number | null; mean: number | null; max: number | null }): string {
    return m.mean === null ? '—' : `${m.min}% / ${m.mean}% / ${m.max}%`;
  }
</script>

<svelte:head><title>{tr('records.pageTitle')}</title></svelte:head>

<div class="records-page" class:no-print={printJob !== null}>
  <header class="page-header">
    <Kicker>{tr('records.kicker')}</Kicker>
    <h1 class="serif">{tr('records.h1')}</h1>
    <p class="lede">
      <strong>{tr('recui.lede.records', { count: summary.total })}</strong> · {tr(
        'recui.lede.locked',
        { n: summary.locked }
      )} · {tr('recui.lede.ytd', { n: summary.ytd })}. {tr('recui.lede.retained')}
      <span class="mono">{fmtDate(summary.retentionUntilMs)}</span>.
    </p>
    <div class="actions">
      <a class="btn-ghost" href="/api/spray/records/export.csv{exportQuery}" download>
        <FileText size={13} /> CSV
      </a>
      <a class="btn-ghost" href="/api/spray/records/export.pdf{exportQuery}" data-sveltekit-reload>
        <FileText size={13} /> PDF
      </a>
      {#if data.chrome === 'full'}
        <a
          class="btn-primary"
          href="/api/records/export.vdacs.pdf{exportQuery}"
          data-sveltekit-reload
          title={tr('records.export.vdacsTitle')}
        >
          <Lock size={13} />
          {tr('records.export.vdacsPdf')}
        </a>
        <a class="btn-ghost" href="/api/spray/records/export.usda.csv{exportQuery}" download>
          <FileText size={13} />
          {tr('records.export.usdaCsv')}
        </a>
      {/if}
      <a
        class="btn-secondary"
        class:has-pending={pendingCount && pendingCount > 0}
        href="/records/pending"
      >
        {tr('records.pendingQueue')}
        {#if pendingCount && pendingCount > 0}
          <span class="pending-badge">{pendingCount}</span>
        {/if}
      </a>
      {#if data.organicLink}
        <a
          class="btn-secondary organic-link"
          href="/records/organic"
          data-testid="organic-records-link"
        >
          {tr('recui.organicLink')}
        </a>
      {/if}
    </div>
  </header>

  {#if data.soilNudgePlaces}
    <SoilTestNudge places={data.soilNudgePlaces} />
  {/if}

  <section class="year-review" aria-labelledby="year-review-heading">
    <div class="year-review-head">
      <div>
        <Kicker>{tr('records.year.kicker')}</Kicker>
        <h2 id="year-review-heading" class="serif">
          {tr('records.year.heading', { year: yearSummary.year })}
        </h2>
        <p class="year-lede">
          {tr('records.year.lede')}
        </p>
      </div>
      <div class="year-actions">
        <label class="year-select">
          <span class="visually-hidden">{tr('records.year.select')}</span>
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
        <a
          class="btn-primary"
          href="/api/records/year-summary.pdf?year={yearSummary.year}"
          data-sveltekit-reload
        >
          <FileText size={13} />
          {tr('records.year.pdf')}
        </a>
        {#if data.showMoneyLink}
          <a class="btn-ghost money-link" href="/finance?year={yearSummary.year}"
            >{tr('records.year.money', { year: yearSummary.year })}</a
          >
        {/if}
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi">
        <span class="kpi-num mono">{yearSummary.totals.totalApplications}</span>
        <span class="kpi-label">{tr('records.kpi.applications')}</span>
      </div>
      <div class="kpi">
        <span class="kpi-num mono">{yearSummary.totals.harvestEvents}</span>
        <span class="kpi-label">{tr('records.kpi.harvestEvents')}</span>
      </div>
      <div class="kpi">
        <span class="kpi-num mono">{yearSummary.totals.blocksTreated}</span>
        <span class="kpi-label">{tr('records.kpi.blocksTreated')}</span>
      </div>
      {#if yearSummary.inputCosts}
        <div class="kpi">
          <span class="kpi-num mono">{fmtCents(yearSummary.inputCosts.totalCents)}</span>
          <span class="kpi-label">{tr('records.kpi.inputCosts')}</span>
        </div>
      {/if}
      <div class="kpi">
        <span class="kpi-num mono">{yearSummary.scoutFunnel.spraysAvoided}</span>
        <span class="kpi-label">{tr('records.kpi.spraysAvoided')}</span>
      </div>
    </div>

    <div class="review-cards">
      <article class="review-card">
        <h3>{tr('records.card.byProduct')}</h3>
        {#if yearSummary.productAcreage.length}
          <table class="mini-table">
            <thead>
              <tr
                ><th>{tr('records.th.product')}</th><th>{tr('records.th.class')}</th><th class="num"
                  >{tr('records.th.apps')}</th
                ><th class="num">{tr('records.th.area', { unit: fmt.unit('area') })}</th></tr
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
          <p class="empty">{tr('records.card.noApps')}</p>
        {/if}
      </article>

      <article class="review-card">
        <h3>{tr('records.card.byChem')}</h3>
        {#if yearSummary.chemistryClassAcreage.length}
          <table class="mini-table">
            <thead>
              <tr
                ><th>{tr('records.th.class')}</th><th class="num">{tr('records.th.apps')}</th><th
                  class="num">{tr('records.th.area', { unit: fmt.unit('area') })}</th
                ></tr
              >
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
          <p class="empty">{tr('records.card.noChem')}</p>
        {/if}
      </article>

      {#if data.chrome === 'full'}
        <article class="review-card">
          <h3>{tr('records.card.philosophy')}</h3>
          <p class="philosophy-line">
            {tr('records.philosophy.evaluated')}
            <strong
              >{PHILOSOPHY_LABELS[yearSummary.philosophy.philosophy] ??
                yearSummary.philosophy.philosophy}</strong
            >.
          </p>
          <ul class="stat-list">
            <li>
              <Pill tone="forest">{yearSummary.philosophy.compliantApplications}</Pill>
              {tr('records.philosophy.compliant')}
            </li>
            <li>
              <Pill tone="rust">{yearSummary.philosophy.nonCompliantApplications}</Pill>
              {tr('records.philosophy.nonCompliant')}
            </li>
            <li>
              <Pill tone="neutral">{yearSummary.philosophy.unknownApplications}</Pill>
              {tr('records.philosophy.unclassified')}
            </li>
          </ul>
        </article>
      {/if}

      <article class="review-card">
        <h3>{tr('records.card.harvestByArchetype')}</h3>
        {#if yearSummary.harvestByArchetype.length}
          <table class="mini-table">
            <thead>
              <tr
                ><th>{tr('records.th.archetype')}</th><th class="num">{tr('records.th.events')}</th
                ><th>{tr('records.th.moisture')}</th></tr
              >
            </thead>
            <tbody>
              {#each yearSummary.harvestByArchetype as h (h.archetype)}
                <tr>
                  <td>{archetypeShown(h.archetype)}</td>
                  <td class="num mono">{h.eventCount}</td>
                  <td class="mono muted">{fmtMoisture(h.moisture)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <p class="empty">{tr('records.card.noHarvest')}</p>
        {/if}
      </article>

      <article class="review-card">
        <h3>{tr('records.card.funnel')}</h3>
        <ul class="stat-list">
          <li>
            <strong class="mono">{yearSummary.scoutFunnel.scoutObservations}</strong>
            {tr('records.funnel.observations')}
          </li>
          <li>
            <strong class="mono">{yearSummary.scoutFunnel.thresholdTriggeredApplications}</strong>
            {tr('records.funnel.threshold')}
          </li>
          <li>
            <strong class="mono">{yearSummary.scoutFunnel.spraysAvoided}</strong>
            {tr('records.funnel.avoided')}
          </li>
        </ul>
      </article>

      {#if data.chrome === 'full'}
        <article class="review-card">
          <h3>{tr('records.review.deconCalib')}</h3>
          <ul class="stat-list">
            <li>
              <strong class="mono"
                >{yearSummary.compliance.calibratedSprayerCount}/{yearSummary.compliance
                  .sprayerCount}</strong
              >
              {tr('recui.calib.sprayers')}
            </li>
            <li>
              <strong class="mono">{yearSummary.compliance.calibratedThisYear}</strong>
              {tr('recui.calib.thisYear')}
            </li>
            <li>
              <strong class="mono">{yearSummary.compliance.deconEventsThisYear}</strong>
              {tr('records.review.deconEvents')}
            </li>
          </ul>
        </article>
      {/if}
    </div>
    {#if yearSummary.animals}
      <YearAnimalSection
        section={yearSummary.animals}
        year={yearSummary.year}
        canExportLog={data.canExportAnimalLog}
      />
    {/if}
  </section>

  <section class="filter-card">
    <div class="filter-row chip-row" role="group" aria-label={tr('records.filter.group')}>
      <span class="filter-label">{tr('records.filter.label')}</span>
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
          <Pill tone={KIND_TONE[kind]}>{kindLabel(tr, kind)}</Pill>
          <span class="kind-count mono">{count}</span>
        </button>
      {/each}
      <button
        type="button"
        class="kind-chip watering-chip"
        class:active={data.watering.active}
        aria-pressed={data.watering.active}
        onclick={() => goto(wateringHref, { noScroll: true, keepFocus: true })}
        data-testid="watering-chip"
      >
        <Pill tone="sky">{tr('records.filter.watering')}</Pill>
        <span class="kind-count mono">{data.watering.count}</span>
      </button>
      <span class="sep" aria-hidden="true"></span>
      <label class="inline-input">
        <Calendar size={12} />
        <span class="visually-hidden">{tr('records.filter.from')}</span>
        <input
          type="date"
          value={data.activeFromIso ?? ''}
          onchange={(e) => applyDateRange('from', (e.target as HTMLInputElement).value)}
          aria-label={tr('records.filter.from')}
        />
      </label>
      <span class="arrow" aria-hidden="true">→</span>
      <label class="inline-input">
        <span class="visually-hidden">{tr('records.filter.to')}</span>
        <input
          type="date"
          value={data.activeToIso ?? ''}
          onchange={(e) => applyDateRange('to', (e.target as HTMLInputElement).value)}
          aria-label={tr('records.filter.to')}
        />
      </label>
      {#if data.activeFromIso || data.activeToIso}
        <button type="button" class="clear-range" onclick={clearDateRange}
          >{tr('records.filter.clearDates')}</button
        >
      {/if}
      <span class="filter-spacer"></span>
      <span class="count-mono mono"
        >{tr('records.filter.countOf', { n: data.filteredTotal, total: summary.total })}</span
      >
    </div>

    <div class="filter-row select-row">
      <label class="inline-select">
        {tr('records.filter.block')}
        <select
          value={data.activeBlockId ?? ''}
          onchange={(e) => applyFilter('blockId', (e.target as HTMLSelectElement).value)}
        >
          <option value="">{tr('records.filter.allBlocks')}</option>
          {#each data.blocks as b (b.id)}
            <option value={b.id}>{b.blockLabel ?? b.name}</option>
          {/each}
        </select>
      </label>
      <label class="inline-select">
        {tr('records.filter.sprayer')}
        <select
          value={data.activeSprayerId ?? ''}
          onchange={(e) => applyFilter('sprayerId', (e.target as HTMLSelectElement).value)}
        >
          <option value="">{tr('records.filter.allSprayers')}</option>
          {#each data.sprayers as s (s.id)}
            <option value={s.id}>{s.label}</option>
          {/each}
        </select>
      </label>
    </div>

    {#if data.watering.active}
      <section
        class="watering-log"
        aria-labelledby="watering-log-heading"
        data-testid="watering-log"
      >
        <h2 id="watering-log-heading">{tr('records.watering.title')}</h2>
        <p class="watering-note">
          {tr('records.watering.note')}
        </p>
        {#if data.watering.rows.length === 0}
          <p class="watering-note">{tr('records.watering.empty')}</p>
        {:else}
          <ul class="watering-rows">
            {#each data.watering.rows as w (w.id)}
              {@const key = `irrigation:${w.id}`}
              {@const open = openCards.includes(key)}
              <li>
                <div class="watering-row">
                  <span class="mono">{fmtDate(w.occurredAt)}</span>
                  <span>{w.areaName}{w.bedName ? ` · ${w.bedName}` : ''}</span>
                  <span>{wateringAmount(w)}</span>
                  <button
                    type="button"
                    class="card-toggle"
                    aria-expanded={open}
                    onclick={() => toggleCard(key)}
                  >
                    {tr('records.cardBtn')}
                  </button>
                  <a
                    class="drill"
                    href={`/records/irrigation/${w.id}`}
                    aria-label={tr('records.watering.openLog')}
                  >
                    <ChevronRight size={14} />
                  </a>
                </div>
                {#if open}
                  <RecordCardPanel
                    recordKind="irrigation"
                    rowId={w.id}
                    prefs={currentPrefs()}
                    onPrint={printCards}
                  />
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    <div class="retention-strip">
      <Lock size={13} />
      <span>
        {tr('records.retention.locked', {
          locked: summary.locked,
          total: summary.total,
          oldest: fmtDate(summary.oldestMs)
        })}
      </span>
    </div>

    <p class="void-status" role="status" aria-live="polite">{voidedNote ?? ''}</p>

    {#if data.records.length === 0}
      <div class="empty">
        <h2>{tr('records.empty.title')}</h2>
        <p>
          {tr('records.empty.p1')}
          <a href="/spray">{tr('records.empty.planSpray')}</a>,
          <a href="/scout">{tr('records.empty.logScout')}</a>, {tr('records.empty.or')}
          <a href="/harvest">{tr('records.empty.recordHarvest')}</a>.
        </p>
      </div>
    {:else}
      <div class="ledger-scroll">
        <table class="ledger" aria-label={tr('records.ledger.aria')}>
          <thead>
            <tr>
              <th scope="col">{tr('records.ledger.timestamp', { zone: fmt.zone() })}</th>
              <th scope="col">{tr('records.ledger.kind')}</th>
              <th scope="col">{tr('records.ledger.blockPlanting')}</th>
              <th scope="col">{tr('records.ledger.detail')}</th>
              <th scope="col">{tr('records.ledger.by')}</th>
              <th scope="col">{tr('records.ledger.hash')}</th>
              <th scope="col" aria-label={tr('records.ledger.open')}></th>
            </tr>
          </thead>
          <tbody>
            {#each data.records as r (r.id)}
              {@const cardOpen = openCards.includes(r.id)}
              {@const late = lateLabel(r.recordedLate === true, r.daysLate ?? null, data.locale)}
              <tr>
                <td class="mono ts">{fmtRowTime(r)}</td>
                <td>
                  <Pill tone={KIND_TONE[r.kind]}>{kindLabel(tr, r.kind)}</Pill>
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
                    <span class="override-pill">{tr('records.ledger.customRate')}</span>
                  {/if}
                  {#if late}
                    <span class="late-pill"><Pill tone="wheat">{late}</Pill></span>
                  {/if}
                </td>
                <td class="performer">{r.performerLabel ?? '—'}</td>
                <td>
                  <LockPill locked={r.locked} hash={r.hash} />
                </td>
                <td class="open-cell">
                  <button
                    type="button"
                    class="card-toggle"
                    aria-expanded={cardOpen}
                    aria-controls={`record-card-${r.id}`}
                    aria-label={tr('records.ledger.cardAria', {
                      kind: kindLabel(tr, r.kind),
                      time: fmtRowTime(r)
                    })}
                    onclick={() => toggleCard(r.id)}
                  >
                    {tr('records.cardBtn')}
                  </button>
                  <a
                    class="drill"
                    href={`/records/${r.kind}/${r.rowId}`}
                    aria-label={tr('records.ledger.openAria', {
                      kind: kindLabel(tr, r.kind),
                      time: fmtRowTime(r)
                    })}
                  >
                    <ChevronRight size={14} />
                  </a>
                </td>
              </tr>
              {#if cardOpen}
                <tr class="card-row" id={`record-card-${r.id}`}>
                  <td colspan="7">
                    <RecordCardPanel
                      recordKind={r.kind}
                      rowId={r.rowId}
                      prefs={currentPrefs()}
                      onPrint={printCards}
                      onVoided={async () => {
                        voidedNote = 'Voided. The entry is gone from your records.';
                        await invalidateAll();
                      }}
                    />
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
      <div class="load-more">
        <p class="load-more-status" role="status" aria-live="polite">
          {tr('records.load.showing', {
            shown: data.records.length,
            total: data.filteredTotal,
            noun: data.filteredTotal === 1 ? tr('records.load.record') : tr('records.load.records')
          })}
          {#if hiddenCount > 0 && loadMoreHref === null}
            {tr('records.load.exportRest')}
          {/if}
        </p>
        {#if loadMoreHref}
          <a
            class="btn-ghost load-more-btn"
            href={loadMoreHref}
            data-sveltekit-noscroll
            data-sveltekit-keepfocus
            data-sveltekit-replacestate
          >
            {tr('records.load.more', { n: loadMoreCount })}
          </a>
        {/if}
      </div>
    {/if}
  </section>

  {#if data.approachingRetention.length > 0}
    <section class="alert" role="status">
      {tr('records.retention.alert', { n: data.approachingRetention.length })}
    </section>
  {/if}

  {#snippet complianceCards()}
    <section class="footer-cards">
      <article class="reassurance">
        <div class="reassurance-kicker">{tr('records.integrity.kicker')}</div>
        <p>
          {tr('records.integrity.body')}
        </p>
        <a
          class="reassurance-link"
          href="/api/records/export.vdacs.pdf{exportQuery}"
          data-sveltekit-reload
        >
          {tr('records.integrity.download')}
          <ArrowRight size={12} />
        </a>
      </article>
      <article class="reassurance">
        <div class="reassurance-kicker">{tr('records.inspector.kicker')}</div>
        <p>
          {tr('records.inspector.body')}
        </p>
        <a class="reassurance-link ghost" href="/settings/helpers">
          <Plus size={12} />
          {tr('records.inspector.invite')}
        </a>
      </article>
    </section>
  {/snippet}

  {#if data.chrome === 'full'}
    {@render complianceCards()}
  {:else}
    <details class="pesticide-fold" data-testid="records-pesticide-fold">
      <summary>{tr('records.fold.summary')}</summary>
      <p class="fold-lede">
        {tr('records.fold.lede')}
      </p>
      <div class="fold-actions">
        <a
          class="btn-ghost"
          href="/api/records/export.vdacs.pdf{exportQuery}"
          data-sveltekit-reload
        >
          <Lock size={13} />
          {tr('records.export.vdacsPdf')}
        </a>
        <a class="btn-ghost" href="/api/spray/records/export.usda.csv{exportQuery}" download>
          <FileText size={13} />
          {tr('records.export.usdaCsv')}
        </a>
      </div>
      {@render complianceCards()}
    </details>
  {/if}
</div>

{#if printJob}
  <CardPrintSheet
    cards={printJob.cards}
    layout={printJob.layout}
    prefs={currentPrefs()}
    origin={printJob.origin}
  />
{/if}

<style>
  .pesticide-fold {
    margin: 18px 0;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 12px);
    background: var(--color-paper);
    padding: 0 16px;
  }
  .pesticide-fold summary {
    min-height: 48px;
    display: flex;
    align-items: center;
    font-weight: 600;
    cursor: pointer;
    color: var(--color-forest-deep);
  }
  .fold-lede {
    margin: 0 0 10px;
  }
  .fold-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
  }
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
  .money-link {
    min-height: 48px;
  }
  .btn-primary {
    background: var(--color-forest-deep, #1f3a28);
    color: var(--color-paper, #fdfaf2);
    border-color: var(--color-forest-deep, #1f3a28);
  }
  .organic-link {
    min-height: 48px;
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
  .card-toggle {
    min-height: 48px;
    min-width: 48px;
    padding: 0 12px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    color: var(--color-forest-deep);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .card-toggle[aria-expanded='true'] {
    background: var(--pill-forest-bg);
    border-color: var(--pill-forest-bd);
  }
  .card-row td {
    background: var(--color-cream);
  }
  .load-more {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    padding: 12px 16px;
    border-top: 1px solid var(--color-divider);
  }
  .load-more-status {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-ink-soft, #4a4f46);
  }
  .load-more-btn {
    min-height: 48px;
    min-width: 48px;
    padding: 10px 18px;
    justify-content: center;
  }
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
  .late-pill {
    display: inline-block;
    margin-left: 6px;
  }
  .open-cell {
    text-align: right;
    white-space: nowrap;
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

  .watering-chip {
    text-decoration: none;
    min-height: 48px;
    padding: 0 4px;
  }
  .watering-row .drill {
    min-width: 48px;
    min-height: 48px;
    justify-content: center;
  }
  .watering-log {
    margin: 0.75rem 0;
    padding: 0.75rem;
    border: 1px solid var(--color-divider-soft);
    border-radius: 8px;
  }
  .watering-log h2 {
    margin: 0 0 0.25rem;
    font-size: 1rem;
  }
  .watering-note {
    margin: 0 0 0.5rem;
    color: var(--color-ink-soft);
  }
  .watering-rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .watering-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    padding: 0.25rem 0;
    border-bottom: 1px solid var(--color-divider-soft);
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
  .void-status {
    margin: 0;
  }
</style>
