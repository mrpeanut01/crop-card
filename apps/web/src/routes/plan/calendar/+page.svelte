<script lang="ts">
  import { goto } from '$app/navigation';
  import { ChevronLeft, ChevronRight, Printer } from 'lucide-svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { cardHref, cardKey } from '$lib/cards/model';
  import { PROVENANCE_LABEL } from '$lib/provenanceLabels';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';
  import { ymdInZone } from '$lib/prefs';
  import { periodCardPrintHref } from '$lib/cards/build/calendar';
  import { SHORT_DAY_HOURS, shortDayBandLabel } from '$lib/calendar/persephone';
  import {
    FROST_LINE_LABEL,
    SOWING_BAR_LABEL,
    rowNoteText,
    type SowingBar
  } from '$lib/calendar/sowingCalendar';

  const { data } = $props();

  const DAY_MS = 86_400_000;
  const cal = $derived(data.calendar);
  const farmName = $derived(
    (data as { activeOwner?: { name: string } | null }).activeOwner?.name ?? 'Your farm'
  );
  const span = $derived(Math.max(DAY_MS, cal.toMs - cal.fromMs));
  const pos = (ms: number) => Math.min(100, Math.max(0, ((ms - cal.fromMs) / span) * 100));
  const width = (a: number, b: number) => Math.max(0.6, pos(b) - pos(a));
  const date = (ms: number) => fmt.instant(ms, 'date');
  const shortDate = (ms: number) => fmt.instant(ms, 'date', { year: undefined });

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
  const printedOn = $derived(date(data.nowMs));
  const monthTasksHref = $derived(
    periodCardPrintHref('month', ymdInZone(data.nowMs, currentPrefs().timeZone))
  );

  function pickYear(y: number) {
    goto(`/plan/calendar?year=${y}`, { noScroll: true });
  }

  function print() {
    const previous = document.title;
    document.title = `${farmName} sowing calendar ${data.year}`;
    window.print();
    document.title = previous;
  }

  function barStyle(b: SowingBar): string {
    if (b.kind === 'transplant' || b.kind === 'direct-sow') return `left:${pos(b.startMs)}%`;
    return `left:${pos(b.startMs)}%; width:${width(b.startMs, b.endMs)}%`;
  }

  function barText(b: SowingBar): string {
    if (b.kind === 'transplant' || b.kind === 'direct-sow') {
      return `${SOWING_BAR_LABEL[b.kind]} ${date(b.startMs)}${b.recorded ? '' : ' (planned)'}`;
    }
    if (b.kind === 'window') return `Window ${date(b.startMs)} to ${date(b.endMs)}`;
    return `${SOWING_BAR_LABEL[b.kind]} ${date(b.startMs)} to ${date(b.endMs)}${b.recorded ? '' : ' (planned)'}`;
  }

  function barLine(b: SowingBar): string {
    if (b.kind === 'transplant' || b.kind === 'direct-sow') {
      return `${SOWING_BAR_LABEL[b.kind]} ${shortDate(b.startMs)}${b.recorded ? '' : ' (planned)'}`;
    }
    if (b.kind === 'window') return `Window ${shortDate(b.startMs)} to ${shortDate(b.endMs)}`;
    return `${SOWING_BAR_LABEL[b.kind]} ${shortDate(b.startMs)} to ${shortDate(b.endMs)}${b.recorded ? '' : ' (planned)'}`;
  }
</script>

<svelte:head><title>Sowing calendar · CropCard</title></svelte:head>

<div class="wrap sowing-calendar" data-testid="sowing-calendar">
  <header class="no-print">
    <p class="kicker">Plan</p>
    <h1 class="serif">Sowing calendar</h1>
    <p class="lede">
      When each planting of the season is sown indoors, set out or sown in the ground, against your
      frost dates. Print it for the barn wall or the seed-starting shelf.
    </p>
    <div class="controls">
      <div class="pick">
        <button
          type="button"
          class="nav-btn"
          aria-label="Earlier season"
          disabled={earlier === null}
          onclick={() => earlier !== null && pickYear(earlier)}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <select
          aria-label="Season"
          value={data.year}
          onchange={(e) => pickYear(Number(e.currentTarget.value))}
        >
          {#each data.years as y (y)}
            <option value={y}>Season {y}</option>
          {/each}
        </select>
        <button
          type="button"
          class="nav-btn"
          aria-label="Later season"
          disabled={later === null}
          onclick={() => later !== null && pickYear(later)}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <button type="button" class="primary" onclick={print}>
        <Printer size={16} aria-hidden="true" /> Print
      </button>
      <a class="secondary" href="/today?view=season&season={data.year}">Season view</a>
      <a class="secondary" href={monthTasksHref} data-testid="print-month-tasks"
        >Print this month's tasks</a
      >
    </div>
    <p class="hint">
      Choose landscape paper in the print dialog if it does not pick it for you, and turn off
      headers and footers.
    </p>
  </header>

  <section class="facts" aria-label="Frost and daylight">
    <ul class="frost-list">
      {#each cal.frostLines as l (l.kind)}
        <li data-frost={l.kind}>
          <span class="sw frost" class:hard={l.kind.startsWith('hard')}></span>
          {FROST_LINE_LABEL[l.kind]}: <strong>{date(l.ms)}</strong>
          <span class="screen-only"><Provenance source={l.provenance} compact /></span>
          <span class="print-only prov">({PROVENANCE_LABEL[l.provenance]})</span>
        </li>
      {/each}
    </ul>
    <p class="daylight" data-testid="daylight-note">
      {#if cal.shortDays.status === 'no-location'}
        Set your farm location to show daylight.
        <a class="no-print inline" href="/settings/farm">Set location</a>
      {:else if cal.shortDays.status === 'never'}
        Days never drop under {SHORT_DAY_HOURS} hours here.
      {:else if shortSpans.length === 0}
        No days under {SHORT_DAY_HOURS} hours of daylight fall in this season.
      {:else}
        <span class="sw short"></span>
        {shortDayBandLabel()}:
        {shortSpans.map((s) => `${date(s.startMs)} to ${date(s.endMs)}`).join('; ')}.
      {/if}
    </p>
  </section>

  {#if cal.rows.length === 0}
    <p class="empty" data-testid="sowing-empty">
      Nothing is planted or planned for {data.year} yet. Plan a crop on the Plan page to see it here.
    </p>
    <a class="secondary no-print" href="/plan">Open the Plan page</a>
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
              <span>Sowing calendar, Season {data.year}</span>
              <span class="printed">Printed {printedOn}</span>
            </th>
          </tr>
          <tr class="legend-row">
            <th colspan="2">
              <ul class="legend" aria-label="Key">
                <li><span class="sw bar-solid"></span>Sown indoors (tray on record)</li>
                <li><span class="sw bar-dashed"></span>Sow indoors (planned)</li>
                <li><span class="sw mark transplant"></span>Transplant</li>
                <li><span class="sw mark direct"></span>Direct sow</li>
                <li><span class="sw mark hollow"></span>Planned date</li>
                <li><span class="sw window"></span>Window (no date yet)</li>
                <li><span class="sw frost"></span>Frost date</li>
                {#if shortSpans.length > 0}<li>
                    <span class="sw short"></span>{shortDayBandLabel()}
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
                  <span class="note" data-testid="row-note">{rowNoteText(row.note, shortDate)}</span
                  >
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
                    >{#if b.kind === 'window'}<span class="bar-text">Window</span>{/if}</span
                  >
                {/each}
                {#if row.bars.length === 0}
                  <span class="undated">
                    {row.plantingDate === null ? 'No planting date yet' : 'No sowing dates'}
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
