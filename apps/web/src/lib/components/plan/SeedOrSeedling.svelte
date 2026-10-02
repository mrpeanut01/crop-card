<script lang="ts">
  /**
   * Phase 32E (E1-1, E1-2, E1-5). "Seed or seedling?" for the planting form,
   * the designer and the planning wizard. Seed writes `direct-seed`;
   * Seedling writes `transplant` and asks whether the grower starts the
   * seed indoors (checked by default). Nothing picked leaves the planting
   * as it behaves today.
   */
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import {
    preselectedEstablishment,
    resolveSeedStartTiming,
    type Establishment,
    type SeedStartPluginSlice
  } from '$lib/schedule/seedStart';

  interface Props {
    plugin: SeedStartPluginSlice | null;
    /** True when the planting has an in-ground date. */
    dated: boolean;
    establishment?: Establishment | null;
    startIndoors?: boolean;
    /** `YYYY-MM-DD`, only when the crop's indoor timing is not known. */
    sowIndoorsOn?: string;
    /** `YYYY-MM-DD` in-ground date, when known: the sow date must come before it. */
    inGroundOn?: string;
    idPrefix?: string;
    compact?: boolean;
  }

  let {
    plugin,
    dated,
    establishment = $bindable(null),
    startIndoors = $bindable(true),
    sowIndoorsOn = $bindable(''),
    inGroundOn = '',
    idPrefix = 'sos',
    compact = false
  }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  const preselect = $derived(preselectedEstablishment(plugin ?? undefined));
  let touched = $state(false);
  let lastPlugin: SeedStartPluginSlice | null | undefined = undefined;

  $effect(() => {
    if (plugin === lastPlugin) return;
    lastPlugin = plugin;
    touched = false;
    establishment = preselect;
    startIndoors = true;
    sowIndoorsOn = '';
  });

  const timing = $derived(plugin ? resolveSeedStartTiming(plugin) : null);
  const sowKnown = $derived(!!timing?.startIndoorsWeeks);
  const sowMax = $derived.by(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(inGroundOn);
    if (!m) return undefined;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1));
    return d.toISOString().slice(0, 10);
  });
  const sowTooLate = $derived(!!sowIndoorsOn && !!inGroundOn && sowIndoorsOn >= inGroundOn);

  function pick(value: Establishment) {
    touched = true;
    establishment = establishment === value ? null : value;
  }

  function weeks(w: { min: number; max: number }) {
    return w.min === w.max
      ? tr('planui.sos.weeksSame', { min: w.min })
      : tr('planui.sos.weeksRange', { min: w.min, max: w.max });
  }
</script>

<fieldset class="sos" class:compact data-testid="seed-or-seedling">
  <legend class="label">{tr('planui.sos.title')}</legend>
  <div class="choices" role="group" aria-label={tr('planui.sos.title')}>
    <button
      type="button"
      class="chip"
      aria-pressed={establishment === 'direct-seed'}
      onclick={() => pick('direct-seed')}>{tr('planui.sos.seed')}</button
    >
    <button
      type="button"
      class="chip"
      aria-pressed={establishment === 'transplant'}
      onclick={() => pick('transplant')}>{tr('planui.sos.seedling')}</button
    >
    {#if establishment}
      <Provenance source={touched || establishment !== preselect ? 'manual' : 'plugin'} compact />
    {/if}
  </div>

  {#if establishment === 'transplant'}
    <label class="check">
      <input type="checkbox" bind:checked={startIndoors} />
      <span>{tr('planui.sos.startIndoors')}</span>
    </label>
    {#if startIndoors}
      {#if timing?.startIndoorsWeeks}
        <p class="hint">
          {tr('planui.sos.sowBefore', { weeks: weeks(timing.startIndoorsWeeks) })}
          <Provenance source={timing.startIndoorsWeeks.source} compact />
        </p>
      {:else}
        <p class="hint" data-testid="sow-timing-unknown">{tr('sched.sowTimingUnknown')}</p>
        <label class="field">
          <span class="label">{tr('planui.sos.sowOn')}</span>
          <input
            id="{idPrefix}-sow-on"
            type="date"
            max={sowMax}
            bind:value={sowIndoorsOn}
            aria-invalid={sowTooLate || undefined}
          />
        </label>
        {#if sowTooLate}
          <p class="hint warn" role="alert" data-testid="sow-after-transplant">
            {tr('sched.sowAfterTransplant')}
          </p>
        {/if}
      {/if}
      {#if !dated}
        <p class="hint">{tr('planui.sos.needDate')}</p>
      {:else if sowKnown || sowIndoorsOn}
        <p class="hint">{tr('planui.sos.tasksGo')}</p>
      {/if}
    {:else}
      <p class="hint">{tr('planui.sos.noIndoor')}</p>
    {/if}
  {:else if establishment === 'direct-seed' && plugin?.plantingGuide?.dtmFrom === 'transplant'}
    <p class="hint">{tr('sched.dtmFromTransplant')}</p>
  {/if}
</fieldset>

<style>
  .sos {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    min-width: 0;
  }
  .label {
    font-weight: 600;
    font-size: var(--font-size-caption, 0.875rem);
    color: var(--color-ink, inherit);
    padding: 0;
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2, 8px);
  }
  .chip {
    min-height: 48px;
    min-width: 96px;
    padding: 0 var(--space-4, 16px);
    border-radius: var(--radius-input, 8px);
    border: 1px solid var(--color-rule, #ccc);
    background: var(--color-paper, #fff);
    color: var(--color-ink, #222);
    font-size: var(--font-size-body, 1rem);
    font-weight: 600;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] {
    background: var(--color-forest, #2f5d3a);
    border-color: var(--color-forest, #2f5d3a);
    color: var(--color-paper, #fff);
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    min-height: 48px;
    cursor: pointer;
  }
  .check input {
    width: 24px;
    height: 24px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field input {
    min-height: 48px;
    max-width: 100%;
  }
  .hint {
    margin: 0;
    font-size: var(--font-size-caption, 0.875rem);
    color: var(--color-ink-soft, #555);
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .hint.warn {
    color: var(--color-rust, #9a3b1b);
    font-weight: 600;
  }
  .compact .chip {
    min-width: 80px;
  }
</style>
