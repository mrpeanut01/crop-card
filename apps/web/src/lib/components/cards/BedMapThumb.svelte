<script lang="ts">
  import type { CardBedMap } from '$lib/cards/model';

  interface Props {
    map: CardBedMap;
    print?: boolean;
  }

  const { map, print = false }: Props = $props();

  const uid = $props.id();
  const PATTERNS = ['diag', 'dots', 'cross', 'horiz'] as const;
  const pad = $derived(Math.max(map.widthFt, map.lengthFt) * 0.04);
  const font = $derived(Math.max(map.widthFt, map.lengthFt) / 22);
  const scaleFt = $derived(map.widthFt >= 40 ? 10 : map.widthFt >= 12 ? 5 : 1);
  const label = $derived(
    `Bed map, ${map.widthFt} by ${map.lengthFt} feet. ` +
      map.beds.map((b) => `${b.name}: ${b.crops.length ? b.crops.join(', ') : 'open'}`).join('. ')
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
      <text
        x={b.x + b.w / 2}
        y={b.y + b.l / 2}
        font-size={font}
        text-anchor="middle"
        dominant-baseline="middle"
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
  {#if print}
    <figcaption>
      <ul>
        {#each map.beds as b, i (i)}
          <li><strong>{b.name}</strong>: {b.crops.length ? b.crops.join(', ') : 'open'}</li>
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
  figcaption ul {
    margin: 0;
    padding-left: 1.1em;
    font-size: 9pt;
  }
</style>
