<script lang="ts">
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { PhotoMark, PhotoMarkKind } from '$lib/journal/model';
  import { markShape } from '$lib/journal/printMarks';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface Props {
    src: string;
    marks: readonly PhotoMark[];
    steps?: readonly string[];
    alt?: string;
    /** The crop's Care Guide "Common problems" tips, shown beside a problem
     *  mark; with none, only the extension office line shows (#869). */
    problemTips?: readonly string[];
  }

  const { src, marks, steps = [], alt, problemTips = [] }: Props = $props();

  const tr = $derived(createT(page.data?.locale));
  const KIND_KEY = {
    cut: 'herbsf.marks.kind.cut',
    pinch: 'herbsf.marks.kind.pinch',
    harvest: 'herbsf.marks.kind.harvest',
    leave: 'herbsf.marks.kind.leave',
    problem: 'herbsh.marks.kind.problem'
  } as const satisfies Record<PhotoMarkKind, string>;
  /** Half the diagonal of a problem mark's diamond, in px. */
  const DIAMOND = 18;

  let img = $state<HTMLImageElement | null>(null);
  let width = $state(0);
  let height = $state(0);
  let selected = $state<number | null>(null);

  function measure() {
    if (!img) return;
    width = img.clientWidth;
    height = img.clientHeight;
  }

  $effect(() => {
    const el = img;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (!box) return;
      width = box.width;
      height = box.height;
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  const placed = $derived(
    marks.map((m, i) => {
      const w = (m.w ?? 0) * width;
      const h = (m.h ?? 0) * height;
      const left = m.x * width;
      const top = m.y * height;
      return {
        n: i + 1,
        mark: m,
        shape: markShape(m.kind),
        box: m.w !== undefined || m.h !== undefined ? { left, top, w, h } : null,
        cx: left + w / 2,
        cy: top + h / 2
      };
    })
  );
  const hasProblem = $derived(marks.some((m) => m.kind === 'problem'));
  const tips = $derived(problemTips.map((t) => t.trim()).filter(Boolean));

  function markName(n: number, m: PhotoMark): string {
    return tr('herbsf.marks.mark', { n, kind: tr(KIND_KEY[m.kind]), label: m.label });
  }

  function diamond(cx: number, cy: number): string {
    return `${cx},${cy - DIAMOND} ${cx + DIAMOND},${cy} ${cx},${cy + DIAMOND} ${cx - DIAMOND},${cy}`;
  }
</script>

<div class="photo-marks" data-testid="photo-marks">
  <div class="frame">
    <img
      bind:this={img}
      {src}
      alt={alt ?? tr('herbsf.marks.photoAlt')}
      onload={measure}
      data-testid="photo-marks-image"
    />
    {#if width > 0 && height > 0}
      <svg class="overlay" {width} {height} viewBox="0 0 {width} {height}" aria-hidden="true">
        {#each placed as p (p.n)}
          {#if p.box}
            <rect
              class="shape kind-{p.mark.kind}"
              class:on={selected === p.n}
              class:dashed={p.shape === 'diamond'}
              x={p.box.left}
              y={p.box.top}
              width={Math.max(p.box.w, 2)}
              height={Math.max(p.box.h, 2)}
              rx={p.shape === 'diamond' ? 0 : 6}
            />
          {:else if p.shape === 'diamond'}
            <polygon
              class="shape kind-{p.mark.kind}"
              class:on={selected === p.n}
              points={diamond(p.cx, p.cy)}
            />
          {:else}
            <circle
              class="shape kind-{p.mark.kind}"
              class:on={selected === p.n}
              cx={p.cx}
              cy={p.cy}
              r="16"
            />
          {/if}
        {/each}
      </svg>
      {#each placed as p (p.n)}
        <button
          type="button"
          class="mark kind-{p.mark.kind} shape-{p.shape}"
          style="left: {p.cx}px; top: {p.cy}px"
          aria-pressed={selected === p.n}
          aria-label={markName(p.n, p.mark)}
          aria-describedby="photo-mark-legend-{p.n}"
          data-testid="photo-mark"
          data-kind={p.mark.kind}
          data-shape={p.shape}
          onclick={() => (selected = selected === p.n ? null : p.n)}
          ><span class="num">{p.n}</span></button
        >
      {/each}
    {/if}
  </div>

  <div class="legend">
    <h4>
      {tr('herbsf.marks.legend')}
      <Provenance source="ai" compact />
    </h4>
    {#if hasProblem}
      <ul class="key" aria-label={tr('herbsh.marks.key.label')} data-testid="photo-marks-key">
        <li>
          <span class="swatch shape-circle" aria-hidden="true"></span>{tr('herbsh.marks.key.step')}
        </li>
        <li data-testid="photo-marks-key-problem">
          <span class="swatch shape-diamond" aria-hidden="true"></span>{tr(
            'herbsh.marks.key.problem'
          )}
        </li>
      </ul>
    {/if}
    <ol class="legend-list" data-testid="photo-marks-legend">
      {#each placed as p (p.n)}
        <li
          id="photo-mark-legend-{p.n}"
          class:on={selected === p.n}
          data-kind={p.mark.kind}
          data-shape={p.shape}
        >
          <span class="badge kind-{p.mark.kind} shape-{p.shape}" aria-hidden="true"
            ><span class="num">{p.n}</span></span
          >
          <span class="kind">{tr(KIND_KEY[p.mark.kind])}</span>
          <span class="label">{p.mark.label}</span>
        </li>
      {/each}
    </ol>
    {#if steps.length}
      <h4>{tr('herbsf.marks.steps')}</h4>
      <ol class="steps" data-testid="photo-marks-steps">
        {#each steps as step, i (i)}
          <li class:on={selected === i + 1}>{step}</li>
        {/each}
      </ol>
    {/if}
    {#if hasProblem}
      {#if tips.length}
        <section class="problem-tips" data-testid="photo-marks-problem-tips">
          <h4>
            {tr('cards.care.problems')}
            <Provenance source="fallback" label={tr('cardsui.photo.careGuide')} compact />
          </h4>
          <ul>
            {#each tips as tip, i (i)}<li>{tip}</li>{/each}
          </ul>
        </section>
      {:else}
        <p class="extension" data-testid="photo-marks-extension">{tr('herbsh.marks.extension')}</p>
      {/if}
    {/if}
  </div>
</div>

<style>
  .photo-marks {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .frame {
    position: relative;
    align-self: flex-start;
    max-width: 100%;
    line-height: 0;
  }
  .frame img {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-input);
    outline: 1px solid var(--color-divider);
  }
  .overlay {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    overflow: visible;
  }
  .shape {
    fill: none;
    stroke-width: 3;
    stroke: var(--mark-color);
    filter: drop-shadow(0 0 1px #fff);
  }
  .shape.dashed {
    stroke-dasharray: 8 5;
  }
  .shape.on {
    stroke-width: 5;
  }
  .kind-cut {
    --mark-color: var(--pill-rust-fg, #a3412a);
  }
  .kind-pinch {
    --mark-color: var(--pill-wheat-fg, #7a5a12);
  }
  .kind-harvest {
    --mark-color: var(--pill-forest-fg, #2f5a33);
  }
  .kind-leave {
    --mark-color: var(--pill-sky-fg, #2a5a7a);
  }
  .kind-problem {
    --mark-color: #4b1f73;
  }
  .mark {
    position: absolute;
    transform: translate(-50%, -50%);
    width: 48px;
    height: 48px;
    min-width: 48px;
    min-height: 48px;
    padding: 0;
    border-radius: 50%;
    border: 3px solid var(--mark-color);
    background: rgba(255, 255, 255, 0.85);
    color: #1b1b1b;
    font: inherit;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
  }
  .mark.shape-diamond {
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  .mark.shape-diamond::before {
    content: '';
    position: absolute;
    inset: 7px;
    transform: rotate(45deg);
    border: 3px dashed var(--mark-color);
    background: rgba(255, 255, 255, 0.9);
  }
  .mark .num,
  .badge .num {
    position: relative;
  }
  .mark[aria-pressed='true'] {
    background: var(--mark-color);
    color: #fff;
  }
  .mark.shape-diamond[aria-pressed='true'] {
    background: transparent;
  }
  .mark.shape-diamond[aria-pressed='true']::before {
    background: var(--mark-color);
    border-style: solid;
  }
  .mark:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .legend h4 {
    margin: 0;
    font-size: var(--font-size-body);
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .legend-list,
  .steps,
  .key {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .steps {
    list-style: decimal;
    padding-left: var(--space-4);
  }
  .key li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-caption);
    color: var(--color-ink);
  }
  .swatch {
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
    box-sizing: border-box;
    border: 3px solid var(--color-ink);
    border-radius: 50%;
  }
  .swatch.shape-diamond {
    width: 14px;
    height: 14px;
    margin: 2px;
    border-radius: 0;
    border-style: dashed;
    border-color: #4b1f73;
    transform: rotate(45deg);
  }
  .legend-list li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .legend-list li.on,
  .steps li.on {
    font-weight: 700;
  }
  .badge {
    position: relative;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 3px solid var(--mark-color);
    font-weight: 700;
    font-size: var(--font-size-caption);
    box-sizing: border-box;
  }
  .badge.shape-diamond {
    border: 0;
    border-radius: 0;
  }
  .badge.shape-diamond::before {
    content: '';
    position: absolute;
    inset: 4px;
    transform: rotate(45deg);
    border: 2px dashed var(--mark-color);
  }
  .kind {
    font-weight: 600;
  }
  .label {
    overflow-wrap: anywhere;
  }
  .problem-tips ul {
    margin: 0;
    padding-left: var(--space-4);
  }
  .extension {
    margin: 0;
    font-weight: 600;
  }
</style>
