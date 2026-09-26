<script lang="ts">
  import { Map as MapIcon, Ruler, PencilLine, Sprout } from 'lucide-svelte';
  import type { SetupArea } from '$lib/setup/types';

  interface Props {
    onName: () => void;
    /** Areas already on the farm with nothing inside yet. */
    emptyAreas?: SetupArea[];
    /** The Area the person came from, when it has nothing inside yet. */
    focusArea?: SetupArea | null;
    onWhole?: (area: SetupArea) => void;
    busy?: boolean;
    error?: string | null;
  }

  const {
    onName,
    emptyAreas = [],
    focusArea = null,
    onWhole,
    busy = false,
    error = null
  }: Props = $props();

  const wholeChoices = $derived(focusArea ? [focusArea] : emptyAreas);

  function listNames(names: string[]): string {
    if (names.length <= 1) return names[0] ?? '';
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
</script>

<section class="where" aria-labelledby="where-title" data-testid="plan-where">
  <p class="kicker">Plan</p>
  {#if focusArea}
    <h2 id="where-title" class="serif">Where in {focusArea.name} will this grow?</h2>
    <p class="lede">
      Nothing is inside {focusArea.name} yet. Plant the whole thing as one bed, or give a smaller spot
      a name.
    </p>
  {:else}
    <h2 id="where-title" class="serif">Where will this grow?</h2>
    {#if emptyAreas.length > 0}
      <p class="lede">
        You already have {listNames(emptyAreas.map((a) => a.name))}. Plant one as a whole, or name a
        smaller spot inside it.
      </p>
    {:else}
      <p class="lede">
        Crops need a spot on the farm before they can be planned. Pick whichever way suits you. A
        name is enough to start, and you can draw it properly later.
      </p>
    {/if}
  {/if}
  {#if onWhole && wholeChoices.length > 0}
    <ul class="choices whole">
      {#each wholeChoices as a (a.id)}
        <li>
          <button type="button" class="choice primary" disabled={busy} onclick={() => onWhole(a)}>
            <Sprout size={22} strokeWidth={1.75} aria-hidden="true" />
            <span class="choice-title">Plant the whole {a.name} as one bed</span>
            <span class="choice-hint">You can split it into beds later.</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <ul class="choices">
    <li>
      <a class="choice" href="/plan/farm">
        <MapIcon size={22} strokeWidth={1.75} aria-hidden="true" />
        <span class="choice-title">Draw it on the map</span>
        <span class="choice-hint">Trace your fields and beds over the satellite view.</span>
      </a>
    </li>
    <li>
      <a class="choice" href="/plan/farm?mode=sketch">
        <Ruler size={22} strokeWidth={1.75} aria-hidden="true" />
        <span class="choice-title">Sketch it by size</span>
        <span class="choice-hint">Type the width and length and CropCard draws a box.</span>
      </a>
    </li>
    <li>
      <button type="button" class="choice" onclick={onName}>
        <PencilLine size={22} strokeWidth={1.75} aria-hidden="true" />
        <span class="choice-title"
          >{focusArea ? `Name a bed inside ${focusArea.name}` : 'Just give it a name'}</span
        >
        <span class="choice-hint">No map, no measuring. Draw it later if you like.</span>
      </button>
    </li>
  </ul>
</section>

<style>
  .where {
    margin: var(--space-4) 0;
    padding: var(--card-padding-loose);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
  }
  .kicker {
    margin: 0 0 2px;
    font-size: var(--font-size-kicker);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }
  h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-screen-title);
    color: var(--color-forest-deep);
  }
  .lede {
    margin: 0 0 var(--space-4);
    color: var(--color-ink-soft);
    max-width: 60ch;
  }
  .choices {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--space-3);
  }
  .choice {
    width: 100%;
    height: 100%;
    min-height: 96px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    padding: var(--space-4);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-cream);
    color: var(--color-forest-deep);
    font: inherit;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }
  .whole {
    margin-bottom: var(--space-3);
  }
  .choice.primary {
    border-color: var(--color-forest);
    background: var(--pill-forest-bg);
  }
  .choice:disabled {
    opacity: 0.6;
    cursor: wait;
  }
  .error {
    color: var(--color-rust);
    margin: 0 0 var(--space-3);
  }
  .choice:hover {
    border-color: var(--color-forest);
    background: var(--pill-forest-bg);
  }
  .choice-title {
    font-weight: 600;
    font-size: var(--font-size-body-lg);
  }
  .choice-hint {
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
</style>
