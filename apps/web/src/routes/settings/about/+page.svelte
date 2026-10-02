<script lang="ts">
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import { createT } from '$lib/i18n';
  import {
    BookOpen,
    Camera,
    Carrot,
    Flower2,
    GitFork,
    Heart,
    NotebookPen,
    Package,
    Server,
    Sparkles,
    Sprout,
    Tractor
  } from 'lucide-svelte';

  const { data } = $props();
  const tr = $derived(createT(data.locale));

  const REPO_URL = 'https://github.com/mrpeanut01/crop-card';

  type LucideIcon = typeof Sprout;
  interface Item {
    icon: LucideIcon;
    title: string;
    body: string;
  }

  const farmItems: Item[] = $derived([
    {
      icon: Sparkles,
      title: tr('settings.about.farm.0.title'),
      body: tr('settings.about.farm.0.body')
    },
    {
      icon: NotebookPen,
      title: tr('settings.about.farm.1.title'),
      body: tr('settings.about.farm.1.body')
    },
    {
      icon: Tractor,
      title: tr('settings.about.farm.2.title'),
      body: tr('settings.about.farm.2.body')
    },
    {
      icon: Package,
      title: tr('settings.about.farm.3.title'),
      body: tr('settings.about.farm.3.body')
    }
  ]);

  const gardenItems: Item[] = $derived([
    {
      icon: Carrot,
      title: tr('settings.about.garden.0.title'),
      body: tr('settings.about.garden.0.body')
    },
    {
      icon: Flower2,
      title: tr('settings.about.garden.1.title'),
      body: tr('settings.about.garden.1.body')
    },
    {
      icon: BookOpen,
      title: tr('settings.about.garden.2.title'),
      body: tr('settings.about.garden.2.body')
    },
    {
      icon: Camera,
      title: tr('settings.about.garden.3.title'),
      body: tr('settings.about.garden.3.body')
    }
  ]);
</script>

<svelte:head>
  <title>{tr('settings.about.pageTitle')}</title>
</svelte:head>

<SettingsShell title={tr('settings.about.title')} kicker={tr('settings.about.kicker')}>
  <article class="about">
    <!-- ─── Letter ─────────────────────────────────────────────── -->
    <section class="letter">
      <div class="letter-mark" aria-hidden="true">
        <Sprout size={22} strokeWidth={1.75} />
      </div>
      <div class="letter-kicker">{tr('settings.about.letterKicker')}</div>
      <h2 class="serif">{tr('settings.about.letterTitle')}</h2>

      <div class="letter-body">
        <p>
          {tr('settings.about.p1')}
        </p>
        <p>
          {tr('settings.about.p2')}
        </p>
        <p>
          {tr('settings.about.p3')}
        </p>
        <p>
          {tr('settings.about.p4')}
        </p>
      </div>

      <div class="signature">
        <div class="sig-name serif">{tr('settings.about.sigName')}</div>
        <div class="sig-place">{tr('settings.about.sigPlace')}</div>
      </div>
    </section>

    <!-- ─── On the farm ────────────────────────────────────────── -->
    <section class="block">
      <div class="block-head">
        <div class="block-kicker">{tr('settings.about.farmKicker')}</div>
        <h3 class="serif">{tr('settings.about.farmTitle')}</h3>
      </div>
      <ul class="tiles">
        {#each farmItems as item (item.title)}
          {@const Icon = item.icon}
          <li class="tile">
            <div class="tile-icon" aria-hidden="true"><Icon size={17} strokeWidth={1.75} /></div>
            <div>
              <div class="tile-title">{item.title}</div>
              <p class="tile-body">{item.body}</p>
            </div>
          </li>
        {/each}
      </ul>
    </section>

    <!-- ─── In the garden ──────────────────────────────────────── -->
    <section class="block garden">
      <div class="block-head">
        <div class="block-kicker">{tr('settings.about.gardenKicker')}</div>
        <h3 class="serif">{tr('settings.about.gardenTitle')}</h3>
        <p class="block-lede">
          {tr('settings.about.gardenLede')}
        </p>
      </div>
      <ul class="tiles">
        {#each gardenItems as item (item.title)}
          {@const Icon = item.icon}
          <li class="tile">
            <div class="tile-icon wheat" aria-hidden="true">
              <Icon size={17} strokeWidth={1.75} />
            </div>
            <div>
              <div class="tile-title">{item.title}</div>
              <p class="tile-body">{item.body}</p>
            </div>
          </li>
        {/each}
      </ul>
    </section>

    <!-- ─── Money + open source ────────────────────────────────── -->
    <div class="pair">
      <section class="block note">
        <div class="note-icon" aria-hidden="true"><Server size={18} strokeWidth={1.75} /></div>
        <h3 class="serif">{tr('settings.about.payTitle')}</h3>
        <p>
          {tr('settings.about.payBody')}
          <a href="/pricing">{tr('settings.about.payLink')}</a>.
        </p>
      </section>

      <section class="block note">
        <div class="note-icon" aria-hidden="true"><Heart size={18} strokeWidth={1.75} /></div>
        <h3 class="serif">{tr('settings.about.ossTitle')}</h3>
        <p>
          {tr('settings.about.ossA')}
          <a href="{REPO_URL}/blob/main/LICENSE">{tr('settings.about.ossLink')}</a>{tr(
            'settings.about.ossB'
          )}
        </p>
      </section>
    </div>

    <!-- ─── Contribute ─────────────────────────────────────────── -->
    <section class="contribute">
      <div class="contribute-text">
        <div class="block-kicker light">{tr('settings.about.chairKicker')}</div>
        <h3 class="serif">{tr('settings.about.helpTitle')}</h3>
        <p>
          {tr('settings.about.helpBody')}
        </p>
      </div>
      <div class="contribute-actions">
        <a class="cta primary" href={REPO_URL} target="_blank" rel="noopener noreferrer">
          <GitFork size={16} strokeWidth={1.75} />
          {tr('settings.about.github')}
        </a>
        <a class="cta" href="{REPO_URL}/issues" target="_blank" rel="noopener noreferrer">
          {tr('settings.about.issues')}
        </a>
        <a
          class="cta"
          href="{REPO_URL}/blob/main/CONTRIBUTING.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          {tr('settings.about.contribute')}
        </a>
      </div>
    </section>

    <p class="colophon">{tr('settings.about.colophon')}</p>
  </article>
</SettingsShell>

<style>
  .about {
    max-width: 820px;
    margin: 0 auto;
    color: var(--color-ink-soft);
  }
  .serif {
    color: var(--color-forest-deep);
  }

  /* ── Letter ── */
  .letter {
    position: relative;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    padding: 34px 40px 30px;
    margin-bottom: 18px;
    box-shadow: 0 1px 0 var(--color-divider-soft);
  }
  .letter::before {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: 4px;
    border-radius: 10px 10px 0 0;
    background: linear-gradient(90deg, var(--color-forest) 0%, var(--color-wheat) 100%);
  }
  .letter-mark {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    background: rgba(44, 82, 55, 0.09);
    color: var(--color-forest);
    display: grid;
    place-items: center;
    margin-bottom: 14px;
  }
  .letter-kicker,
  .block-kicker {
    font-size: var(--font-size-kicker);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-wheat);
  }
  .letter h2 {
    margin: 6px 0 18px;
    font-size: var(--font-size-display);
    letter-spacing: -0.02em;
    line-height: 1.05;
  }
  .letter-body p {
    font-family: 'Source Serif 4', 'Source Serif Pro', Georgia, serif;
    font-size: 17px;
    line-height: 1.65;
    color: var(--color-ink);
    margin: 0 0 14px;
  }
  .letter-body p:first-child::first-letter {
    float: left;
    font-size: 54px;
    line-height: 0.9;
    padding: 6px 8px 0 0;
    color: var(--color-forest-deep);
    font-weight: 600;
  }
  .signature {
    margin-top: 22px;
    padding-top: 16px;
    border-top: 1px dashed var(--color-divider);
  }
  .sig-name {
    font-size: 26px;
    font-style: italic;
  }
  .sig-place {
    font-size: 13px;
    color: var(--color-ink-muted);
    margin-top: 2px;
  }

  /* ── Blocks ── */
  .block {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    padding: 22px 24px;
    margin-bottom: 18px;
  }
  .block.garden {
    background: linear-gradient(180deg, rgba(232, 217, 181, 0.35) 0%, var(--color-paper) 55%);
  }
  .block-head h3,
  .note h3,
  .contribute h3 {
    margin: 4px 0 0;
    font-size: var(--font-size-hero);
    letter-spacing: -0.015em;
    line-height: 1.15;
  }
  .block-lede {
    margin: 10px 0 0;
    font-size: 15px;
    line-height: 1.6;
    max-width: 62ch;
  }
  .tiles {
    list-style: none;
    padding: 0;
    margin: 18px 0 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .tile {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 12px;
    align-items: start;
    padding: 14px 16px;
    border: 1px solid var(--color-divider-soft);
    border-radius: 8px;
    background: var(--color-paper);
  }
  .tile-icon {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: rgba(44, 82, 55, 0.08);
    color: var(--color-forest-deep);
    display: grid;
    place-items: center;
  }
  .tile-icon.wheat {
    background: rgba(184, 137, 60, 0.14);
    color: #8a6424;
  }
  .tile-title {
    font-family: 'Source Serif 4', 'Source Serif Pro', Georgia, serif;
    font-size: 16px;
    font-weight: 600;
    color: var(--color-ink);
  }
  .tile-body {
    margin: 4px 0 0;
    font-size: 13.5px;
    line-height: 1.55;
  }

  /* ── Pair of notes ── */
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 18px;
  }
  .pair .block {
    margin-bottom: 0;
  }
  .note h3 {
    font-size: 20px;
  }
  .note p {
    margin: 10px 0 0;
    font-size: 14px;
    line-height: 1.6;
  }
  .note a {
    color: var(--color-forest);
    font-weight: 600;
  }
  .note-icon {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--color-cream);
    border: 1px solid var(--color-divider);
    color: var(--color-forest);
    display: grid;
    place-items: center;
    margin-bottom: 12px;
  }

  /* ── Contribute ── */
  .contribute {
    background: var(--color-forest-deep);
    color: var(--color-cream);
    border-radius: 10px;
    padding: 26px 28px;
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 24px;
    align-items: center;
    margin-bottom: 18px;
  }
  .block-kicker.light {
    color: var(--color-wheat-soft);
  }
  .contribute h3 {
    color: var(--color-paper);
  }
  .contribute p {
    margin: 10px 0 0;
    font-size: 14.5px;
    line-height: 1.6;
    color: rgba(248, 243, 232, 0.88);
  }
  .contribute-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 48px;
    padding: 10px 16px;
    border-radius: var(--radius-input, 6px);
    border: 1px solid rgba(248, 243, 232, 0.35);
    color: var(--color-cream);
    text-decoration: none;
    font-size: 14px;
    font-weight: 600;
    text-align: center;
  }
  .cta:hover {
    border-color: var(--color-cream);
  }
  .cta.primary {
    background: var(--color-cream);
    color: var(--color-forest-deep);
    border-color: var(--color-cream);
  }
  .cta.primary:hover {
    background: var(--color-paper);
  }

  .colophon {
    text-align: center;
    font-size: 12.5px;
    color: var(--color-ink-muted);
    margin: 6px 0 10px;
  }

  @media (max-width: 760px) {
    .letter {
      padding: 26px 20px 22px;
    }
    .letter h2 {
      font-size: var(--font-size-hero);
    }
    .letter-body p {
      font-size: 16px;
    }
    .tiles,
    .pair,
    .contribute {
      grid-template-columns: 1fr;
    }
    .block,
    .contribute {
      padding: 20px 18px;
    }
  }
</style>
