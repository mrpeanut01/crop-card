<script lang="ts">
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

  const KICKER: Record<Chemistry, string> = {
    herbicide: 'Spray · Herbicide · Kernel-gated',
    insecticide: 'IPM · IRAC-grouped library',
    fungicide: 'Spray · FRAC-rotated · Phase 25d gate stub'
  };

  const DEFAULT_TITLE: Record<Chemistry, string> = {
    herbicide: 'Plan a spray',
    insecticide: 'Insecticides',
    fungicide: 'Fungicide application'
  };

  const DEFAULT_LEDE: Record<Chemistry, string> = {
    herbicide:
      'Pick a block, herbicide(s), sprayer, and conditions. The safety kernel decides whether the dilution table renders or you get a STOP card.',
    insecticide:
      "The kernel enforces environmental gates + REI / PHI; safety rules for crop tolerance live in the herbicide kill matrix and don't apply to insecticides.",
    fungicide:
      'Records an immutable fungicide event with REI / PHI lockouts. FRAC code rotation hints help prevent resistance — avoid two consecutive sprays sharing the same code on the same block.'
  };

  const kickerText = $derived(KICKER[chemistry]);
  const titleText = $derived(title ?? DEFAULT_TITLE[chemistry]);
  const ledeText = $derived(lede ?? DEFAULT_LEDE[chemistry]);
</script>

<header class="page-header">
  <Kicker>{kickerText}</Kicker>
  <h1 class="serif">{titleText}</h1>
  <p class="lede">{ledeText}</p>
</header>

<div class="gate-slot">
  {#if gates}
    {@render gates()}
  {:else if chemistry === 'herbicide'}
    <Pill tone="sky">IPM threshold gate — Phase 25d</Pill>
    <Pill tone="sky">Pollinator-bloom gate — Phase 25d</Pill>
  {:else if chemistry === 'insecticide'}
    <Pill tone="sky">IPM threshold gate — Phase 25d</Pill>
    <Pill tone="sky">Pollinator-bloom gate — Phase 25d</Pill>
  {:else if chemistry === 'fungicide'}
    <Pill tone="sky">FRAC rotation evaluator — Phase 25d</Pill>
    <Pill tone="sky">Disease forecast (NEWA / FHB) — Phase 26</Pill>
    <Pill tone="sky">Rain/dew dry-hours gate — Phase 25d</Pill>
  {/if}
</div>

{#if activeREI.length > 0}
  <Banner tone="wheat">
    <strong>Active {chemistry} re-entry intervals:</strong>
    <ul class="rei-list">
      {#each activeREI as e (e.id)}
        <li>
          Block {e.blockId} — re-entry clear {new Date(e.reEntryClearAt ?? 0).toLocaleString()}
        </li>
      {/each}
    </ul>
  </Banner>
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
