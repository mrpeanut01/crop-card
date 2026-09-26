<script lang="ts">
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { currentPrefs } from '$lib/prefsState.svelte';
  import type { BloomStatus, PollinatorProtectionResult } from '$lib/safety/pollinatorProtection';
  import { formatDistance, type NearbyPollinatorAdvisory } from '$lib/pollinator/nearbyBlocks';

  interface Props {
    result: PollinatorProtectionResult;
    bloomStatus: BloomStatus;
    attestedNoForagers: boolean;
    /** Crop plugins whose bloom window covers today (prefill source). */
    bloomingCrops: string[];
    /** True when every selected product carries label pollinator data. */
    hasPluginData: boolean;
    sunsetLabel: string | null;
    sunriseLabel: string | null;
    /** Advisory only — other blocks in foraging range; never blocks. */
    nearby?: NearbyPollinatorAdvisory;
  }

  let {
    result,
    bloomStatus = $bindable(),
    attestedNoForagers = $bindable(),
    bloomingCrops,
    hasPluginData,
    sunsetLabel,
    sunriseLabel,
    nearby
  }: Props = $props();

  const needsForagerAttestation = $derived(
    result.checks.some((c) => c.id === 'time-of-day' && c.status !== 'pass') &&
      sunsetLabel === null &&
      result.effective.bloomRestriction === 'dusk-to-dawn-only'
  );

  const pillLabel = $derived(
    result.overall === 'block' ? 'Blocked' : result.overall === 'warn' ? 'Caution' : 'Clear'
  );
</script>

<header class="gate-header">
  <h2>Pollinator-protection gate</h2>
  <span class="pill pill-{result.overall}" data-testid="pollinator-overall">{pillLabel}</span>
  <Provenance
    source={hasPluginData ? 'plugin' : 'fallback'}
    detail={hasPluginData ? 'label bee toxicity' : 'no label data · treated as unknown'}
    compact
  />
  {#if sunsetLabel}
    <Provenance source="data" detail="NOAA sunrise/sunset" compact />
  {/if}
</header>

<fieldset class="bloom">
  <legend>Is the crop or any flowering weed in bloom in this block?</legend>
  {#if bloomingCrops.length > 0}
    <p class="hint">
      <Provenance source="plugin" detail="crop bloom window" compact />
      Expected in bloom today: {bloomingCrops.join(', ')}.
    </p>
  {:else}
    <p class="hint">
      Crop bloom windows show no bloom today — check field edges for flowering weeds.
    </p>
  {/if}
  <div class="radios">
    <label class="radio" class:checked={bloomStatus === 'in-bloom'}>
      <input type="radio" name="bloom-status" value="in-bloom" bind:group={bloomStatus} />
      Yes — flowers open
    </label>
    <label class="radio" class:checked={bloomStatus === 'not-in-bloom'}>
      <input type="radio" name="bloom-status" value="not-in-bloom" bind:group={bloomStatus} />
      No bloom
    </label>
  </div>
  {#if needsForagerAttestation}
    <label class="radio attest">
      <input type="checkbox" bind:checked={attestedNoForagers} />
      No bees are foraging in the block right now
    </label>
  {/if}
  {#if sunsetLabel && sunriseLabel}
    <p class="sun mono">Sunset {sunsetLabel} · sunrise {sunriseLabel}</p>
  {/if}
</fieldset>

<ul class="tiles">
  {#each result.checks as c (c.id)}
    <li
      class="tile tile-{c.status}"
      data-testid="pollinator-check-{c.id}"
      data-status={c.status}
      role={c.status === 'block' ? 'alert' : undefined}
    >
      <span class="icon" aria-hidden="true"
        >{c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✕'}</span
      >
      <div>
        <div class="tile-label">
          {c.label}
          <span class="sr-only">— {c.status}</span>
        </div>
        <div class="tile-reason">{c.reason}</div>
      </div>
    </li>
  {/each}
  {#if nearby}
    <li
      class="tile tile-{nearby.status} tile-wide"
      data-testid="pollinator-check-nearby-blocks"
      data-status={nearby.status}
    >
      <span class="icon" aria-hidden="true">{nearby.status === 'pass' ? '✓' : '!'}</span>
      <div class="nearby-body">
        <div class="tile-label">
          {nearby.label} · within {formatDistance(nearby.radiusFt, currentPrefs())}
          <span class="sr-only">— {nearby.status}</span>
          <Provenance source="plugin" detail="crop bloom window" compact />
          <Provenance source="data" detail="block geometry" compact />
        </div>
        <div class="tile-reason">{nearby.reason}</div>
        {#if nearby.blocks.length > 0 || nearby.unknownDistance.length > 0}
          <ul class="nearby-list">
            {#each [...nearby.blocks, ...nearby.unknownDistance] as b (b.blockId)}
              <li class="nearby-row" data-testid="nearby-block-{b.blockId}">
                <span class="nearby-name">{b.name}</span>
                <span class="mono nearby-dist">{formatDistance(b.distanceFt, currentPrefs())}</span>
                <span class="nearby-why">
                  {b.reason === 'in-bloom' ? 'in bloom' : 'bee-attractive'} · {b.crops.join(', ')}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </li>
  {/if}
</ul>

<style>
  .gate-header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 0.5rem;
  }
  .gate-header h2 {
    margin: 0 0.25rem 0 0;
  }
  .pill {
    display: inline-flex;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border: 1px solid;
  }
  .pill-pass {
    background: var(--pill-forest-bg);
    color: var(--pill-forest-fg);
    border-color: var(--pill-forest-bd);
  }
  .pill-warn {
    background: var(--pill-wheat-bg);
    color: var(--pill-wheat-fg);
    border-color: var(--pill-wheat-bd);
  }
  .pill-block {
    background: var(--pill-rust-bg);
    color: var(--pill-rust-fg);
    border-color: var(--pill-rust-bd, #e2b69e);
  }
  .bloom {
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    padding: 0.75rem 1rem;
    margin: 0.5rem 0 0.75rem;
  }
  .bloom legend {
    font-weight: 600;
    padding: 0 0.25rem;
  }
  .hint,
  .sun {
    margin: 0.25rem 0 0.5rem;
    font-size: 0.85rem;
    color: var(--color-ink-soft);
  }
  .radios {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .radio {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 0 16px;
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    background: var(--color-paper, #fff);
    cursor: pointer;
    font-size: 1rem;
  }
  .radio.checked {
    border-color: var(--color-forest);
    box-shadow: inset 0 0 0 1px var(--color-forest);
  }
  .radio input {
    width: 22px;
    height: 22px;
    min-height: 0;
    margin: 0;
  }
  .attest {
    margin-top: 8px;
  }
  .tiles {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }
  .tile {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid;
    min-height: 48px;
  }
  .tile-pass {
    background: #eff6e9;
    border-color: #c9dbc0;
  }
  .tile-warn {
    background: var(--pill-wheat-bg);
    border-color: var(--pill-wheat-bd);
  }
  .tile-block {
    background: #fbe4d2;
    border-color: #e2b69e;
  }
  .icon {
    font-weight: 700;
    width: 18px;
    text-align: center;
  }
  .tile-pass .icon {
    color: var(--color-forest);
  }
  .tile-warn .icon {
    color: var(--pill-wheat-fg);
  }
  .tile-block .icon {
    color: var(--color-rust);
  }
  .tile-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-ink);
  }
  .tile-reason {
    font-size: 0.8rem;
    color: var(--color-ink-soft);
    margin-top: 2px;
    line-height: 1.4;
  }
  .tile-wide {
    grid-column: 1 / -1;
  }
  .nearby-body {
    flex: 1;
    min-width: 0;
  }
  .nearby-list {
    list-style: none;
    padding: 0;
    margin: 6px 0 0;
  }
  .nearby-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    min-height: 48px;
    border-top: 1px solid var(--color-divider);
    font-size: 0.85rem;
    color: var(--color-ink);
  }
  .nearby-name {
    font-weight: 600;
  }
  .nearby-dist {
    color: var(--color-ink);
  }
  .nearby-why {
    color: var(--color-ink-soft);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
