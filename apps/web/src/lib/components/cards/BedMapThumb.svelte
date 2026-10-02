<script lang="ts">
  import type { CardBedMap } from '$lib/cards/model';
  import { bedMapLabels } from '$lib/cards/bedMapLabels';
  import { ALL_GLYPHS } from '$lib/garden/familyGlyph';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface Props {
    map: CardBedMap;
    print?: boolean;
  }

  const { map, print = false }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  const uid = $props.id();
  const PATTERNS = ['diag', 'dots', 'cross', 'horiz'] as const;
  const pad = $derived(Math.max(map.widthFt, map.lengthFt) * 0.04);
  const font = $derived(Math.max(map.widthFt, map.lengthFt) / 22);
  const scaleFt = $derived(map.widthFt >= 40 ? 10 : map.widthFt >= 12 ? 5 : 1);
  const glyphD = new Map(ALL_GLYPHS.map((g) => [g.key, g.d]));
  const glyphLabel = new Map(ALL_GLYPHS.map((g) => [g.key, g.label]));
  const marks = $derived(bedMapLabels(map, font * 0.8));
  const hasPlantings = $derived(map.beds.some((b) => (b.plantings ?? []).length > 0));
  const glyphsUsed = $derived(
    [...new Set(map.beds.flatMap((b) => (b.plantings ?? []).map((p) => p.glyph)))].sort()
  );
  const label = $derived(
    `${tr('cardsui.bed.label', { width: map.widthFt, length: map.lengthFt })} ` +
      map.beds
        .map((b) => `${b.name}: ${b.crops.length ? b.crops.join(', ') : tr('cardsui.bed.open')}`)
        .join('. ') +
      (marks.legend.length
        ? `. ${tr('cardsui.bed.numbers')}: ${marks.legend.map((r) => `${r.n}, ${r.text}`).join('; ')}.`
        : '')
  );
</script>

<figure class="bedmap" class:print>
  <svg
    viewBox="{-pad} {-pad} {map.widthFt + 2 * pad} {map.lengthFt + 3 * pad + font}"
    role="img"
    aria-label={label}
    preserveAspectRatio="xMidYMid meet"
  >
    <defs>
      <pattern
        id="{uid}-diag"
        patternUnits="userSpaceOnUse"
        width="1"
        height="1"
        patternTransform="rotate(45)"
      >
        <line x1="0" y1="0" x2="0" y2="1" stroke="#000" stroke-width="0.15" />
      </pattern>
      <pattern id="{uid}-dots" patternUnits="userSpaceOnUse" width="1" height="1">
        <circle cx="0.5" cy="0.5" r="0.18" fill="#000" />
      </pattern>
      <pattern id="{uid}-cross" patternUnits="userSpaceOnUse" width="1" height="1">
        <path d="M0 0L1 1M1 0L0 1" stroke="#000" stroke-width="0.1" />
      </pattern>
      <pattern id="{uid}-horiz" patternUnits="userSpaceOnUse" width="1" height="1">
        <line x1="0" y1="0.5" x2="1" y2="0.5" stroke="#000" stroke-width="0.15" />
      </pattern>
    </defs>
    <rect
      x="0"
      y="0"
      width={map.widthFt}
      height={map.lengthFt}
      fill="#fff"
      stroke="#000"
      stroke-width={font / 8}
    />
    {#each map.beds as b, i (i)}
      <rect
        x={b.x}
        y={b.y}
        width={b.w}
        height={b.l}
        rx={b.kind === 'container' ? Math.min(b.w, b.l) / 2 : 0}
        fill={b.crops.length ? `url(#${uid}-${PATTERNS[i % PATTERNS.length]})` : '#fff'}
        stroke="#000"
        stroke-width={font / 6}
      />
      {#each b.plantings ?? [] as p, j (j)}
        {@const m = marks.labels[i]?.[j]}
        <g
          class="planting"
          class:later={p.later}
          class:unplaced={!p.placed}
          data-testid="bedmap-planting"
          data-glyph={p.glyph}
        >
          <rect
            x={p.x}
            y={p.y}
            width={p.w}
            height={p.l}
            fill={p.later ? 'none' : '#fff'}
            stroke="#000"
            stroke-width={font / 9}
            stroke-dasharray={p.later || !p.placed ? `${font / 3} ${font / 4}` : undefined}
          />
          {#if m && m.iconFt > 0}
            <path
              d={glyphD.get(p.glyph)}
              transform="translate({p.x + font * 0.12} {p.y + font * 0.12}) scale({m.iconFt / 10})"
              fill="none"
              stroke="#000"
              stroke-width={font / 9}
              vector-effect="non-scaling-stroke"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          {/if}
          {#if m?.text}
            <text
              x={p.x + (m.iconFt > 0 ? m.iconFt + font * 0.2 : font * 0.15)}
              y={p.y + Math.min(p.l / 2, font * 0.9)}
              font-size={font * 0.8}
              dominant-baseline="middle"
              class="pname">{m.text}</text
            >
          {:else if m?.n}
            <text
              x={p.x + p.w / 2}
              y={p.y + p.l / 2}
              font-size={Math.min(font * 0.8, Math.max(p.l, 0.3) * 0.9)}
              text-anchor="middle"
              dominant-baseline="middle"
              class="pnum">{m.n}</text
            >
          {/if}
        </g>
      {/each}
      <text
        x={b.x + b.w / 2}
        y={hasPlantings ? b.y + b.l - font * 0.3 : b.y + b.l / 2}
        font-size={font}
        text-anchor="middle"
        dominant-baseline={hasPlantings ? 'auto' : 'middle'}
        class="name">{b.name}</text
      >
    {/each}
    <g transform="translate(0, {map.lengthFt + pad + font})">
      <line x1="0" y1="0" x2={scaleFt} y2="0" stroke="#000" stroke-width={font / 5} />
      <text x={scaleFt + font / 2} y={font / 3} font-size={font}>{scaleFt} ft</text>
    </g>
    {#if map.hasNorth}
      <text x={map.widthFt - font} y={font} font-size={font} font-weight="700">N ↑</text>
    {/if}
  </svg>
  {#if marks.legend.length || glyphsUsed.length}
    <div class="legend" data-testid="bedmap-legend">
      {#if marks.legend.length}
        <ol>
          {#each marks.legend as row (row.n)}
            <li value={row.n}>{row.text}</li>
          {/each}
        </ol>
      {/if}
      {#if glyphsUsed.length}
        <ul class="icons">
          {#each glyphsUsed as g (g)}
            <li>
              <svg viewBox="0 0 10 10" aria-hidden="true" class="icon"
                ><path
                  d={glyphD.get(g)}
                  fill="none"
                  stroke="currentColor"
                  stroke-width="0.9"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                /></svg
              >{glyphLabel.get(g)}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
  {#if print}
    <figcaption>
      <ul>
        {#each map.beds as b, i (i)}
          <li>
            <strong>{b.name}</strong>: {b.crops.length
              ? b.crops.join(', ')
              : tr('cardsui.bed.open')}
          </li>
        {/each}
      </ul>
    </figcaption>
  {/if}
</figure>

<style>
  .bedmap {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  svg {
    width: 100%;
    max-height: 180px;
    background: #fff;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
  }
  .name {
    paint-order: stroke;
    stroke: #fff;
    stroke-width: 0.25;
    fill: #000;
    font-weight: 700;
  }
  .print svg {
    max-height: 1.6in;
    border-color: #000;
  }
  .pname,
  .pnum {
    paint-order: stroke;
    stroke: #fff;
    stroke-width: 0.18;
    fill: #000;
    font-weight: 600;
  }
  .legend {
    font-size: 12px;
    color: var(--color-ink, #000);
  }
  .legend ol {
    margin: 0 0 4px;
    padding-left: 1.6em;
  }
  .legend .icons {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
  }
  .legend .icons li {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .legend .icon {
    width: 14px;
    height: 14px;
    flex: none;
  }
  .print .legend {
    font-size: 8.5pt;
    color: #000;
  }
  figcaption ul {
    margin: 0;
    padding-left: 1.1em;
    font-size: 9pt;
  }
</style>
