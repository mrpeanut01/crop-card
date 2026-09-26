<script lang="ts">
  import { Thermometer } from 'lucide-svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import {
    LOUDOUN_AIR_TEMP_NORMALS,
    VERNALIZATION_MAX_F,
    VERNALIZATION_MIN_F,
    type VernalizationAssessment
  } from '$lib/plan/smallGrain';
  import { fmt } from '$lib/prefsState.svelte';

  interface Props {
    assessment: VernalizationAssessment;
    /** Station label when past hours come from NOAA observations. */
    observedLabel?: string | null;
  }

  const { assessment: v, observedLabel = null }: Props = $props();

  const dataDetail = $derived(observedLabel ? `NOAA observed · ${observedLabel}` : 'NWS hourly');

  const W = 240;
  const pct = $derived(Math.round(v.progress * 100));
  const projPct = $derived(Math.round(v.projectedProgress * 100));

  const pill = $derived.by(() => {
    switch (v.status) {
      case 'complete':
        return { tone: 'forest' as const, text: 'Complete' };
      case 'in-progress':
        return { tone: 'sky' as const, text: 'Accumulating' };
      case 'at-risk':
        return { tone: 'rust' as const, text: 'At risk' };
      case 'not-planted':
        return { tone: 'neutral' as const, text: 'Not sown' };
      default:
        return { tone: 'neutral' as const, text: 'Not required' };
    }
  });

  const note = $derived.by(() => {
    if (!v.required) return 'Spring-habit grain flowers without a cold period.';
    if (v.status === 'not-planted') return 'Counting starts at sowing.';
    if (v.springPlanted)
      return 'Winter-habit variety sown in spring may not get enough cold to head. Expect a thin or headless stand.';
    if (v.status === 'complete') return 'Cold requirement met — heads will form.';
    if (v.accumulatedDays < 1)
      return `Cold days start counting once temperatures settle below ${fmt.qty(50, 'temperature')} — typically November in Loudoun County.`;
    if (v.status === 'at-risk')
      return 'Short of the typical requirement this late in spring — scout for heading.';
    return `Winter wheat needs about ${v.requiredDays} days at ${fmt.qty(VERNALIZATION_MIN_F, 'temperature', { bare: true })}–${fmt.qty(VERNALIZATION_MAX_F, 'temperature')} to flower.`;
  });
</script>

<section class="card" aria-labelledby="vern-title" data-testid="vernalization-panel">
  <header class="head">
    <div class="title-row">
      <Thermometer size={16} strokeWidth={1.75} aria-hidden="true" />
      <h2 id="vern-title" class="serif">Vernalization</h2>
      <Pill tone={pill.tone}>{pill.text}</Pill>
    </div>
    {#if v.required && v.status !== 'not-planted'}
      <div class="head-prov">
        <Provenance
          source={v.provenance}
          detail={v.provenance === 'data'
            ? dataDetail
            : observedLabel
              ? 'observed + climatology'
              : 'climatology + forecast'}
        />
      </div>
    {/if}
  </header>

  <div class="body">
    {#if v.required && v.status !== 'not-planted'}
      <div class="count">
        <span class="serif big" data-testid="vern-days">{Math.floor(v.accumulatedDays)}</span>
        <span class="of">/ {v.requiredDays} cold days</span>
      </div>
      <svg
        viewBox="0 0 {W} 14"
        role="img"
        aria-label="Vernalization {pct}% complete{projPct > pct
          ? `, ${projPct}% by end of forecast`
          : ''}"
      >
        <rect x="0" y="2" width={W} height="10" rx="5" class="bg" />
        {#if projPct > pct}
          <rect x="0" y="2" width={(W * projPct) / 100} height="10" rx="5" class="proj" />
        {/if}
        <rect x="0" y="2" width={(W * pct) / 100} height="10" rx="5" class="fill" />
      </svg>
      <div class="split">
        {#if v.climatologyDays > 0}
          <span
            ><Provenance source="fallback" detail="climatology estimate" compact />
            {v.climatologyDays} d</span
          >
        {/if}
        {#if v.dataDays > 0}
          <span
            ><Provenance source="data" detail={dataDetail} compact />
            {v.dataDays} d</span
          >
        {/if}
        {#if v.status !== 'complete' && v.projectedDays > v.accumulatedDays}
          <span class="muted"
            >+{Math.round((v.projectedDays - v.accumulatedDays) * 10) / 10} d in forecast</span
          >
        {/if}
      </div>
    {/if}
    <p class="note">{note}</p>
    {#if v.required && v.climatologyDays > 0}
      <p class="foot">
        {observedLabel
          ? 'Hours missing from the station record are'
          : 'No nearby NOAA station record was available, so past days are'} estimated from {LOUDOUN_AIR_TEMP_NORMALS.label}
        with a ±{fmt.qty(9, 'temperatureDelta')} daily swing. Farms far from Loudoun County will differ.
      </p>
    {/if}
  </div>
</section>

<style>
  .card {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 10px);
    min-width: 0;
  }
  .head {
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  .head-prov {
    margin-top: 6px;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    color: var(--color-sky);
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
    color: var(--color-forest-deep);
  }
  .body {
    padding: 14px 16px;
    display: grid;
    gap: 8px;
  }
  .count {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .big {
    font-size: 1.9rem;
    font-weight: 600;
    color: var(--color-forest-deep);
  }
  .of {
    font-size: 0.82rem;
    color: var(--color-ink-soft);
  }
  svg {
    width: 100%;
    max-width: 360px;
    height: auto;
  }
  .bg {
    fill: var(--color-cream);
    stroke: var(--color-divider);
  }
  .proj {
    fill: var(--color-wheat-soft, #e8d9b5);
  }
  .fill {
    fill: var(--color-forest);
  }
  .split {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    font-size: 0.78rem;
    color: var(--color-ink-soft);
    align-items: center;
  }
  .split span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .muted {
    color: var(--color-ink-muted);
  }
  .note {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.45;
    color: var(--color-ink-soft);
  }
  .foot {
    margin: 0;
    font-size: 0.72rem;
    line-height: 1.4;
    color: var(--color-ink-muted);
  }
</style>
