<script lang="ts">
  import { ArrowLeft, Wheat } from 'lucide-svelte';
  import ZadoksTimeline from '$lib/components/plan/ZadoksTimeline.svelte';
  import FhbRiskPanel from '$lib/components/plan/FhbRiskPanel.svelte';
  import VernalizationPanel from '$lib/components/plan/VernalizationPanel.svelte';
  import {
    assessFhbRisk,
    assessVernalization,
    dailyScabFavorableHours
  } from '$lib/plan/smallGrain';
  import {
    mergeObservedAndForecast,
    type HourlyPoint,
    type WeatherProvenance
  } from '$lib/weather/leafWet';
  import { currentPrefs, fmt } from '$lib/prefsState.svelte';

  const { data } = $props();

  interface WeatherState {
    hours: HourlyPoint[];
    provenance: WeatherProvenance;
    observedLabel: string | null;
  }

  interface FeedBody {
    hours?: HourlyPoint[];
    provenance?: string;
    station?: { label?: string } | null;
  }

  const OBSERVED_MAX_SPAN_MS = 400 * 24 * 60 * 60 * 1000;

  let weather = $state<WeatherState | null>(null);
  let seq = 0;

  async function getFeed(url: string): Promise<FeedBody | null> {
    try {
      const res = await fetch(url);
      return res.ok ? ((await res.json()) as FeedBody) : null;
    } catch {
      return null;
    }
  }

  function dataHours(body: FeedBody | null): HourlyPoint[] {
    return body?.provenance === 'data' && Array.isArray(body.hours) ? body.hours : [];
  }

  async function loadWeather(blockId: string, plantMs: number | null) {
    const mine = ++seq;
    weather = null;
    let next: WeatherState = { hours: [], provenance: 'fallback', observedLabel: null };
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      const id = encodeURIComponent(blockId);
      const wantObserved =
        plantMs !== null && plantMs < data.nowMs && data.nowMs - plantMs < OBSERVED_MAX_SPAN_MS;
      const [forecast, observed] = await Promise.all([
        getFeed(`/api/weather/hourly?blockId=${id}`),
        wantObserved
          ? getFeed(`/api/weather/observed?blockId=${id}&from=${plantMs}`)
          : Promise.resolve(null)
      ]);
      const obsHours = dataHours(observed);
      const hours = mergeObservedAndForecast(obsHours, dataHours(forecast), data.nowMs);
      next = {
        hours,
        provenance: hours.length > 0 ? 'data' : 'fallback',
        observedLabel: obsHours.length > 0 ? (observed?.station?.label ?? null) : null
      };
    }
    if (mine === seq) weather = next;
  }

  $effect(() => {
    const c = data.plan?.candidate;
    if (c) void loadWeather(c.blockId, c.plantingDate);
  });

  const plan = $derived(data.plan);
  const hours = $derived(weather?.hours ?? []);
  const provenance = $derived<WeatherProvenance>(weather?.provenance ?? 'fallback');

  const fhb = $derived(
    assessFhbRisk({
      anthesisMs: plan?.anthesisMs ?? null,
      hours,
      provenance,
      nowMs: data.nowMs
    })
  );
  const daily = $derived(
    provenance === 'data' ? dailyScabFavorableHours(hours, currentPrefs().timeZone) : []
  );
  const vern = $derived(
    assessVernalization({
      habit: plan?.habit ?? 'spring',
      plantMs: plan?.candidate.plantingDate ?? null,
      nowMs: data.nowMs,
      hours,
      provenance
    })
  );

  function fmtDate(ms: number | null, year = false): string {
    if (ms === null) return '—';
    return fmt.day(ms, year ? 'date' : 'month-day');
  }

  const harvestStage = $derived(plan?.stages.find((s) => s.decision === 'harvest') ?? null);
</script>

<svelte:head><title>Small-grain plan · CropCard</title></svelte:head>

<div class="page">
  <a class="back" href="/plan"><ArrowLeft size={16} strokeWidth={1.75} /> Plan</a>

  {#if !plan}
    <section class="empty" data-testid="small-grain-empty">
      <Wheat size={28} strokeWidth={1.5} aria-hidden="true" />
      <h1 class="serif">No small-grain plantings</h1>
      <p>
        Add a wheat, barley, rye, oat or other small-grain planting on the Plan page to see its
        Zadoks timeline, scab risk and vernalization progress here.
      </p>
      <a class="btn primary" href="/plan">Open Plan</a>
    </section>
  {:else}
    {@const c = plan.candidate}
    <header class="page-head">
      <div class="kicker">
        {c.blockName}{plan.acres ? ` · ${fmt.qty(plan.acres, 'area')}` : ''} · small grain ·
        {plan.habit} habit · stage scale: Zadoks
      </div>
      <h1 class="serif">{c.displayName}</h1>
      <p class="lede">
        {c.varietyDisplayName} · planted {fmtDate(c.plantingDate, true)}
        {#if harvestStage}· harvest target ~{fmtDate(harvestStage.startMs, true)} ({harvestStage.code}){/if}
      </p>
      <div class="actions">
        {#if data.canRecord}
          <a class="btn primary" href="/harvest?planting={encodeURIComponent(c.plantingId)}"
            >Record harvest</a
          >
          <a class="btn ghost" href="/spray/fungicide?crop={encodeURIComponent(c.plantingId)}"
            >Record fungicide</a
          >
        {/if}
      </div>
    </header>

    {#if data.candidates.length > 1}
      <nav class="switcher" aria-label="Small-grain plantings">
        {#each data.candidates as o (o.plantingId)}
          <a
            href="/plan/wheat?planting={encodeURIComponent(o.plantingId)}"
            aria-current={o.plantingId === c.plantingId ? 'page' : undefined}
          >
            <span class="sw-name">{o.displayName}</span>
            <span class="sw-meta">{o.blockName} · {fmtDate(o.plantingDate)}</span>
          </a>
        {/each}
      </nav>
    {/if}

    {#if c.plantingDate === null}
      <p class="notice" role="status">
        This planting has no sowing date yet — set one on the Plan page to project stages, flowering
        and vernalization.
      </p>
    {:else}
      <ZadoksTimeline stages={plan.stages} currentIndex={plan.currentIndex} nowMs={data.nowMs} />
    {/if}

    <div class="grid">
      <FhbRiskPanel
        assessment={fhb}
        {daily}
        nowMs={data.nowMs}
        loading={weather === null && plan.anthesisMs !== null}
        fungicides={plan.fungicides}
        observedLabel={weather?.observedLabel ?? null}
      />
      <VernalizationPanel assessment={vern} observedLabel={weather?.observedLabel ?? null} />
    </div>
  {/if}
</div>

<style>
  .page {
    max-width: 1180px;
    margin: 0 auto;
    padding: 16px 16px 40px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 48px;
    align-self: flex-start;
    color: var(--color-forest-deep);
    font-weight: 600;
    text-decoration: none;
  }
  .kicker {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }
  h1 {
    margin: 6px 0 0;
    font-size: 1.8rem;
    line-height: 1.1;
    color: var(--color-forest-deep);
    letter-spacing: -0.02em;
  }
  .lede {
    margin: 4px 0 0;
    font-size: 0.88rem;
    color: var(--color-ink-soft);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 18px;
    border-radius: 8px;
    font-weight: 600;
    text-decoration: none;
    border: 1px solid var(--color-divider);
  }
  .btn.primary {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: var(--color-cream);
  }
  .btn.ghost {
    background: var(--color-paper);
    color: var(--color-forest-deep);
  }
  .switcher {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .switcher a {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 48px;
    padding: 6px 12px;
    border: 1px solid var(--color-divider);
    border-radius: 8px;
    background: var(--color-paper);
    color: var(--color-ink);
    text-decoration: none;
    flex: 0 0 auto;
  }
  .switcher a[aria-current='page'] {
    border-color: var(--color-forest);
    box-shadow: inset 0 0 0 1px var(--color-forest);
  }
  .sw-name {
    font-weight: 600;
    font-size: 0.85rem;
  }
  .sw-meta {
    font-size: 0.75rem;
    color: var(--color-ink-soft);
  }
  .notice {
    margin: 0;
    padding: 12px 14px;
    background: var(--color-cream);
    border-left: 3px solid var(--color-wheat);
    border-radius: 4px;
    color: var(--color-ink);
  }
  .grid {
    display: grid;
    gap: 14px;
    min-width: 0;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 24px 18px;
    background: var(--color-paper);
    border: 1px dashed var(--color-divider);
    border-radius: 10px;
    color: var(--color-ink-soft);
  }
  .empty p {
    margin: 0;
    max-width: 60ch;
  }
  @media (min-width: 900px) {
    .page {
      padding: 24px 28px 40px;
    }
    h1 {
      font-size: 2rem;
    }
    .grid {
      grid-template-columns: 1.5fr 1fr;
    }
  }
</style>
