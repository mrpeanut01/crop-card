<script lang="ts">
  import { evaluateScout, type ScoutSpot } from '$lib/safety/scout';

  let { data } = $props();

  let selectedBlockId = $state(data.preselectedBlockId ?? data.blocks[0]?.id ?? '');

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

<h1>Scout & spray decision</h1>
<p class="lede">
  Walk the block, count broadleaves in 4–5 random 10 sq ft spots, and note the tallest weed. The
  threshold (FR-07): ≥ 3 weeds / 10 sq ft on average, or any weed taller than 2 inches → spray.
</p>

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
  <h2>Tallest weed observed (inches)</h2>
  <input type="number" min="0" step="0.5" bind:value={maxHeight} placeholder="e.g. 1.5" />
  <small>Leave blank if you didn't measure.</small>
</section>

<section class="result {result.decision === 'SPRAY' ? 'spray' : 'skip'}">
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
    color: #1f5e3a;
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
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1.1rem;
    min-height: 48px;
  }
  .remove {
    background: #fce8e8;
    color: #b00020;
    border: none;
    width: 48px;
    height: 48px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1.1rem;
  }
  button {
    background: white;
    color: #1f5e3a;
    border: 2px solid #1f5e3a;
    border-radius: 6px;
    padding: 0.6rem 1rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  .card input[type='number'] {
    padding: 0.6rem;
    border: 2px solid #d0d7d0;
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
    background: #fce8e8;
    border: 2px solid #b00020;
  }
  .result.spray h2 {
    color: #b00020;
  }
  .result.skip {
    background: #e7f1ea;
    border: 2px solid #1f5e3a;
  }
  .result.skip h2 {
    color: #1f5e3a;
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
    background: #1f5e3a;
    color: white;
    padding: 0.9rem 1.5rem;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
    min-height: 48px;
    line-height: 1.4;
  }
</style>
