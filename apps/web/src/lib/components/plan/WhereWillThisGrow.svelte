<script lang="ts">
  import { Map as MapIcon, Ruler, PencilLine } from 'lucide-svelte';

  interface Props {
    onName: () => void;
  }

  const { onName }: Props = $props();
</script>

<section class="where" aria-labelledby="where-title" data-testid="plan-where">
  <p class="kicker">Plan</p>
  <h2 id="where-title" class="serif">Where will this grow?</h2>
  <p class="lede">
    Crops need a spot on the farm before they can be planned. Pick whichever way suits you. A name
    is enough to start, and you can draw it properly later.
  </p>
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
        <span class="choice-title">Just give it a name</span>
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
