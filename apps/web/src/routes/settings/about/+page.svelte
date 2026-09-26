<script lang="ts">
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
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

  const REPO_URL = 'https://github.com/mrpeanut01/crop-card';

  type LucideIcon = typeof Sprout;
  interface Item {
    icon: LucideIcon;
    title: string;
    body: string;
  }

  const farmItems: Item[] = [
    {
      icon: Sparkles,
      title: 'Planning with a second brain',
      body: 'Claude helps lay out which crop goes in which block, when to sow it, what it needs, and what it should never be planted next to. It looks things up so you do not have to dig through six extension PDFs at the kitchen table.'
    },
    {
      icon: NotebookPen,
      title: 'Notes that stay put',
      body: 'Every spray, scout, planting and harvest is written down once, with a date and a name on it, and it is still there two years later when someone asks.'
    },
    {
      icon: Tractor,
      title: 'Equipment and upkeep',
      body: 'Sprayers, planters and mowers each carry their own calibration, cleanout and winterizing history, so maintenance stops living in your head.'
    },
    {
      icon: Package,
      title: 'Seed and inputs on hand',
      body: 'Know what is in the barn before you order more. Lots, quantities and expiration dates feed straight into next season’s plan.'
    }
  ];

  const gardenItems: Item[] = [
    {
      icon: Carrot,
      title: 'Vegetables and herbs',
      body: 'Plan a raised bed or a backyard plot with the same engine that plans a field, scaled down to square feet.'
    },
    {
      icon: Flower2,
      title: 'Perennials and annuals',
      body: 'Asparagus, rhubarb and berry canes that come back every spring, alongside the tomatoes you start over each year.'
    },
    {
      icon: BookOpen,
      title: 'Care guides',
      body: 'When to water, feed, stake and cut back, written for someone who is learning, not someone who already knows.'
    },
    {
      icon: Camera,
      title: 'Photo help',
      body: 'Snap a picture and ask. Is this ready to pick? Where do I prune? What is wrong with these leaves?'
    }
  ];
</script>

<svelte:head>
  <title>About · CropCard</title>
</svelte:head>

<SettingsShell title="About CropCard" kicker="About">
  <article class="about">
    <!-- ─── Letter ─────────────────────────────────────────────── -->
    <section class="letter">
      <div class="letter-mark" aria-hidden="true">
        <Sprout size={22} strokeWidth={1.75} />
      </div>
      <div class="letter-kicker">A note from the farm</div>
      <h2 class="serif">Why I built this.</h2>

      <div class="letter-body">
        <p>
          When I started farming, I had no idea what I was doing. I knew I wanted to grow things on
          our little piece of Loudoun County, and I was willing to work at it. That was about the
          extent of my qualifications.
        </p>
        <p>
          What I didn’t have was a plan, or any real way of keeping notes. I couldn’t have told you
          how long corn takes to come up, or whether the seed in the barn was from this year or the
          one before. Maintenance on the equipment happened when something broke. Spray records
          lived on a paper field card that got rained on, folded into a truck door pocket, and more
          than once lost for good.
        </p>
        <p>
          CropCard started as a replacement for that paper card. It grew into the thing I wish I’d
          had on day one: somewhere to plan the season, write down what actually happened, keep
          track of the equipment and the seed, and ask a question when I’m standing at the edge of a
          field with bad cell signal and a sprayer that needs filling.
        </p>
        <p>
          The AI in here is meant to help, the way a patient neighbor who happens to have read every
          extension bulletin would help. It suggests; you decide. Everything still works without it.
        </p>
      </div>

      <div class="signature">
        <div class="sig-name serif">Shawn</div>
        <div class="sig-place">Safe Haven Farm · Loudoun County, Virginia</div>
      </div>
    </section>

    <!-- ─── On the farm ────────────────────────────────────────── -->
    <section class="block">
      <div class="block-head">
        <div class="block-kicker">On the farm</div>
        <h3 class="serif">What it does today</h3>
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
        <div class="block-kicker">In the backyard</div>
        <h3 class="serif">Where it’s headed</h3>
        <p class="block-lede">
          Most people who grow food don’t have a tractor. They have a few beds by the back door and
          the same questions I had. The next chapter brings CropCard down to the size of a household
          garden.
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
        <h3 class="serif">Where your subscription goes</h3>
        <p>
          The monthly charge pays for hosting: the server, the database backups, and keeping the
          lights on. Nobody is getting rich here.
        </p>
      </section>

      <section class="block note">
        <div class="note-icon" aria-hidden="true"><Heart size={18} strokeWidth={1.75} /></div>
        <h3 class="serif">Free and open source</h3>
        <p>
          CropCard is released under the <a href="{REPO_URL}/blob/main/LICENSE">MIT License</a>. The
          code is public, you can run your own copy, and your records are always exportable. Your
          farm’s data is yours.
        </p>
      </section>
    </div>

    <!-- ─── Contribute ─────────────────────────────────────────── -->
    <section class="contribute">
      <div class="contribute-text">
        <div class="block-kicker light">Pull up a chair</div>
        <h3 class="serif">Help build it</h3>
        <p>
          I’m one farmer with a to-do list longer than the growing season. If you write code, know
          your way around a plant, or just found something that doesn’t make sense, I’d love the
          help. Open an issue first so we can talk it through, then send a pull request.
        </p>
      </div>
      <div class="contribute-actions">
        <a class="cta primary" href={REPO_URL} target="_blank" rel="noopener noreferrer">
          <GitFork size={16} strokeWidth={1.75} />
          CropCard on GitHub
        </a>
        <a class="cta" href="{REPO_URL}/issues" target="_blank" rel="noopener noreferrer">
          Suggest an idea or report a bug
        </a>
        <a
          class="cta"
          href="{REPO_URL}/blob/main/CONTRIBUTING.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          How to contribute
        </a>
      </div>
    </section>

    <p class="colophon">Grown in Loudoun County, Virginia. Thanks for being here.</p>
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
