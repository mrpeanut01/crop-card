<script lang="ts">
  import { fmt } from '$lib/prefsState.svelte';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Banner from '$lib/components/ui/Banner.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import type { Snippet } from 'svelte';

  /** Shared header pattern across the three spray-decision pages:
   *   1. kicker + serif H1 + lede
   *   2. gate-slot row of "Phase 25d" / "Phase 26" pills indicating which
   *      kernel gates will fire on this chemistry
   *   3. active-REI Banner when any block is in re-entry lockout
   *
   * Consumers pass:
   *   - chemistry: 'herbicide' | 'insecticide' | 'fungicide' (drives kicker copy
   *     + the default gate-slot pill list)
   *   - title (overrideable, defaults per chemistry)
   *   - lede (overrideable, defaults per chemistry)
   *   - activeREI[] for the lockout banner
   *
   * A `gates` snippet lets a page swap in custom gate pills (e.g.,
   * /spray/fungicide adds a "Disease forecast" pill on top of the
   * default FRAC + rain/dew pair).
   */

  type Chemistry = 'herbicide' | 'insecticide' | 'fungicide';

  interface ActiveREI {
    id: string;
    blockId: string;
    reEntryClearAt?: number | null;
  }

  interface Props {
    chemistry: Chemistry;
    title?: string;
    lede?: string;
    activeREI?: ActiveREI[];
    /** Override the default gate-slot pills entirely. */
    gates?: Snippet;
  }

  const { chemistry, title, lede, activeREI = [], gates }: Props = $props();

  const tr = $derived(createT(page.data?.locale));
  const kickerText = $derived(tr(`sprayui.header.kicker.${chemistry}`));
  const titleText = $derived(title ?? tr(`sprayui.header.title.${chemistry}`));
  const ledeText = $derived(lede ?? tr(`sprayui.header.lede.${chemistry}`));
</script>

<svelte:head><title>{tr('sprayui.pageTitle', { title: titleText })}</title></svelte:head>

<header class="page-header">
  <Kicker>{kickerText}</Kicker>
  <h1 class="serif">{titleText}</h1>
  <p class="lede">{ledeText}</p>
</header>

<div class="gate-slot">
  {#if gates}
    {@render gates()}
  {:else if chemistry === 'herbicide'}
    <Pill tone="forest">{tr('sprayui.header.gate.ipm')}</Pill>
    <Pill tone="forest">{tr('sprayui.header.gate.pollinator')}</Pill>
  {:else if chemistry === 'insecticide'}
    <Pill tone="forest">{tr('sprayui.header.gate.ipm')}</Pill>
    <Pill tone="forest">{tr('sprayui.header.gate.pollinator')}</Pill>
  {:else if chemistry === 'fungicide'}
    <Pill tone="forest">{tr('sprayui.header.gate.frac')}</Pill>
    <Pill tone="sky">{tr('sprayui.header.gate.dryWindow')}</Pill>
    <Pill tone="neutral">{tr('sprayui.header.gate.forecast')}</Pill>
  {/if}
</div>

{#if activeREI.length > 0}
  <div lang="en" data-english-only="safety">
    <Banner tone="wheat">
      <strong>Active {chemistry} re-entry intervals:</strong>
      <ul class="rei-list">
        {#each activeREI as e (e.id)}
          <li>
            Block {e.blockId} — re-entry clear {fmt.instant(e.reEntryClearAt ?? 0)}
          </li>
        {/each}
      </ul>
    </Banner>
  </div>
{/if}

<style>
  .page-header {
    margin-bottom: 1.25rem;
  }
  .page-header .lede {
    color: var(--color-ink-soft);
    margin-top: 0.5rem;
  }
  .gate-slot {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 0 1rem;
  }
  .rei-list {
    margin: 0.4rem 0 0 1.25rem;
    padding: 0;
  }
</style>
