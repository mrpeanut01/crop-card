<script lang="ts">
  import type { Snippet } from 'svelte';
  import SprayPageHeader from './SprayPageHeader.svelte';
  import Banner from '$lib/components/ui/Banner.svelte';
  import Button from '$lib/components/ui/Button.svelte';

  /** Shell shared by `/spray/insecticide` + `/spray/fungicide`. Owns the
   *  header, block selector, conditions, submit, banner stack, and the
   *  outer card layout; chemistry-specific bits (product picker, scout
   *  vs disease observation, recent-events row format) come in as
   *  snippets.
   *
   *  Herbicide (`/spray`) is NOT consumed by this shell — its review-
   *  then-record flow with multi-block tank-mix calculator and STOP
   *  card is a different UX. See gh #83 for the herbicide deferral.
   */

  type Chemistry = 'herbicide' | 'insecticide' | 'fungicide';

  interface BlockOption {
    id: string;
    name: string;
    acres?: number | null;
  }
  interface ActiveREI {
    id: string;
    blockId: string;
    reEntryClearAt?: number | null;
  }
  interface Violation {
    code: string;
    message: string;
    detail?: Record<string, unknown>;
  }

  interface Props {
    chemistry: Chemistry;
    title?: string;
    lede?: string;
    blocks: BlockOption[];
    activeREI: ActiveREI[];

    /** Conditions + block — bindable so the parent owns $state. */
    blockId: string;
    windMph: number;
    tempF: number;
    rainPct: number;
    tankSize: number | null;

    busy: boolean;
    result: string | null;
    error: string | null;
    violations?: Violation[];
    warnings?: string[];

    canSubmit: boolean;
    submitLabel: string;
    onSubmit: (ev: Event) => void | Promise<void>;

    /** Optional override for header gate pills. */
    gates?: Snippet;
    /** Chemistry-specific product picker rendered inside card 1. */
    productSection: Snippet;
    /** Optional scout/disease observation panel. */
    observation?: Snippet;
    /** Optional recent-events list (rendered below the banner stack). */
    recentEvents?: Snippet;
  }

  let {
    chemistry,
    title,
    lede,
    blocks,
    activeREI,
    blockId = $bindable(),
    windMph = $bindable(),
    tempF = $bindable(),
    rainPct = $bindable(),
    tankSize = $bindable(),
    busy,
    result,
    error,
    violations = [],
    warnings = [],
    canSubmit,
    submitLabel,
    onSubmit,
    gates,
    productSection,
    observation,
    recentEvents
  }: Props = $props();

  const blockFieldId = $derived(`${chemistry}-block`);
  const windFieldId = $derived(`${chemistry}-wind`);
  const tempFieldId = $derived(`${chemistry}-temp`);
  const rainFieldId = $derived(`${chemistry}-rain`);
  const tankFieldId = $derived(`${chemistry}-tank`);
  const conditionsHeading = $derived(observation ? '3 · Conditions' : '2 · Conditions');
</script>

<SprayPageHeader {chemistry} {title} {lede} {activeREI} {gates} />

<form onsubmit={onSubmit}>
  <section class="card">
    <h2>1 · Block + product</h2>

    <label for={blockFieldId}>Block</label>
    <select id={blockFieldId} bind:value={blockId} required>
      <option value="">— pick a block —</option>
      {#each blocks as b (b.id)}
        <option value={b.id}>{b.name}{b.acres ? ` · ${b.acres.toFixed(2)} acres` : ''}</option>
      {/each}
    </select>

    {@render productSection()}
  </section>

  {#if observation}
    <section class="card">
      <h2>2 · Observation (optional)</h2>
      {@render observation()}
    </section>
  {/if}

  <section class="card">
    <h2>{conditionsHeading}</h2>

    <label for={windFieldId}>Wind (mph)</label>
    <input id={windFieldId} type="number" min="0" step="0.5" bind:value={windMph} required />

    <label for={tempFieldId}>Temperature (°F)</label>
    <input id={tempFieldId} type="number" step="0.5" bind:value={tempF} required />

    <label for={rainFieldId}>Rain forecast next 24h (%)</label>
    <input
      id={rainFieldId}
      type="number"
      min="0"
      max="100"
      step="1"
      bind:value={rainPct}
      required
    />

    <label for={tankFieldId}>Tank size (gal, optional — enables stock decrement)</label>
    <input id={tankFieldId} type="number" min="0" step="0.5" bind:value={tankSize} />
  </section>

  <section class="card actions">
    <Button type="submit" variant="primary" loading={busy} disabled={!canSubmit}>
      {busy ? 'Recording…' : submitLabel}
    </Button>
  </section>
</form>

{#if result}
  <Banner tone="forest">{result}</Banner>
{/if}
{#if error}
  <Banner tone="rust" urgent>
    <strong>Error:</strong>
    {error}
    {#if violations.length > 0}
      <ul class="violations">
        {#each violations as v (v.code + v.message)}
          <li>
            <code>{v.code}</code> — {v.message}
            {#if v.detail?.source === 'user-added'}
              <span class="badge">stock label</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </Banner>
{/if}
{#if warnings.length > 0}
  <Banner tone="wheat">
    <strong>Warnings:</strong>
    <ul class="violations">
      {#each warnings as w, i (i)}<li>{w}</li>{/each}
    </ul>
  </Banner>
{/if}

{#if recentEvents}
  {@render recentEvents()}
{/if}

<style>
  .card {
    background: var(--color-paper, #fff);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    padding: 1rem 1.25rem;
    margin: 0 0 1rem;
  }
  h2 {
    margin: 0 0 0.5rem;
  }
  label {
    display: block;
    margin: 0.75rem 0 0.25rem;
    font-weight: 500;
  }
  input,
  select {
    width: 100%;
    padding: 0.6rem;
    font-size: 1rem;
    min-height: 48px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper, #fff);
  }
  .actions {
    text-align: right;
  }
  .violations {
    margin: 0.5rem 0 0;
    padding-left: 1.25rem;
  }
  .badge {
    display: inline-block;
    background: var(--color-rust);
    color: var(--color-cream);
    font-size: 0.75rem;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    margin-left: 0.25rem;
  }
</style>
