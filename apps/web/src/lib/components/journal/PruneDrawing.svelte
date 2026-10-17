<script lang="ts">
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import {
    pruneDrawingSrc,
    type DrawingCaption,
    type PruneDrawingId
  } from '$lib/journal/pruneDrawing';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface Props {
    drawing: PruneDrawingId;
    caption: DrawingCaption;
    /** The grower's photo, shown unmarked beside the drawing. */
    photo?: string | null;
  }

  const { drawing, caption, photo = null }: Props = $props();
  const tr = $derived(createT(page.data?.locale));
</script>

<section class="prune-drawing" data-testid="prune-drawing" data-drawing={drawing}>
  <h4>
    {tr('herbsf.drawing.title')}
    <Provenance source="fallback" compact />
  </h4>
  <p class="lede">{tr('herbsf.drawing.lede')}</p>
  <div class="pair">
    <img
      class="drawing"
      src={pruneDrawingSrc(drawing)}
      alt={tr(`herbsf.drawing.alt.${drawing}`)}
      width="160"
      height="160"
    />
    {#if photo}
      <img class="photo" src={photo} alt={tr('herbsf.drawing.photoAlt')} />
    {/if}
  </div>
  <ul class="caption" data-testid="prune-drawing-caption">
    {#each caption.items as item, i (i)}
      <li>{item}</li>
    {/each}
  </ul>
  <Provenance source={caption.provenance} compact />
</section>

<style>
  .prune-drawing {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  h4 {
    margin: 0;
    font-size: var(--font-size-body);
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .lede {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: var(--font-size-caption);
  }
  .pair {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: flex-start;
  }
  .drawing {
    width: 160px;
    height: 160px;
    background: #fbf8f0;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
  }
  .photo {
    width: 160px;
    height: 160px;
    object-fit: cover;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
  }
  .caption {
    margin: 0;
    padding-left: var(--space-4);
  }
</style>
