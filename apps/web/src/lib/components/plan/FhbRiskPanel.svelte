<script lang="ts">
  import { CloudRain } from 'lucide-svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import {
    FHB_HIGH_HOURS,
    FHB_MODERATE_HOURS,
    type DailyScabHours,
    type FhbAssessment
  } from '$lib/plan/smallGrain';
  import { localDateKey } from '$lib/weather/leafWet';
  import { currentPrefs, fmt } from '$lib/prefsState.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface FungicideNote {
    occurredAt: number;
    products: string[];
  }

  interface Props {
    assessment: FhbAssessment;
    daily: DailyScabHours[];
    nowMs: number;
    loading?: boolean;
    fungicides?: FungicideNote[];
    /** Station label when past hours come from NOAA observations. */
    observedLabel?: string | null;
  }

  const {
    assessment,
    daily,
    nowMs,
    loading = false,
    fungicides = [],
    observedLabel = null
  }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  const dataDetail = $derived(
    observedLabel
      ? tr('planui.fhb.dataObserved', { label: observedLabel })
      : tr('planui.fhb.dataForecast')
  );

  const DAY = 24 * 60 * 60 * 1000;
  const W = 300;
  const H = 64;
  const GAP = 6;

  function fmtDay(ms: number): string {
    return fmt.day(ms, 'month-day');
  }
  const scabRange = $derived(
    `${fmt.qty(59, 'temperature', { bare: true })}–${fmt.qty(86, 'temperature')}`
  );
  function dayLabel(date: string): string {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString(
      page.data?.locale === 'es' ? 'es-US' : 'en-US',
      {
        weekday: 'short',
        timeZone: 'UTC'
      }
    );
  }

  const LEVEL_WORD = $derived({
    low: tr('planui.fhb.low'),
    moderate: tr('planui.fhb.moderate'),
    high: tr('planui.fhb.high')
  } as const);
  const headline = $derived.by(() => {
    if (loading) return tr('planui.fhb.checking');
    if (assessment.level) return LEVEL_WORD[assessment.level];
    switch (assessment.status) {
      case 'too-early':
        return tr('planui.fhb.tooEarly');
      case 'past':
        return tr('planui.fhb.past');
      case 'no-anthesis':
        return tr('planui.fhb.noAnthesis');
      default:
        return tr('planui.fhb.unknown');
    }
  });

  const message = $derived.by(() => {
    const a = assessment;
    if (loading) return tr('planui.fhb.loadingForecast');
    switch (a.status) {
      case 'no-anthesis':
        return tr('planui.fhb.setDate');
      case 'too-early': {
        const days = Math.max(0, Math.ceil(((a.windowStartMs ?? nowMs) - nowMs) / DAY));
        return tr('planui.fhb.msgTooEarly', { date: fmtDay(a.anthesisMs!), days });
      }
      case 'past':
        return tr('planui.fhb.msgPast', { date: fmtDay(a.anthesisMs!) });
      case 'no-data':
        return tr('planui.fhb.msgNoData');
      case 'insufficient-data':
        return tr('planui.fhb.msgInsufficient', { covered: a.coveredHours });
      case 'assessed':
        return tr('planui.fhb.msgAssessed', {
          fav: a.favorableHours,
          covered: a.coveredHours,
          range: scabRange,
          index: a.index,
          mean:
            a.meanTempF !== null
              ? tr('planui.fhb.msgMean', { temp: fmt.qty(a.meanTempF, 'temperature') })
              : ''
        });
    }
    return '';
  });

  const tone = $derived(
    assessment.level === 'high' ? 'high' : assessment.level === 'moderate' ? 'mod' : 'low'
  );

  const max = $derived(Math.max(12, ...daily.map((d) => d.favorableHours)));
  const barW = $derived(daily.length > 0 ? (W - GAP * (daily.length - 1)) / daily.length : 0);
  const summary = $derived(
    daily.length === 0
      ? tr('planui.fhb.summaryNone')
      : tr('planui.fhb.summary', {
          list: daily.map((d) => `${dayLabel(d.date)} ${d.favorableHours}`).join(', ')
        })
  );
  const windowDates = $derived.by(() => {
    if (assessment.windowStartMs === null || assessment.windowEndMs === null)
      return new Set<string>();
    const s = new Set<string>();
    for (let t = assessment.windowStartMs; t < assessment.windowEndMs; t += DAY) {
      s.add(localDateKey(t, currentPrefs().timeZone));
    }
    s.add(localDateKey(assessment.windowEndMs - 1, currentPrefs().timeZone));
    return s;
  });
  function barFill(h: number): string {
    if (h >= 12) return 'var(--color-rust)';
    if (h >= 4) return 'var(--color-wheat)';
    return 'var(--color-forest)';
  }
</script>

<section class="card" aria-labelledby="fhb-title" data-testid="fhb-panel">
  <header class="head">
    <div class="title-row">
      <CloudRain size={16} strokeWidth={1.75} aria-hidden="true" />
      <h2 id="fhb-title" class="serif">{tr('planui.fhb.title')}</h2>
    </div>
    <Provenance
      source={assessment.provenance}
      detail={assessment.provenance === 'data' ? dataDetail : tr('planui.fhb.detailNoWeather')}
    />
  </header>
  <p class="sub">
    {tr('planui.fhb.sub')}
    {#if assessment.anthesisMs !== null}{tr('planui.fhb.flowering', {
        date: fmtDay(assessment.anthesisMs)
      })}{/if}
  </p>

  <div class="body">
    <div class="risk" aria-live="polite">
      <div class="kicker">{tr('planui.fhb.risk')}</div>
      <div class="level serif {tone}" data-testid="fhb-level">{headline}</div>
      <p class="msg">{message}</p>
    </div>

    <div class="curve">
      <div class="kicker">{tr('planui.fhb.curve')}</div>
      {#if daily.length === 0}
        <p class="empty">{loading ? '…' : tr('planui.fhb.noHourly')}</p>
      {:else}
        <svg viewBox="0 0 {W} {H + 30}" role="img" aria-label={summary}>
          {#each daily as d, i (d.date)}
            {@const h = d.favorableHours === 0 ? 3 : Math.max(6, (d.favorableHours / max) * H)}
            {@const x = i * (barW + GAP)}
            {#if windowDates.has(d.date)}
              <rect {x} y="0" width={barW} height={H} class="win" rx="3" />
            {/if}
            <rect {x} y={H - h} width={barW} height={h} rx="3" fill={barFill(d.favorableHours)} />
            <text x={x + barW / 2} y={H + 12} text-anchor="middle" class="val"
              >{d.favorableHours}h</text
            >
            <text x={x + barW / 2} y={H + 25} text-anchor="middle" class="day"
              >{dayLabel(d.date)}</text
            >
          {/each}
        </svg>
        {#if daily.some((d) => windowDates.has(d.date))}
          <p class="legend"><span class="swatch"></span> {tr('planui.fhb.legend')}</p>
        {/if}
      {/if}
    </div>
  </div>

  {#if fungicides.length > 0}
    <ul class="fungicides" aria-label={tr('planui.fhb.fungAria')}>
      {#each fungicides as f, i (i)}
        <li>
          <Provenance source="data" detail={tr('planui.fhb.fungDetail')} compact />
          {tr('planui.fhb.fungRecord', {
            date: fmt.instant(f.occurredAt, 'month-day'),
            products: f.products.join(' + ') || tr('planui.fhb.notRecorded')
          })}
        </li>
      {/each}
    </ul>
  {/if}

  <p class="foot">
    {tr('planui.fhb.footA', {
      range: scabRange,
      moderate: FHB_MODERATE_HOURS,
      high: FHB_HIGH_HOURS
    })}
    <a href="https://www.wheatscab.psu.edu/" target="_blank" rel="noopener noreferrer"
      >wheatscab.psu.edu ↗</a
    >{tr('planui.fhb.footB')}
  </p>
</section>

<style>
  .card {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 10px);
    min-width: 0;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 0;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-wheat);
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
    color: var(--color-forest-deep);
  }
  .sub {
    margin: 4px 16px 0;
    font-size: 0.8rem;
    color: var(--color-ink-soft);
    padding-bottom: 10px;
    border-bottom: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  .body {
    display: grid;
    gap: 16px;
    padding: 14px 16px;
  }
  .kicker {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
    margin-bottom: 4px;
  }
  .level {
    font-size: 1.9rem;
    line-height: 1.05;
    color: var(--color-forest-deep);
  }
  .level.mod {
    color: #8a6722;
  }
  .level.high {
    color: var(--color-rust);
  }
  .msg {
    margin: 6px 0 0;
    font-size: 0.82rem;
    line-height: 1.45;
    color: var(--color-ink-soft);
  }
  svg {
    width: 100%;
    max-width: 420px;
    height: auto;
  }
  .win {
    fill: #f1d9ce;
    opacity: 0.6;
  }
  .val {
    font-size: 10px;
    font-weight: 700;
    fill: var(--color-ink);
  }
  .day {
    font-size: 10px;
    fill: var(--color-ink-soft);
  }
  .legend {
    margin: 4px 0 0;
    font-size: 0.72rem;
    color: var(--color-ink-muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    width: 12px;
    height: 12px;
    background: #f1d9ce;
    border-radius: 2px;
    display: inline-block;
  }
  .empty {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 0.82rem;
  }
  .fungicides {
    list-style: none;
    margin: 0;
    padding: 0 16px 10px;
    display: grid;
    gap: 6px;
    font-size: 0.82rem;
    color: var(--color-ink);
  }
  .fungicides li {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .foot {
    margin: 0;
    padding: 10px 16px 14px;
    font-size: 0.75rem;
    line-height: 1.45;
    color: var(--color-ink-muted);
    border-top: 1px dashed var(--color-divider);
  }
  .foot a {
    color: var(--color-forest-deep);
    font-weight: 600;
    display: inline-block;
    padding: 12px 0;
    margin: -12px 0;
  }
  @media (min-width: 720px) {
    .body {
      grid-template-columns: 1fr 1.2fr;
    }
  }
</style>
