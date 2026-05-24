<script lang="ts">
  import { evaluateScout, type ScoutSpot } from '$lib/safety/scout';
  import { untrack } from 'svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Banner from '$lib/components/ui/Banner.svelte';

  let { data } = $props();

  let selectedBlockId = $state(untrack(() => data.preselectedBlockId ?? data.blocks[0]?.id ?? ''));

  let spots = $state<ScoutSpot[]>([
    { weedsPer10SqFt: 0 },
    { weedsPer10SqFt: 0 },
    { weedsPer10SqFt: 0 },
    { weedsPer10SqFt: 0 }
  ]);
  let maxHeight = $state<number | undefined>(undefined);

  const result = $derived(evaluateScout({ spots, maxWeedHeightInches: maxHeight }));
  const selectedBlock = $derived(data.blocks.find((b) => b.id === selectedBlockId));

  const planSprayHref = $derived.by(() => {
    const params = new URLSearchParams();
    if (selectedBlockId) params.set('block', selectedBlockId);
    if (data.windowStage) params.set('windowStage', data.windowStage);
    params.set('fromScout', '1');
    return `/spray?${params.toString()}`;
  });

  function addSpot() {
    spots = [...spots, { weedsPer10SqFt: 0 }];
  }
  function removeSpot(i: number) {
    spots = spots.filter((_, idx) => idx !== i);
  }
</script>

<header class="page-header">
  <Kicker>FR-07 · Threshold-driven scouting</Kicker>
  <h1 class="serif">Scout &amp; spray decision</h1>
  <p class="lede">
    Walk the block, count broadleaves in 4–5 random 10 sq ft spots, and note the tallest weed. The
    threshold: ≥ 3 weeds / 10 sq ft on average, or any weed taller than 2 inches → spray.
  </p>
</header>

{#if data.blocks.length > 0}
  <section class="card">
    <h2>Block</h2>
    <label for="scout-block">Which block are you scouting?</label>
    <select id="scout-block" bind:value={selectedBlockId}>
      {#each data.blocks as b (b.id)}
        <option value={b.id}>{b.name}</option>
      {/each}
    </select>
    {#if data.windowStage}
      <p class="meta">Window: <strong>{data.windowStage}</strong> (from today's calendar)</p>
    {/if}
  </section>
{/if}

<section class="card">
  <h2>Spots</h2>
  {#each spots as _, i (i)}
    <label class="spot">
      Spot {i + 1}: weeds in 10 sq ft
      <input type="number" min="0" step="1" bind:value={spots[i].weedsPer10SqFt} />
      {#if spots.length > 1}
        <button type="button" class="remove" onclick={() => removeSpot(i)}>✕</button>
      {/if}
    </label>
  {/each}
  <button type="button" onclick={addSpot}>+ Add another spot</button>
</section>

<section class="card">
  <h2 id="tallest-weed-label">Tallest weed observed (inches)</h2>
  <input
    id="tallest-weed-input"
    type="number"
    min="0"
    step="0.5"
    bind:value={maxHeight}
    aria-labelledby="tallest-weed-label"
  />
  <small>Leave blank if you didn't measure. Example: 1.5</small>
</section>

<section class="result {result.decision === 'SPRAY' ? 'spray' : 'skip'}" aria-live="polite">
  {#if result.decision === 'SPRAY'}
    <h2>SPRAY</h2>
  {:else}
    <h2>SKIP</h2>
  {/if}
  <p>{result.reason}</p>
  <dl>
    <dt>Spots counted</dt>
    <dd>{result.spotsCounted}</dd>
    <dt>Average / 10 sq ft</dt>
    <dd>{result.averagePer10SqFt.toFixed(2)}</dd>
  </dl>
  {#if result.decision === 'SPRAY'}
    <a href={planSprayHref} class="primary">
      Plan the spray{selectedBlock ? ` for ${selectedBlock.name}` : ''} →
    </a>
  {/if}
</section>

<style>
  h1 {
    margin: 0 0 0.25rem;
  }
  .lede {
    color: #555;
    margin: 0 0 1.5rem;
  }
  .card {
    background: white;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: var(--color-forest);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .spot {
    display: grid;
    grid-template-columns: 1fr 6rem auto;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.4rem;
  }
  .spot input {
    padding: 0.6rem;
    border: 2px solid var(--color-divider);
    border-radius: 4px;
    font-size: 1.1rem;
    min-height: 48px;
  }
  .remove {
    background: var(--pill-rust-bg);
    color: var(--color-rust);
    border: none;
    width: 48px;
    height: 48px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1.1rem;
  }
  button {
    background: white;
    color: var(--color-forest);
    border: 2px solid var(--color-forest);
    border-radius: 6px;
    padding: 0.6rem 1rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  .card input[type='number'] {
    padding: 0.6rem;
    border: 2px solid var(--color-divider);
    border-radius: 4px;
    font-size: 1.1rem;
    min-height: 48px;
    width: 100%;
    box-sizing: border-box;
  }
  .card small {
    color: #555;
    display: block;
    margin-top: 0.4rem;
  }
  .result {
    padding: 1.25rem;
    border-radius: 8px;
    margin-top: 1rem;
  }
  .result.spray {
    background: var(--pill-rust-bg);
    border: 2px solid var(--color-rust);
  }
  .result.spray h2 {
    color: var(--color-rust);
  }
  .result.skip {
    background: var(--pill-forest-bg);
    border: 2px solid var(--color-forest);
  }
  .result.skip h2 {
    color: var(--color-forest);
  }
  .result h2 {
    margin: 0;
    font-size: 1.5rem;
  }
  .result dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.4rem 1rem;
    margin: 1rem 0 0;
  }
  .result dt {
    color: #555;
  }
  .primary {
    display: inline-block;
    margin-top: 1rem;
    background: var(--color-forest);
    color: white;
    padding: 0.9rem 1.5rem;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
    min-height: 48px;
    line-height: 1.4;
  }
</style>
