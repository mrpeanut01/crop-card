<script lang="ts">
  import { createT } from '$lib/i18n';
  import type { MessageKey } from '$lib/i18n';
  import { page } from '$app/state';

  const { data } = $props();
  const tr = $derived(createT(page.data?.locale));

  const STEPS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
  const TRACKS = ['garden', 'fields'] as const;
  const WORDS = [
    'frost',
    'bed',
    'block',
    'succession',
    'rotation',
    'cover',
    'scouting',
    'calibration',
    'phi',
    'rei',
    'withdrawal',
    'extension'
  ] as const;

  type Track = (typeof TRACKS)[number];
  type Step = (typeof STEPS)[number];
  const stepKey = (track: Track, n: Step, part: 'title' | 'body' | 'app'): MessageKey =>
    `start.${track}.s${n}.${part}`;
</script>

<svelte:head>
  <title>{tr('start.title')}</title>
  <meta name="description" content={tr('start.description')} />
</svelte:head>

<main class="start" aria-labelledby="start-title">
  {#if !data.signedIn}
    <nav class="top">
      <a href="/" class="home" aria-label={tr('start.homeAria')}>CropCard</a>
    </nav>
  {/if}

  <header class="hero">
    <p class="kicker">{tr('start.kicker')}</p>
    <h1 id="start-title">{tr('start.h1')}</h1>
    <p class="lede">{tr('start.lede')}</p>
  </header>

  <nav class="pick" aria-label={tr('start.pickAria')}>
    {#each TRACKS as track (track)}
      <a href="#{track}" class="pick-card" data-testid="pick-{track}">
        <strong>{tr(`start.pick.${track}`)}</strong>
        <span>{tr(`start.pick.${track}Sub`)}</span>
      </a>
    {/each}
  </nav>

  <div class="tracks">
    {#each TRACKS as track (track)}
      <section class="track" id={track} aria-labelledby="{track}-title" data-testid="track-{track}">
        <h2 id="{track}-title">{tr(`start.${track}.title`)}</h2>
        <p class="track-lede">{tr(`start.${track}.lede`)}</p>
        <ol class="steps">
          {#each STEPS as n (n)}
            <li>
              <h3>{tr(stepKey(track, n, 'title'))}</h3>
              <p>{tr(stepKey(track, n, 'body'))}</p>
              <p class="in-app">
                <strong>{tr('start.inApp')}</strong>
                {tr(stepKey(track, n, 'app'))}
              </p>
            </li>
          {/each}
        </ol>
      </section>
    {/each}
  </div>

  <p class="local">{tr('start.local')}</p>

  <section class="words" aria-labelledby="words-title">
    <h2 id="words-title">{tr('start.words.title')}</h2>
    <dl>
      {#each WORDS as w (w)}
        <div class="word">
          <dt>{tr(`start.words.${w}.term`)}</dt>
          <dd>{tr(`start.words.${w}.def`)}</dd>
        </div>
      {/each}
    </dl>
  </section>

  <section class="cta" aria-labelledby="cta-title">
    {#if data.signedIn}
      <h2 id="cta-title">{tr('start.cta.signedInTitle')}</h2>
      <p>{tr('start.cta.signedInBody')}</p>
      <div class="cta-row">
        <a class="btn primary" href="/today">{tr('start.cta.today')}</a>
      </div>
    {:else}
      <h2 id="cta-title">{tr('start.cta.title')}</h2>
      <p>{tr('start.cta.body')}</p>
      <div class="cta-row">
        <a class="btn primary" href="/#signin-title">{tr('start.cta.start')}</a>
        <a class="btn" href="/#demo-farm">{tr('start.cta.demo')}</a>
        <a class="btn" href="/pricing">{tr('start.cta.pricing')}</a>
      </div>
    {/if}
  </section>
</main>

<style>
  .start {
    max-width: 1040px;
    margin: 0 auto;
    padding: 16px 16px 48px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    color: var(--color-ink, #1a1f1a);
    box-sizing: border-box;
    width: 100%;
    overflow-wrap: anywhere;
  }
  .top {
    display: flex;
  }
  .home {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    font-family: var(--font-serif, serif);
    font-size: 20px;
    font-weight: 600;
    color: var(--color-forest-deep, #1f3a28);
    text-decoration: none;
  }
  .hero {
    text-align: center;
  }
  .kicker {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-ink-soft, #4a4f46);
  }
  h1 {
    margin: 6px 0 8px;
    font-family: var(--font-serif, serif);
    font-size: clamp(28px, 5vw, 40px);
    line-height: 1.15;
    color: var(--color-forest-deep, #1f3a28);
  }
  .lede {
    margin: 0 auto;
    max-width: 640px;
    font-size: 16px;
    line-height: 1.55;
    color: var(--color-ink-soft, #4a4f46);
  }
  .pick {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .pick-card {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    min-height: 64px;
    padding: 12px 16px;
    border: 1px solid #c4dcb6;
    border-radius: 12px;
    background: #eaf3e4;
    color: #1d3a24;
    text-decoration: none;
  }
  .pick-card strong {
    font-size: 17px;
  }
  .pick-card span {
    font-size: 14px;
    color: #3d4742;
  }
  .pick-card:hover {
    border-color: #1f5e3a;
  }
  .tracks {
    display: grid;
    grid-template-columns: 1fr;
    gap: 24px;
    align-items: start;
  }
  @media (min-width: 860px) {
    .pick,
    .tracks {
      grid-template-columns: 1fr 1fr;
    }
  }
  .track {
    min-width: 0;
    padding: 20px;
    border: 1px solid var(--color-divider, #d9cfb7);
    border-radius: 14px;
    background: #fff;
    scroll-margin-top: 72px;
  }
  h2 {
    margin: 0 0 6px;
    font-family: var(--font-serif, serif);
    font-size: 24px;
    color: var(--color-forest-deep, #1f3a28);
  }
  .track-lede {
    margin: 0 0 16px;
    font-size: 15px;
    color: var(--color-ink-soft, #4a4f46);
  }
  .steps {
    list-style: none;
    counter-reset: step;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 20px;
  }
  .steps li {
    counter-increment: step;
    position: relative;
    padding-left: 44px;
  }
  .steps li::before {
    content: counter(step);
    position: absolute;
    left: 0;
    top: 0;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #1f5e3a;
    color: #fff;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  h3 {
    margin: 4px 0;
    font-size: 17px;
    line-height: 1.3;
    color: #14422a;
  }
  .steps p {
    margin: 0 0 8px;
    font-size: 15px;
    line-height: 1.55;
  }
  .steps .in-app {
    margin: 0;
    padding: 8px 12px;
    border-radius: 8px;
    background: #f4f8f3;
    border: 1px solid #d6ddd6;
    color: #3d4742;
    font-size: 14.5px;
  }
  .in-app strong {
    color: #1f5e3a;
  }
  .local {
    margin: 0;
    font-size: 14.5px;
    line-height: 1.5;
    color: var(--color-ink-soft, #4a4f46);
    text-align: center;
  }
  dl {
    margin: 8px 0 0;
    display: grid;
    grid-template-columns: 1fr;
    gap: 0 32px;
  }
  @media (min-width: 720px) {
    dl {
      grid-template-columns: 1fr 1fr;
    }
  }
  .word {
    padding: 10px 0;
    border-bottom: 1px solid var(--color-divider, #d9cfb7);
  }
  dt {
    font-weight: 700;
    color: #14422a;
  }
  dd {
    margin: 2px 0 0;
    font-size: 15px;
    line-height: 1.5;
    color: var(--color-ink-soft, #4a4f46);
  }
  .cta {
    padding: 24px 20px;
    border-radius: 14px;
    background: #eaf3e4;
    border: 1px solid #c4dcb6;
    text-align: center;
  }
  .cta p {
    margin: 0 0 16px;
    line-height: 1.5;
  }
  .cta-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 20px;
    border-radius: 10px;
    border: 1px solid #1f5e3a;
    background: #fff;
    color: #1f5e3a;
    font-weight: 700;
    text-decoration: none;
  }
  .btn.primary {
    background: #1f5e3a;
    color: #fff;
  }
  @media (max-width: 480px) {
    .cta-row {
      flex-direction: column;
    }
  }
</style>
