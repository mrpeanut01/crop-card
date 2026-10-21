<script lang="ts">
  import '$lib/cards/print.css';
  import '$lib/journal/photoPrint.css';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { PhotoMarkKind } from '$lib/journal/model';
  import { markGeometry, printMarkLines } from '$lib/journal/printMarks';
  import type { PhotoPrintJob } from '$lib/journal/photoPrintJob.svelte';
  import { DEFAULT_PREFS, formatInstant, type Prefs } from '$lib/prefs';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface Props {
    job: PhotoPrintJob;
    prefs?: Prefs;
    /** Show the sheet on screen (the print dialog's preview). Without it the
     *  sheet only shows when printing. */
    preview?: boolean;
  }

  const { job, prefs = DEFAULT_PREFS, preview = false }: Props = $props();

  const tr = $derived(createT(page.data?.locale));
  const KIND_KEY = {
    cut: 'herbsf.marks.kind.cut',
    pinch: 'herbsf.marks.kind.pinch',
    harvest: 'herbsf.marks.kind.harvest',
    leave: 'herbsf.marks.kind.leave',
    problem: 'herbsh.marks.kind.problem'
  } as const satisfies Record<PhotoMarkKind, string>;

  let size = $state<{ w: number; h: number } | null>(null);
  const photoSrc = $derived(job.src);

  $effect(() => {
    const src = photoSrc;
    size = null;
    if (typeof Image === 'undefined') return;
    const im = new Image();
    let live = true;
    im.onload = () => {
      if (live && im.naturalWidth > 0 && im.naturalHeight > 0) {
        size = { w: im.naturalWidth, h: im.naturalHeight };
      }
    };
    im.src = src;
    return () => {
      live = false;
    };
  });

  const lines = $derived(printMarkLines(job.marks, (k) => tr(KIND_KEY[k])));
  const shapes = $derived(size ? markGeometry(job.marks, size.w, size.h) : []);
  const hasProblem = $derived(job.marks.some((m) => m.kind === 'problem'));
  const tips = $derived(job.problemTips.map((t) => t.trim()).filter(Boolean));
  const showSteps = $derived(job.layout === 'letter' && job.steps.length > 0);
  const showTips = $derived(job.layout === 'letter' && tips.length > 0);
  const stroke = $derived(size ? Math.max(2, Math.min(size.w, size.h) * 0.008) : 2);

  function diamond(cx: number, cy: number, r: number): string {
    return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
  }
</script>

<div
  class="photo-print-sheet layout-{job.layout}"
  class:preview
  class:printing={!preview}
  data-layout={job.layout}
  data-testid={preview ? 'photo-print-preview' : 'photo-print-sheet'}
>
  <article class="sheet-page">
    <header class="head">
      <div class="kicker">{tr('herbsh.print.kicker')}</div>
      <h3 class="title">{job.title}</h3>
      <p class="meta">
        <span
          >{tr('herbsh.print.photoFrom', {
            date: formatInstant(job.takenAt, prefs, 'datetime')
          })}</span
        >
        <Provenance source={job.provenance} />
      </p>
    </header>
    <div class="body">
      <figure class="photo">
        {#if size}
          <svg
            viewBox="0 0 {size.w} {size.h}"
            role="img"
            aria-label={tr('herbsh.print.photoAlt')}
            data-testid="photo-print-figure"
          >
            <image href={job.src} x="0" y="0" width={size.w} height={size.h} />
            {#each shapes as s (s.n)}
              <g class="mark kind-{s.kind}" data-shape={s.shape}>
                {#if s.box}
                  <rect
                    class="area"
                    class:dashed={s.shape === 'diamond'}
                    x={s.box.x}
                    y={s.box.y}
                    width={Math.max(s.box.w, 2)}
                    height={Math.max(s.box.h, 2)}
                    stroke-width={stroke}
                  />
                {/if}
                {#if s.shape === 'diamond'}
                  <polygon
                    class="badge"
                    points={diamond(s.cx, s.cy, s.r * 1.25)}
                    stroke-width={stroke}
                  />
                {:else}
                  <circle class="badge" cx={s.cx} cy={s.cy} r={s.r} stroke-width={stroke} />
                {/if}
                <text
                  x={s.cx}
                  y={s.cy}
                  font-size={s.r * 1.15}
                  text-anchor="middle"
                  dominant-baseline="central"
                  data-testid="photo-print-number">{s.n}</text
                >
              </g>
            {/each}
          </svg>
        {/if}
      </figure>
      <div class="lists">
        <h4>{tr('herbsf.marks.legend')}</h4>
        <ol class="mark-lines" data-testid="photo-print-lines">
          {#each lines as l (l.n)}
            <li data-kind={l.kind}>
              <span
                class="num shape-{l.kind === 'problem' ? 'diamond' : 'circle'}"
                aria-hidden="true">{l.n}</span
              >
              <span class="text"
                >{tr('herbsh.print.line', { kind: tr(KIND_KEY[l.kind]), label: l.label })}</span
              >
            </li>
          {/each}
        </ol>
        {#if showSteps}
          <h4>{tr('herbsf.marks.steps')}</h4>
          <ol class="steps" data-testid="photo-print-steps">
            {#each job.steps as step, i (i)}<li>{step}</li>{/each}
          </ol>
        {/if}
        {#if hasProblem}
          <p class="key">{tr('herbsh.marks.key.problem')}</p>
          {#if showTips}
            <h4>{tr('cards.care.problems')}</h4>
            <ul class="tips">
              {#each tips as tip, i (i)}<li>{tip}</li>{/each}
            </ul>
          {:else if tips.length === 0}
            <p class="extension">{tr('herbsh.marks.extension')}</p>
          {/if}
        {/if}
      </div>
    </div>
    <footer class="foot">
      {#if job.savedCopyAt !== null}
        <span data-testid="photo-print-saved"
          >{tr('herbsh.copy.savedFrom', {
            date: formatInstant(job.savedCopyAt, prefs, 'datetime')
          })}</span
        >
      {/if}
      <span data-testid="photo-print-asof"
        >{tr('cardsui.asOf', { date: formatInstant(job.asOf, prefs, 'datetime') })}</span
      >
    </footer>
  </article>
</div>
