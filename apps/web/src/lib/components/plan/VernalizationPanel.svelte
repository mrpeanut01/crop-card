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
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface Props {
    assessment: VernalizationAssessment;
    /** Station label when past hours come from NOAA observations. */
    observedLabel?: string | null;
  }

  const { assessment: v, observedLabel = null }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  const dataDetail = $derived(
    observedLabel
      ? tr('planui.vern.obsDetail', { label: observedLabel })
      : tr('planui.vern.nwsHourly')
  );

  const W = 240;
  const pct = $derived(Math.round(v.progress * 100));
  const projPct = $derived(Math.round(v.projectedProgress * 100));

  const pill = $derived.by(() => {
    switch (v.status) {
      case 'complete':
        return { tone: 'forest' as const, text: tr('planui.vern.complete') };
      case 'in-progress':
        return { tone: 'sky' as const, text: tr('planui.vern.accumulating') };
      case 'at-risk':
        return { tone: 'rust' as const, text: tr('planui.vern.atRisk') };
      case 'not-planted':
        return { tone: 'neutral' as const, text: tr('planui.vern.notSown') };
      default:
        return { tone: 'neutral' as const, text: tr('planui.vern.notRequired') };
    }
  });

  const note = $derived.by(() => {
    if (!v.required) return tr('planui.vern.noteSpring');
    if (v.status === 'not-planted') return tr('planui.vern.noteCounting');
    if (v.springPlanted) return tr('planui.vern.noteSpringPlanted');
    if (v.status === 'complete') return tr('planui.vern.noteMet');
    if (v.accumulatedDays < 1)
      return tr('planui.vern.noteStart', { temp: fmt.qty(50, 'temperature') });
    if (v.status === 'at-risk') return tr('planui.vern.noteShort');
    return tr('planui.vern.noteNeeds', {
      days: v.requiredDays,
      min: fmt.qty(VERNALIZATION_MIN_F, 'temperature', { bare: true }),
      max: fmt.qty(VERNALIZATION_MAX_F, 'temperature')
    });
  });
</script>

<section class="card" aria-labelledby="vern-title" data-testid="vernalization-panel">
  <header class="head">
    <div class="title-row">
      <Thermometer size={16} strokeWidth={1.75} aria-hidden="true" />
      <h2 id="vern-title" class="serif">{tr('planui.vern.title')}</h2>
      <Pill tone={pill.tone}>{pill.text}</Pill>
    </div>
    {#if v.required && v.status !== 'not-planted'}
      <div class="head-prov">
        <Provenance
          source={v.provenance}
          detail={v.provenance === 'data'
            ? dataDetail
            : observedLabel
              ? tr('planui.vern.obsClim')
              : tr('planui.vern.climForecast')}
        />
      </div>
    {/if}
  </header>

  <div class="body">
    {#if v.required && v.status !== 'not-planted'}
      <div class="count">
        <span class="serif big" data-testid="vern-days">{Math.floor(v.accumulatedDays)}</span>
        <span class="of">{tr('planui.vern.cold', { n: v.requiredDays })}</span>
      </div>
      <svg
        viewBox="0 0 {W} 14"
        role="img"
        aria-label={tr('planui.vern.aria', { pct }) +
          (projPct > pct ? tr('planui.vern.ariaProj', { proj: projPct }) : '')}
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
            ><Provenance source="fallback" detail={tr('planui.vern.climEstimate')} compact />
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
            >{tr('planui.vern.inForecast', {
              n: Math.round((v.projectedDays - v.accumulatedDays) * 10) / 10
            })}</span
          >
        {/if}
      </div>
    {/if}
    <p class="note">{note}</p>
    {#if v.required && v.climatologyDays > 0}
      <p class="foot">
        {tr(observedLabel ? 'planui.vern.footObserved' : 'planui.vern.footNoStation', {
          label: LOUDOUN_AIR_TEMP_NORMALS.label,
          swing: fmt.qty(9, 'temperatureDelta')
        })}
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
