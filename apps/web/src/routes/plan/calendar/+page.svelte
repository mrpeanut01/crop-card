<script lang="ts">
  import { goto } from '$app/navigation';
  import { createT } from '$lib/i18n';
  import { ChevronLeft, ChevronRight, Printer } from 'lucide-svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { cardHref, cardKey } from '$lib/cards/model';
  import type { ProvenanceSourceName } from '$lib/provenanceLabels';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';
  import { formatDueDay, ymdInZone } from '$lib/prefs';
  import { periodCardPrintHref } from '$lib/cards/build/calendar';
  import { SHORT_DAY_HOURS, PERSEPHONE_NAME_SOURCED } from '$lib/calendar/persephone';
  import type { RowNote, SowingBar } from '$lib/calendar/sowingCalendar';

  const { data } = $props();
  const tr = $derived(createT(data.locale));

  const DAY_MS = 86_400_000;
  const cal = $derived(data.calendar);
  const farmName = $derived(
    (data as { activeOwner?: { name: string } | null }).activeOwner?.name ?? tr('plan.cal.yourFarm')
  );
  const span = $derived(Math.max(DAY_MS, cal.toMs - cal.fromMs));
  const pos = (ms: number) => Math.min(100, Math.max(0, ((ms - cal.fromMs) / span) * 100));
  const width = (a: number, b: number) => Math.max(0.6, pos(b) - pos(a));
  const date = (ms: number) => formatDueDay(ms, currentPrefs(), 'date');
  const shortDate = (ms: number) => formatDueDay(ms, currentPrefs(), 'date', { year: undefined });

  const ordered = $derived([...data.years].sort((a, b) => a - b));
  const earlier = $derived(ordered.filter((y) => y < data.year).at(-1) ?? null);
  const later = $derived(ordered.find((y) => y > data.year) ?? null);

  const ticks = $derived.by(() => {
    const out: { ms: number; label: string; jan: boolean }[] = [];
    const start = new Date(cal.fromMs);
    let d = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    while (d.getTime() <= cal.toMs) {
      const ms = d.getTime();
      out.push({
        ms,
        jan: d.getMonth() === 0,
        label:
          d.getMonth() === 0
            ? fmt.instant(ms, 'date', { day: undefined })
            : fmt.instant(ms, 'date', { day: undefined, year: undefined })
      });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    return out;
  });

  const shortSpans = $derived(cal.shortDays.status === 'spans' ? cal.shortDays.spans : []);
  const printedOn = $derived(fmt.instant(data.nowMs, 'date'));
  const monthTasksHref = $derived(
    periodCardPrintHref('month', ymdInZone(data.nowMs, currentPrefs().timeZone))
  );

  function pickYear(y: number) {
    goto(`/plan/calendar?year=${y}`, { reset: false });
  }

  const FROST_KEY = {
    'last-spring': 'plan.cal.frost.last-spring',
    'first-fall': 'plan.cal.frost.first-fall',
    'hard-last-spring': 'plan.cal.frost.hard-last-spring',
    'hard-first-fall': 'plan.cal.frost.hard-first-fall'
  } as const;
  const BAR_KEY = {
    'indoor-sow': 'plan.cal.bar.indoor-sow',
    transplant: 'plan.cal.bar.transplant',
    'direct-sow': 'plan.cal.bar.direct-sow',
    window: 'plan.cal.bar.window'
  } as const;
  const PROV_KEY = {
    plugin: 'plan.cal.prov.plugin',
    data: 'plan.cal.prov.data',
    ai: 'plan.cal.prov.ai',
    manual: 'plan.cal.prov.manual',
    fallback: 'plan.cal.prov.fallback'
  } as const satisfies Record<ProvenanceSourceName, string>;

  const shortBandLabel = $derived(
    tr(PERSEPHONE_NAME_SOURCED ? 'plan.cal.shortBandSourced' : 'plan.cal.shortBand', {
      hours: SHORT_DAY_HOURS
    })
  );

  function noteText(note: RowNote, fmtDay: (ms: number) => string): string {
    switch (note.kind) {
      case 'heated':
        return tr('plan.cal.note.heated');
      case 'cover-unknown':
        return tr('plan.cal.note.coverUnknown');
      case 'covered':
        if (note.springMs !== null && note.fallMs !== null) {
          return tr('plan.cal.note.coveredBoth', {
            from: fmtDay(note.springMs),
            to: fmtDay(note.fallMs)
          });
        }
        if (note.springMs !== null) {
          return tr('plan.cal.note.coveredSpring', { from: fmtDay(note.springMs) });
        }
        return tr('plan.cal.note.coveredFall', { date: fmtDay(note.fallMs as number) });
    }
  }

  function print() {
    const previous = document.title;
    document.title = tr('plan.cal.docTitle', { farm: farmName, year: data.year });
    window.print();
    document.title = previous;
  }

  function barStyle(b: SowingBar): string {
    if (b.kind === 'transplant' || b.kind === 'direct-sow') return `left:${pos(b.startMs)}%`;
    return `left:${pos(b.startMs)}%; width:${width(b.startMs, b.endMs)}%`;
  }

  function barFmt(b: SowingBar, d: (ms: number) => string): string {
    const label = tr(BAR_KEY[b.kind]);
    if (b.kind === 'transplant' || b.kind === 'direct-sow') {
      return tr(b.recorded ? 'plan.cal.barPoint' : 'plan.cal.barPointPlanned', {
        label,
        date: d(b.startMs)
      });
    }
    if (b.kind === 'window') {
      return tr('plan.cal.windowRange', { start: d(b.startMs), end: d(b.endMs) });
    }
    return tr(b.recorded ? 'plan.cal.barRange' : 'plan.cal.barRangePlanned', {
      label,
      start: d(b.startMs),
      end: d(b.endMs)
    });
  }

  const barText = (b: SowingBar) => barFmt(b, date);
  const barLine = (b: SowingBar) => barFmt(b, shortDate);
</script>

<svelte:head><title>{tr('plan.cal.pageTitle')}</title></svelte:head>

<div class="wrap sowing-calendar" data-testid="sowing-calendar">
  <header class="no-print">
    <p class="kicker">{tr('plan.cal.kicker')}</p>
    <h1 class="serif">{tr('plan.cal.title')}</h1>
    <p class="lede">{tr('plan.cal.lede')}</p>
    <div class="controls">
      <div class="pick">
        <button
          type="button"
          class="nav-btn"
          aria-label={tr('plan.cal.earlier')}
          disabled={earlier === null}
          onclick={() => earlier !== null && pickYear(earlier)}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <select
          aria-label={tr('plan.cal.season')}
          value={data.year}
          onchange={(e) => pickYear(Number(e.currentTarget.value))}
        >
          {#each data.years as y (y)}
            <option value={y}>{tr('plan.cal.seasonOption', { year: y })}</option>
          {/each}
        </select>
        <button
          type="button"
          class="nav-btn"
          aria-label={tr('plan.cal.later')}
          disabled={later === null}
          onclick={() => later !== null && pickYear(later)}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <button type="button" class="primary" onclick={print}>
        <Printer size={16} aria-hidden="true" />
        {tr('plan.cal.print')}
      </button>
      <a class="secondary" href="/today?view=season&season={data.year}"
        >{tr('plan.cal.seasonView')}</a
      >
      <a class="secondary" href={monthTasksHref} data-testid="print-month-tasks"
        >{tr('plan.cal.printMonth')}</a
      >
    </div>
    <p class="hint">{tr('plan.cal.printHint')}</p>
  </header>

  <div class="print-only print-head print-top" data-testid="print-top">
    <span class="farm">{farmName}</span>
    <span>{tr('plan.cal.printTitle', { year: data.year })}</span>
    <span class="printed">{tr('plan.cal.printedOn', { date: printedOn })}</span>
  </div>

  <section class="facts" aria-label={tr('plan.cal.frostDaylight')}>
    <ul class="frost-list">
      {#each cal.frostLines as l (l.kind)}
        <li data-frost={l.kind}>
          <span class="sw frost" class:hard={l.kind.startsWith('hard')}></span>
          {tr(FROST_KEY[l.kind])}: <strong>{date(l.ms)}</strong>
          <span class="screen-only"
            ><Provenance
              source={l.provenance}
              label={l.provenance === 'data' ? tr('onboard.frost.weatherService') : undefined}
              long={l.provenance === 'data' ? tr('onboard.frost.refLong') : undefined}
              compact
            /></span
          >
          <span class="print-only prov"
            >({l.provenance === 'data'
              ? tr('onboard.frost.weatherService')
              : tr(PROV_KEY[l.provenance])})</span
          >
        </li>
      {/each}
    </ul>
    <p class="daylight" data-testid="daylight-note">
      {#if cal.shortDays.status === 'no-location'}
        {tr('plan.cal.noLocation')}
        <a class="no-print inline" href="/settings/farm">{tr('plan.cal.setLocation')}</a>
      {:else if cal.shortDays.status === 'never'}
        {tr('plan.cal.neverShort', { hours: SHORT_DAY_HOURS })}
      {:else if shortSpans.length === 0}
        {tr('plan.cal.noShort', { hours: SHORT_DAY_HOURS })}
      {:else}
        <span class="sw short"></span>
        {shortBandLabel}:
        {shortSpans
          .map((s) => tr('plan.cal.range', { start: date(s.startMs), end: date(s.endMs) }))
          .join('; ')}.
      {/if}
    </p>
  </section>

  {#if cal.rows.length === 0}
    <p class="empty" data-testid="sowing-empty">
      {tr('plan.cal.empty', { year: data.year })}
    </p>
    <a class="secondary no-print" href="/plan">{tr('plan.cal.openPlan')}</a>
  {:else}
    <div class="frame" tabindex="-1">
      <table class="grid">
        <colgroup>
          <col class="label-col" />
          <col />
        </colgroup>
        <thead>
          <tr class="print-only print-head">
            <th colspan="2">
              <span class="farm">{farmName}</span>
              <span>{tr('plan.cal.printTitle', { year: data.year })}</span>
              <span class="printed">{tr('plan.cal.printedOn', { date: printedOn })}</span>
            </th>
          </tr>
          <tr class="legend-row">
            <th colspan="2">
              <ul class="legend" aria-label={tr('plan.cal.key')}>
                <li><span class="sw bar-solid"></span>{tr('plan.cal.legend.sown')}</li>
                <li><span class="sw bar-dashed"></span>{tr('plan.cal.legend.sowPlanned')}</li>
                <li><span class="sw mark transplant"></span>{tr('plan.cal.legend.transplant')}</li>
                <li><span class="sw mark direct"></span>{tr('plan.cal.legend.direct')}</li>
                <li><span class="sw mark hollow"></span>{tr('plan.cal.legend.planned')}</li>
                <li><span class="sw window"></span>{tr('plan.cal.legend.window')}</li>
                <li><span class="sw frost"></span>{tr('plan.cal.legend.frost')}</li>
                {#if shortSpans.length > 0}<li>
                    <span class="sw short"></span>{shortBandLabel}
                  </li>{/if}
              </ul>
            </th>
          </tr>
          <tr class="axis-row" aria-hidden="true">
            <th class="label"></th>
            <th class="track axis">
              {#each ticks as t (t.ms)}
                <span class="tick" class:jan={t.jan} style="left:{pos(t.ms)}%">{t.label}</span>
              {/each}
            </th>
          </tr>
        </thead>
        <tbody>
          {#each cal.rows as row (row.plantingId)}
            <tr class="row" data-planting-id={row.plantingId}>
              <th class="label" scope="row">
                <a href={cardHref('planting', cardKey('planting', row.plantingId))}>{row.name}</a>
                <span class="block">{row.blockName}</span>
                {#if row.bars.length > 0}
                  <span class="dates" data-testid="row-dates">
                    {#each row.bars as b, k (k)}<span class="date-line">{barLine(b)}</span>{/each}
                  </span>
                {/if}
                {#if row.note}
                  <span class="note" data-testid="row-note">{noteText(row.note, shortDate)}</span>
                {/if}
              </th>
              <td class="track">
                {#each shortSpans as s (s.startMs)}
                  <span
                    class="short-band"
                    style="left:{pos(s.startMs)}%; width:{width(s.startMs, s.endMs)}%"
                  ></span>
                {/each}
                {#each cal.frostLines as l (l.kind)}
                  <span
                    class="frost-line"
                    class:hard={l.kind.startsWith('hard')}
                    style="left:{pos(l.ms)}%"
                  ></span>
                {/each}
                {#each row.bars as b, k (k)}
                  <span
                    class="bar"
                    class:mark={b.kind === 'transplant' || b.kind === 'direct-sow'}
                    class:planned={!b.recorded}
                    data-kind={b.kind}
                    title={barText(b)}
                    style={barStyle(b)}
                    >{#if b.kind === 'window'}<span class="bar-text"
                        >{tr('plan.cal.bar.window')}</span
                      >{/if}</span
                  >
                {/each}
                {#if row.bars.length === 0}
                  <span class="undated">
                    {row.plantingDate === null
                      ? tr('plan.cal.noPlantingDate')
                      : tr('plan.cal.noSowDates')}
                  </span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .wrap {
    max-width: 1200px;
    margin: 0 auto;
    padding: 16px 16px 96px;
    min-width: 0;
  }
  .kicker {
    margin: 0;
    font-size: var(--font-size-kicker, 11px);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--color-ink-muted);
  }
  h1 {
    margin: 4px 0 6px;
    font-size: 1.9rem;
    color: var(--color-forest-deep);
  }
  .lede {
    margin: 0 0 12px;
    max-width: 70ch;
    color: var(--color-ink-soft);
    font-size: 14px;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .nav-btn,
  .primary,
  .secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 48px;
    min-height: 48px;
    border-radius: var(--radius-input, 6px);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
  }
  .nav-btn {
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
  }
  .nav-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .primary {
    padding: 0 16px;
    border: none;
    background: var(--color-forest);
    color: var(--color-cream);
  }
  .secondary {
    padding: 0 14px;
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-forest-deep);
  }
  select {
    min-height: 48px;
    padding: 0 10px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    font-weight: 600;
  }
  .nav-btn:focus-visible,
  .primary:focus-visible,
  .secondary:focus-visible,
  select:focus-visible,
  .label a:focus-visible,
  .inline:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .hint {
    margin: 8px 0 0;
    font-size: 12.5px;
    color: var(--color-ink-soft);
  }
  .facts {
    margin: 16px 0 12px;
    font-size: 13px;
    color: var(--color-ink);
  }
  .frost-list {
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
  }
  .frost-list li {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .daylight {
    margin: 0;
    color: var(--color-ink-soft);
  }
  .inline {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    font-weight: 600;
    color: var(--color-forest-deep);
  }
  .empty {
    color: var(--color-ink-soft);
  }
  .frame {
    max-width: 100%;
    overflow-x: auto;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
  }
  .grid {
    width: 100%;
    min-width: 760px;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .label-col {
    width: 11rem;
  }
  .grid th,
  .grid td {
    padding: 0;
    text-align: left;
    font-weight: normal;
  }
  .legend-row th {
    padding: 10px 12px 6px;
  }
  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 12px;
    color: var(--color-ink-soft);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .sw {
    display: inline-block;
    width: 16px;
    height: 10px;
    border-radius: 2px;
    vertical-align: middle;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .sw.bar-solid {
    background: var(--color-forest-deep);
  }
  .sw.bar-dashed {
    border: 2px dashed var(--color-forest-deep);
  }
  .sw.mark {
    width: 10px;
    height: 10px;
  }
  .sw.transplant {
    background: var(--color-forest-deep);
    transform: rotate(45deg) scale(0.85);
  }
  .sw.direct {
    background: var(--color-forest-deep);
    border-radius: 50%;
  }
  .sw.hollow {
    border: 2px solid var(--color-forest-deep);
    border-radius: 50%;
  }
  .sw.window {
    border: 1.5px dashed var(--color-ink);
    background: repeating-linear-gradient(135deg, transparent 0 3px, rgba(0, 0, 0, 0.18) 3px 4px);
  }
  .sw.frost {
    width: 3px;
    height: 14px;
    background: var(--color-sky, #2f6f9f);
  }
  .sw.frost.hard {
    background: transparent;
    border-left: 3px dotted var(--color-sky, #2f6f9f);
  }
  .sw.short {
    background: rgba(0, 0, 0, 0.12);
    border: 1px solid rgba(0, 0, 0, 0.25);
  }
  .label {
    position: sticky;
    left: 0;
    z-index: 2;
    width: 11rem;
    padding: 6px 10px !important;
    vertical-align: top;
    border-top: 1px solid var(--color-divider-soft);
    border-right: 1px solid var(--color-divider-soft);
    background: var(--color-paper);
  }
  .label a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    font-weight: 600;
    color: var(--color-forest-deep);
    overflow-wrap: anywhere;
  }
  .block,
  .note,
  .date-line {
    display: block;
    font-size: 11.5px;
    color: var(--color-ink-soft);
  }
  .dates {
    display: block;
    margin-top: 2px;
  }
  .date-line {
    color: var(--color-ink);
  }
  .note {
    font-style: italic;
  }
  .track {
    position: relative;
    height: 56px;
    border-top: 1px solid var(--color-divider-soft);
    overflow: hidden;
  }
  .axis-row .track,
  .axis-row .label {
    height: 22px;
    border-top: 0;
  }
  .tick {
    position: absolute;
    top: 0;
    bottom: 0;
    padding-left: 3px;
    border-left: 1px solid var(--color-divider);
    font-size: 10.5px;
    color: var(--color-ink-soft);
    white-space: nowrap;
  }
  .tick.jan {
    border-left: 2px solid var(--color-ink-soft);
    font-weight: 700;
  }
  .short-band {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.07);
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .frost-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 2px solid var(--color-sky, #2f6f9f);
  }
  .frost-line.hard {
    border-left-style: dotted;
  }
  .bar {
    position: absolute;
    top: 20px;
    height: 16px;
    border-radius: 3px;
    background: var(--color-forest-deep);
    border: 2px solid var(--color-forest-deep);
    box-sizing: border-box;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .bar.planned {
    background: transparent;
    border-style: dashed;
  }
  .bar[data-kind='window'] {
    border: 1.5px dashed var(--color-ink);
    background: repeating-linear-gradient(135deg, transparent 0 4px, rgba(0, 0, 0, 0.14) 4px 5px);
    overflow: hidden;
  }
  .bar-text {
    display: block;
    padding-left: 4px;
    font-size: 10.5px;
    line-height: 12px;
    color: var(--color-ink);
    white-space: nowrap;
  }
  .bar.mark {
    width: 14px;
    height: 14px;
    top: 21px;
    margin-left: -7px;
    border-radius: 50%;
  }
  .bar.mark[data-kind='transplant'] {
    border-radius: 2px;
    transform: rotate(45deg);
  }
  .bar.mark.planned {
    background: var(--color-paper);
    border-style: solid;
  }
  .undated {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    padding-left: 8px;
    font-size: 12px;
    color: var(--color-ink-soft);
  }
  .print-only {
    display: none;
  }
  @page sowing {
    size: letter landscape;
    margin: 0.4in;
  }
  @media print {
    :global(body:has(.sowing-calendar) :has(> #main-content) > :not(#main-content)) {
      display: none !important;
    }
    :global(:has(.sowing-calendar)) {
      padding: 0 !important;
      margin: 0 !important;
      border: 0 !important;
    }
    .sowing-calendar {
      page: sowing;
      max-width: none;
      padding: 0;
      background: #fff;
      color: #000;
      font-size: 10pt;
    }
    .facts,
    .daylight,
    .legend,
    .block,
    .note,
    .date-line,
    .tick,
    .undated {
      color: #000;
    }
    .facts,
    .legend {
      font-size: 9pt;
    }
    .block,
    .note,
    .date-line,
    .tick {
      font-size: 8pt;
    }
    .label {
      position: static;
      background: #fff;
    }
    .prov {
      font-size: 8pt;
      color: #333;
    }
    .label,
    .track {
      border-top: 0.5pt solid #999;
    }
    .frost-line {
      border-left-color: #000;
    }
    .sw.frost {
      background: #000;
    }
    .sw.frost.hard,
    .frost-line.hard {
      border-left-color: #000;
    }
    .bar:not([data-kind='window']),
    .sw.bar-solid,
    .sw.transplant,
    .sw.direct {
      background: #000;
      border-color: #000;
    }
    .bar.planned:not([data-kind='window']),
    .bar.mark.planned {
      background: #fff;
    }
    .sw.bar-dashed,
    .sw.hollow {
      border-color: #000;
    }
    .no-print,
    .screen-only {
      display: none !important;
    }
    .print-only {
      display: revert;
    }
    .print-head th {
      padding: 0 0 6px;
      font-size: 14pt;
      color: #000;
    }
    .print-head span {
      margin-right: 16px;
    }
    .print-top {
      padding: 0 0 6px;
      font-size: 14pt;
      color: #000;
    }
    .print-head .farm {
      font-weight: 700;
    }
    .print-head .printed {
      font-size: 9pt;
      color: #333;
    }
    .frame {
      overflow: visible;
      border: 1px solid #000;
      border-radius: 0;
    }
    .grid {
      min-width: 0;
    }
    thead {
      display: table-header-group;
    }
    tr.row {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .label a {
      min-height: 0;
      color: #000;
    }
    .track {
      height: 40px;
    }
    .bar {
      top: 12px;
    }
    .bar.mark {
      top: 13px;
    }
  }
</style>
