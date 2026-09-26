<script lang="ts">
  import { AREA_KINDS, AREA_KIND_LABELS, type AreaKind } from '$lib/farm/areaKinds';
  import { kindStyle } from '$lib/farm/kindStyle';
  import {
    layoutMapOverlay,
    type OverlayBlockInput,
    type OverlayFieldInput
  } from '$lib/plan/mapOverlayLayout';

  const {
    fields,
    blocks,
    label = 'Farm map'
  }: {
    fields: OverlayFieldInput[];
    blocks: OverlayBlockInput[];
    label?: string;
  } = $props();

  const layout = $derived(layoutMapOverlay(fields, blocks));
  const kindById = $derived(new Map(fields.map((f) => [f.id, f.kind ?? 'field'] as const)));
  const blockParent = $derived(new Map(blocks.map((b) => [b.id, b.fieldId] as const)));
  const span = $derived(Math.max(layout.width, layout.height));
  const pad = $derived(span * 0.05);
  const viewBox = $derived(
    `${layout.minX - pad} ${layout.minY - pad} ${layout.width + pad * 2} ${layout.height + pad * 2}`
  );
  const fontSize = $derived(span * 0.03);
  const legend = $derived(
    AREA_KINDS.filter((k) => layout.fields.some((f) => kindById.get(f.id) === k))
  );

  function pathFor(rings: Array<[number, number]>[]): string {
    return rings
      .map((r) => 'M' + r.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L') + 'Z')
      .join('');
  }
  function blockKind(id: string): AreaKind {
    const parent = blockParent.get(id);
    return (parent && kindById.get(parent)) || 'field';
  }
</script>

<figure class="farm-figure" data-testid="farm-map-figure">
  {#if layout.mode === 'none'}
    <p class="empty">Nothing is drawn or sized yet, so there is no picture to show.</p>
  {:else}
    <svg
      {viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="{label}{layout.mode === 'sketch' ? ', sketched from entered sizes' : ''}"
    >
      {#each layout.fields as f (f.id)}
        {@const ks = kindStyle(kindById.get(f.id))}
        <path
          d={pathFor(f.rings)}
          class="area"
          data-area-kind={kindById.get(f.id)}
          style:fill={ks.color}
          style:fill-opacity={Math.max(ks.fillOpacity, 0.04)}
          style:stroke={ks.color}
          style:stroke-dasharray={ks.dashArray ?? 'none'}
        />
      {/each}
      {#each layout.blocks as b (b.id)}
        {@const ks = kindStyle(blockKind(b.id))}
        <path d={pathFor(b.rings)} class="block" style:fill={ks.color} style:stroke={ks.color} />
      {/each}
      {#each layout.fields as f (f.id)}
        <text
          x={f.labelX}
          y={f.labelY}
          style:font-size="{fontSize}px"
          text-anchor="middle"
          dominant-baseline="middle">{f.name}</text
        >
      {/each}
    </svg>
    {#if legend.length}
      <figcaption>
        <ul class="legend" aria-label="Legend">
          {#each legend as k (k)}
            <li>
              <span class="swatch" style:--kind={kindStyle(k).color} aria-hidden="true"></span>
              {AREA_KIND_LABELS[k]}
            </li>
          {/each}
        </ul>
        {#if layout.mode === 'sketch'}
          <p class="note">Placed from the sizes you entered, not surveyed.</p>
        {/if}
      </figcaption>
    {/if}
  {/if}
</figure>

<style>
  .farm-figure {
    margin: 0;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 10px);
    background: var(--color-paper);
    overflow: hidden;
  }
  svg {
    display: block;
    width: 100%;
    max-height: 420px;
    aspect-ratio: 16 / 10;
    background: linear-gradient(180deg, #ece7d4 0%, #e0d9bd 100%);
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .area {
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  .block {
    fill-opacity: 0.55;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  text {
    fill: var(--color-ink);
    font-weight: 700;
    paint-order: stroke;
    stroke: var(--color-paper);
    stroke-width: 0.25em;
    stroke-linejoin: round;
  }
  figcaption {
    padding: 10px 12px;
    border-top: 1px solid var(--color-divider);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 13px;
    color: var(--color-ink-soft);
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--kind) 35%, transparent);
    border: 2px solid var(--kind);
  }
  .note,
  .empty {
    margin: 6px 0 0;
    font-size: 12.5px;
    color: var(--color-ink-muted);
  }
  .empty {
    padding: 32px 16px;
    text-align: center;
  }
</style>
