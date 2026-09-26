<script lang="ts">
  import { currentPrefs, fmt } from '$lib/prefsState.svelte';
  import {
    formatFt,
    layoutSketch,
    type SketchBlockInput,
    type SketchInput
  } from '$lib/farm/sketch';
  import type { AreaKind } from '$lib/farm/areaKinds';
  import { AREA_KIND_LABELS } from '$lib/farm/areaKinds';
  import { kindStyle } from '$lib/farm/kindStyle';

  let {
    fields,
    blocks,
    onSelectArea
  }: {
    fields: Array<SketchInput & { kind?: AreaKind }>;
    blocks: SketchBlockInput[];
    onSelectArea?: (id: string) => void;
  } = $props();

  const kindById = $derived(new Map(fields.map((f) => [f.id, f.kind ?? 'field'] as const)));

  const layout = $derived(layoutSketch(fields, blocks));
  const span = $derived(Math.max(layout.width, layout.height, 1));
  const pad = $derived(span * 0.06);
  const font = $derived(span * 0.028);
  const viewBox = $derived(
    `${-pad} ${-pad} ${layout.width + pad * 2} ${layout.height + pad * 2 + font * 2.2}`
  );

  function niceScale(max: number): number {
    const target = max / 4;
    const steps = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
    return steps.reduce((best, s) => (s <= target ? s : best), steps[0]);
  }
  const scaleUnits = $derived(niceScale(fmt.toDisplay(span, 'distance')));
  const scaleFt = $derived(fmt.fromDisplay(scaleUnits, 'distance'));
</script>

<figure class="sketch" data-testid="farm-sketch">
  {#if layout.fields.length === 0}
    <div class="sketch-empty">
      <p>Nothing to sketch yet. Add a field with its width and length below.</p>
    </div>
  {:else}
    <svg
      {viewBox}
      role="img"
      aria-label="Farm sketch: {layout.fields.length} field{layout.fields.length === 1
        ? ''
        : 's'} drawn to scale from their dimensions"
    >
      <defs>
        <pattern
          id="sketch-grass"
          width={span / 40}
          height={span / 40}
          patternUnits="userSpaceOnUse"
        >
          <circle cx={span / 80} cy={span / 80} r={span / 900} class="grass-dot" />
        </pattern>
      </defs>
      <rect
        x={-pad}
        y={-pad}
        width={layout.width + pad * 2}
        height={layout.height + pad * 2 + font * 2.2}
        class="ground"
      />
      <rect
        x={-pad}
        y={-pad}
        width={layout.width + pad * 2}
        height={layout.height + pad * 2 + font * 2.2}
        fill="url(#sketch-grass)"
      />

      {#each layout.fields as f (f.id)}
        {@const kind = kindById.get(f.id) ?? 'field'}
        <g data-field={f.name} data-area-kind={kind} style:--kind={kindStyle(kind).color}>
          {#if onSelectArea}
            <rect
              x={f.x}
              y={f.y}
              width={f.w}
              height={f.h}
              class="field tappable"
              class:estimated={!f.measured}
              vector-effect="non-scaling-stroke"
              role="button"
              tabindex="0"
              aria-label="Open the card for {f.name}, {AREA_KIND_LABELS[kind]}"
              onclick={() => onSelectArea(f.id)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectArea(f.id);
                }
              }}
            />
          {:else}
            <rect
              x={f.x}
              y={f.y}
              width={f.w}
              height={f.h}
              class="field"
              class:estimated={!f.measured}
              vector-effect="non-scaling-stroke"
            />
          {/if}
          {#each f.blocks as b (b.id)}
            <g data-block={b.name}>
              <rect
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                class="block"
                class:overflow={!b.fits}
                vector-effect="non-scaling-stroke"
              >
                <title
                  >{b.name}: {formatFt(b.w, currentPrefs())} × {formatFt(
                    b.h,
                    currentPrefs()
                  )}{b.fits ? '' : ' (runs past the field edge)'}</title
                >
              </rect>
              {#if b.w > font * 3 && b.h > font * 1.4}
                <text
                  x={b.x + b.w / 2}
                  y={b.y + b.h / 2}
                  font-size={Math.min(font * 0.8, b.h * 0.4)}
                  class="sk-block-label">{b.name}</text
                >
              {/if}
            </g>
          {/each}
          <text x={f.x} y={f.y - font * 0.4} font-size={font} class="sk-field-label"
            >{f.name}
            <tspan class="dims"
              >{f.measured
                ? `${formatFt(f.w, currentPrefs())} × ${formatFt(f.h, currentPrefs())}`
                : '(size from area)'}</tspan
            ></text
          >
        </g>
      {/each}

      <g class="scale" transform="translate(0 {layout.height + pad * 0.6})">
        <line x1="0" y1="0" x2={scaleFt} y2="0" vector-effect="non-scaling-stroke" />
        <line x1="0" y1={-font * 0.3} x2="0" y2={font * 0.3} vector-effect="non-scaling-stroke" />
        <line
          x1={scaleFt}
          y1={-font * 0.3}
          x2={scaleFt}
          y2={font * 0.3}
          vector-effect="non-scaling-stroke"
        />
        <text x={scaleFt + font * 0.5} y={font * 0.35} font-size={font * 0.8} class="sk-scale-label"
          >{scaleUnits} {fmt.unit('distance')}</text
        >
      </g>
    </svg>
  {/if}
  <figcaption>
    Sketch only: boxes are drawn to scale from the dimensions you entered, but their placement is
    arranged automatically. Draw on the map when you want real boundaries for pollination distances
    and shade.
    {#if layout.unsized.length > 0}
      <span class="unsized">Not shown (no size yet): {layout.unsized.join(', ')}.</span>
    {/if}
  </figcaption>
</figure>

<style>
  .sketch {
    margin: 0 0 12px;
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    overflow: hidden;
    background: #dfe7cf;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
    max-height: 520px;
  }
  .ground {
    fill: #dfe7cf;
  }
  .grass-dot {
    fill: #b9c9a0;
  }
  .field {
    fill: color-mix(in srgb, var(--kind, #2c5237) 18%, #f4efe0);
    stroke: var(--kind, var(--color-forest));
    stroke-width: 2;
  }
  .field.tappable {
    cursor: pointer;
    outline: none;
  }
  .field.tappable:hover,
  .field.tappable:focus-visible {
    stroke-width: 4;
  }
  .field.estimated {
    stroke-dasharray: 6 4;
  }
  .block {
    pointer-events: none;
    fill: #e8d7a8;
    stroke: #8a6d2f;
    stroke-width: 1.5;
  }
  .block.overflow {
    fill: #f1c9b8;
    stroke: #a4452c;
    stroke-dasharray: 4 3;
  }
  .sk-field-label {
    fill: var(--color-ink, #1f241c);
    font-weight: 600;
  }
  .dims {
    font-weight: 400;
    fill: var(--color-ink-soft, #4a4f45);
  }
  .sk-block-label {
    fill: #3b2f14;
    text-anchor: middle;
    dominant-baseline: middle;
  }
  .scale line {
    stroke: var(--color-ink, #1f241c);
    stroke-width: 1.5;
  }
  .sk-scale-label {
    fill: var(--color-ink, #1f241c);
  }
  .sketch-empty {
    background: #dfe7cf;
    padding: 48px 16px;
    text-align: center;
    color: var(--color-ink-soft);
  }
  .sketch-empty p {
    margin: 0;
  }
  figcaption {
    background: var(--color-paper);
    padding: 8px 12px;
    font-size: 12.5px;
    color: var(--color-ink-muted);
    border-top: 1px solid var(--color-divider);
  }
  .unsized {
    display: block;
    margin-top: 4px;
  }
</style>
