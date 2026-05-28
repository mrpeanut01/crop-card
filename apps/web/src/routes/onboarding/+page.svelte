<script lang="ts">
  import { enhance } from '$app/forms';
  import {
    Sparkles,
    Sprout,
    Info,
    Lock,
    Sun,
    ArrowRight,
    Check,
    ChevronRight,
    Layers,
    Tractor,
    Gauge,
    Leaf,
    Wheat
  } from 'lucide-svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let farmNameInput = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (!data.progress) farmNameInput?.focus();
  });

  const WITHOUT_KEY_CAPABILITIES = [
    '308 plugins',
    'calibration math',
    'safety kernel',
    'calendar derivations',
    'CSV import'
  ];

  // #110 — 6-step setup wizard (Phase 25 Almanac). Steps are defined
  // statically; each `done` derives from live DB state in the loader
  // (#115 — progress persistence is implicit, not a separate store).
  type StepIcon =
    | typeof Sun
    | typeof Layers
    | typeof Tractor
    | typeof Gauge
    | typeof Leaf
    | typeof Wheat;
  interface Step {
    id: keyof NonNullable<PageData['progress']>;
    label: string;
    detail: string;
    href: string;
    icon: StepIcon;
  }
  const STEPS: Step[] = [
    {
      id: 'farm',
      label: 'Name your farm + home field',
      detail: 'Sets your tenant + the default field that holds your blocks.',
      href: '/onboarding',
      icon: Sun
    },
    {
      id: 'season',
      label: 'Pick this season’s philosophy',
      detail: 'Six quick questions — drives what the planner suggests.',
      href: '/settings/season',
      icon: Leaf
    },
    {
      id: 'block',
      label: 'Add your first block',
      detail: 'A planted area inside your field. Geometry optional but unlocks pollination.',
      href: '/plan',
      icon: Layers
    },
    {
      id: 'sprayer',
      label: 'Add a sprayer',
      detail: 'Backpack, tow-behind, or boom — whatever you actually use.',
      href: '/inventory/sprayer/add',
      icon: Tractor
    },
    {
      id: 'calibration',
      label: 'Calibrate the sprayer (UC-10)',
      detail: '1/128-acre method. Without this, dilution math has no anchor.',
      href: '/calibrate',
      icon: Gauge
    },
    {
      id: 'planting',
      label: 'Add your first planting',
      detail: 'Variety + block + date. From here the calendar drives every other surface.',
      href: '/plan',
      icon: Wheat
    }
  ];

  const doneCount = $derived(data.progress ? STEPS.filter((s) => data.progress![s.id]).length : 0);
  const totalSteps = STEPS.length;
  const pct = $derived(Math.round((doneCount / totalSteps) * 100));
  const minutesLeft = $derived(Math.max(0, 15 - Math.round((pct / 100) * 15)));
  const currentStep = $derived(
    data.progress ? (STEPS.find((s) => !data.progress![s.id]) ?? null) : STEPS[0]
  );

  const TIPS = [
    {
      text: 'Each step opens its own page; you can leave and come back. Progress saves automatically.'
    },
    {
      text: 'Blocks without GeoJSON still work — you can paste coordinates later from the map editor.'
    },
    {
      text: 'Helpers (read-mostly logins) come in Settings → Helpers. Skip for now if you farm solo.'
    }
  ];
</script>

<svelte:head>
  <title>Set up your farm — CropCard</title>
</svelte:head>

<main class="ob-wrap">
  {#if !data.progress}
    <!-- ─── Step 0: farm creation form ───────────────────────────────── -->
    <header class="intro">
      <div class="kicker-row">
        <Sun size={12} strokeWidth={2} aria-hidden="true" /> FIRST-RUN SETUP
      </div>
      <h1 class="serif">Welcome, {data.firstName}.</h1>
      <p class="lede">
        Six small steps to turn your paper field card into a working record system. About
        <strong>fifteen minutes</strong>. You can leave and come back &mdash; your progress saves
        automatically.
      </p>
    </header>

    {#if form?.error}
      <p class="error" role="alert">{form.error}</p>
    {/if}

    <Card>
      <h2 class="serif sub">Start with your farm</h2>
      <form method="POST" use:enhance class="form">
        <label class="row">
          <span class="lbl">Farm name <em>*</em></span>
          <input
            type="text"
            name="farmName"
            required
            autocomplete="organization"
            placeholder="e.g., Hilltop Acres"
            bind:this={farmNameInput}
          />
        </label>
        <label class="row">
          <span class="lbl">Location <em class="opt">(optional)</em></span>
          <input
            type="text"
            name="location"
            autocomplete="street-address"
            placeholder="e.g., Loudoun County, VA &mdash; paste lat/lng if you have it"
          />
        </label>
        <button class="submit" type="submit">Create farm <ArrowRight size={14} /></button>
      </form>
    </Card>
  {:else}
    <!-- ─── Re-entrant wizard view ───────────────────────────────────── -->
    <header class="hero-row">
      <div class="hero-left">
        <div class="kicker-row">
          <Sun size={12} strokeWidth={2} aria-hidden="true" /> FIRST-RUN SETUP
        </div>
        <h1 class="serif">Welcome, {data.firstName}.</h1>
        <p class="lede">
          Six small steps to turn your paper field card into a working record system. About
          <strong>fifteen minutes</strong>. You can leave and come back &mdash; your progress saves
          automatically.
        </p>
      </div>
      <!-- #114 — progress ring (SVG donut) -->
      <div class="ring-card">
        <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
          <circle
            cx="60"
            cy="60"
            r="50"
            fill="none"
            stroke="var(--color-divider-soft, var(--color-divider))"
            stroke-width="10"
          />
          <circle
            cx="60"
            cy="60"
            r="50"
            fill="none"
            stroke="var(--color-forest)"
            stroke-width="10"
            stroke-dasharray="{(pct / 100) * 314.16} 314.16"
            stroke-linecap="round"
            transform="rotate(-90 60 60)"
          />
          <text
            x="60"
            y="58"
            text-anchor="middle"
            font-size="28"
            font-weight="700"
            font-family="var(--font-serif, serif)"
            fill="var(--color-forest-deep)">{doneCount}</text
          >
          <text
            x="60"
            y="76"
            text-anchor="middle"
            font-size="11"
            fill="var(--color-ink-muted)"
            font-family="var(--font-sans, sans-serif)">of {totalSteps}</text
          >
        </svg>
        <div class="ring-farm">{data.farmName}</div>
        <div class="ring-est">
          est. {pct < 100 ? `${minutesLeft} min left` : 'complete'}
        </div>
      </div>
    </header>

    <div class="grid">
      <!-- Step cards -->
      <section>
        <h2 class="serif sub">Your setup</h2>
        <div class="steps">
          {#each STEPS as s, i (s.id)}
            {@const done = data.progress![s.id]}
            {@const isCurrent = currentStep?.id === s.id}
            <div class="step" class:done class:current={isCurrent}>
              <span class="circle" aria-hidden="true">
                {#if done}<Check size={13} />{:else}{i + 1}{/if}
              </span>
              <div class="step-icon">
                <s.icon size={17} strokeWidth={1.75} />
              </div>
              <div class="step-body">
                <div class="serif step-label">{s.label}</div>
                <div class="step-detail">{s.detail}</div>
              </div>
              {#if isCurrent}
                <a class="primary" href={s.href}>
                  Start <ArrowRight size={13} />
                </a>
              {:else if !done}
                <a class="ghost" href={s.href}>Open</a>
              {:else}
                <a class="done-edit" href={s.href}>Edit &rarr;</a>
              {/if}
            </div>
          {/each}
        </div>

        <!-- #118 — CSV import skip strip -->
        <a class="skip-strip" href="/today">
          <ChevronRight size={13} aria-hidden="true" />
          <span>
            Already set up your blocks in a spreadsheet?
            <strong>Skip ahead and import a CSV &rarr;</strong>
          </span>
        </a>
      </section>

      <!-- Right rail: AI offer + Shortcuts + Why these six -->
      <aside class="rail">
        <Card>
          <div class="offer-head">
            <div class="offer-icon" aria-hidden="true">
              <Sparkles size={16} strokeWidth={1.75} />
            </div>
            <div class="offer-title">
              <h3 class="serif">Planning assistant &middot; optional</h3>
              <p class="offer-sub">bring-your-own Claude key &middot; capped spend</p>
            </div>
            <Provenance source="ai" compact />
          </div>
          <p class="offer-body">
            Want Claude to seed a sample farm with mock blocks, scout history, and a starter plan
            you can edit? Or paste an API key to enable AI proposals later &mdash; every screen
            works without one.
          </p>
          <div class="offer-info">
            <Info size={13} strokeWidth={1.75} aria-hidden="true" />
            <span>
              <strong>Without a key:</strong>
              {WITHOUT_KEY_CAPABILITIES.join(' · ')} &mdash; all still work.
              <em>AI only assists; never gates.</em>
            </span>
          </div>
          <!-- #117 — CTA copy: "Seed a sample plan with Claude" -->
          <a class="primary full" href="/settings/ai">
            <Sprout size={13} aria-hidden="true" /> Seed a sample plan with Claude
          </a>
          <a class="ghost full" href="/today"> Skip &middot; I'll add a key later (or never) </a>
        </Card>

        <!-- #116a — Shortcuts -->
        <Card>
          <Kicker>Shortcuts</Kicker>
          <ul class="tips">
            {#each TIPS as t (t.text)}
              <li>
                <span class="bullet" aria-hidden="true"></span>
                <span>{t.text}</span>
              </li>
            {/each}
          </ul>
        </Card>

        <!-- #116b — Why these six -->
        <div class="why-card">
          <Kicker>Why these six</Kicker>
          <p>
            Every CropCard feature roots in three primitives: <strong>blocks</strong> (where you
            grow), <strong>plantings</strong> (what's in them), and <strong>sprayers</strong> (calibrated
            equipment). Once those three exist, the calendar drives everything else &mdash; today's tasks,
            harvest windows, decon alerts, audit-ready records.
          </p>
          <a class="why-link" href="/today">
            Read the 2-min explainer <ArrowRight size={12} />
          </a>
        </div>
      </aside>
    </div>
  {/if}

  <footer class="reassurance">
    <Lock size={11} strokeWidth={1.75} aria-hidden="true" />
    <span>
      Your data lives on your device first; sync to the cloud is opt-in. You can delete the sample
      plan any time from Settings.
    </span>
  </footer>
</main>

<style>
  .ob-wrap {
    max-width: 1080px;
    margin: 32px auto 40px;
    padding: 0 28px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  /* Step-0 (no-farm-yet) tweaks */
  .intro {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 620px;
  }
  .kicker-row {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--color-ink-muted);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 700;
  }
  .kicker-row :global(svg) {
    color: var(--color-wheat, #d4a75c);
  }
  h1.serif {
    margin: 0;
    font-size: 44px;
    line-height: 1.05;
    color: var(--color-forest-deep);
    letter-spacing: -0.025em;
  }
  .lede {
    font-size: 15px;
    color: var(--color-ink-soft);
    line-height: 1.55;
    margin: 0;
    max-width: 540px;
  }
  .sub {
    margin: 0 0 14px;
    font-size: 18px;
    color: var(--color-forest-deep);
    letter-spacing: -0.01em;
  }
  .error {
    background: var(--pill-rust-bg);
    border: 1px solid var(--pill-rust-bd);
    color: var(--pill-rust-fg);
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin: 0;
  }
  .form {
    display: grid;
    gap: 1rem;
  }
  .row {
    display: grid;
    gap: 0.375rem;
  }
  .lbl {
    font-weight: 600;
  }
  .opt {
    color: var(--color-ink-muted);
    font-style: normal;
    font-weight: 400;
  }
  em {
    color: var(--color-rust);
    font-style: normal;
  }
  input[type='text'] {
    font: inherit;
    padding: 0.75rem 0.875rem;
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    min-height: 48px;
  }
  input[type='text']:focus-visible {
    outline: 2px solid var(--color-forest);
    outline-offset: 2px;
  }
  .submit {
    margin-top: 0.5rem;
    min-height: 48px;
    padding: 0.75rem 1.25rem;
    background: var(--color-forest);
    color: var(--color-cream);
    border: none;
    border-radius: 6px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    justify-content: center;
  }
  /* Wizard hero */
  .hero-row {
    display: grid;
    grid-template-columns: 1.5fr 1fr;
    gap: 30px;
    align-items: center;
  }
  .hero-left {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ring-card {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: 14px;
    padding: 22px;
    text-align: center;
  }
  .ring-farm {
    font-size: 13px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .ring-est {
    font-size: 11.5px;
    color: var(--color-ink-muted);
    margin-top: 2px;
  }
  /* Grid */
  .grid {
    display: grid;
    grid-template-columns: 1.6fr 1fr;
    gap: 18px;
  }
  /* Step cards */
  .steps {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .step {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    padding: 16px 18px;
    display: grid;
    grid-template-columns: auto 36px 1fr auto;
    gap: 14px;
    align-items: center;
  }
  .step.done {
    background: var(--color-cream);
    opacity: 0.85;
  }
  .step.current {
    border-color: var(--color-forest);
    border-left: 4px solid var(--color-forest);
    padding-left: 15px;
  }
  .circle {
    width: 26px;
    height: 26px;
    border-radius: 999px;
    background: var(--color-paper);
    border: 1.5px solid var(--color-divider);
    color: var(--color-ink-muted);
    display: grid;
    place-items: center;
    font-size: 12px;
    font-weight: 700;
  }
  .step.done .circle {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: var(--color-cream);
  }
  .step.current .circle {
    background: var(--color-wheat, #d4a75c);
    border-color: var(--color-wheat, #d4a75c);
    color: var(--color-cream);
  }
  .step-icon {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: var(--color-cream);
    color: var(--color-ink-muted);
    display: grid;
    place-items: center;
  }
  .step.current .step-icon {
    background: var(--color-forest-tint, #e5eedf);
    color: var(--color-forest);
  }
  .step-label {
    font-size: 15.5px;
    color: var(--color-ink);
    letter-spacing: -0.01em;
  }
  .step.done .step-label {
    color: var(--color-ink-soft);
  }
  .step-detail {
    font-size: 12.5px;
    color: var(--color-ink-muted);
    margin-top: 3px;
    line-height: 1.4;
  }
  .primary,
  .ghost,
  .done-edit {
    text-decoration: none;
    font-weight: 600;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: inherit;
    cursor: pointer;
  }
  .primary {
    background: var(--color-forest);
    color: var(--color-cream);
    padding: 9px 14px;
    font-size: 13.5px;
    border: none;
  }
  .primary:hover {
    filter: brightness(1.1);
  }
  .ghost {
    background: var(--color-paper);
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
    padding: 8px 12px;
    font-size: 13px;
  }
  .ghost:hover {
    border-color: var(--color-forest-deep);
  }
  .full {
    width: 100%;
    justify-content: center;
    padding: 10px 14px;
    margin-top: 4px;
  }
  .ghost.full {
    margin-top: 8px;
  }
  .done-edit {
    font-size: 12.5px;
    color: var(--color-forest);
    font-weight: 600;
  }
  /* Skip strip */
  .skip-strip {
    margin-top: 16px;
    padding: 12px 14px;
    background: var(--color-paper);
    border: 1px dashed var(--color-divider);
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12.5px;
    color: var(--color-ink-soft);
    text-decoration: none;
  }
  .skip-strip strong {
    color: var(--color-forest);
    font-weight: 600;
  }
  /* Rail */
  .rail {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .offer-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .offer-icon {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: var(--color-forest);
    color: var(--color-cream);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .offer-title {
    flex: 1;
  }
  .offer-title h3 {
    margin: 0;
    font-size: 14px;
    color: var(--color-forest-deep);
    font-weight: 600;
  }
  .offer-sub {
    margin: 2px 0 0;
    font-size: 10.5px;
    color: var(--color-ink-muted);
  }
  .offer-body {
    margin: 0 0 10px;
    font-size: 12.5px;
    color: var(--color-ink-soft);
    line-height: 1.5;
  }
  .offer-info {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    padding: 8px 10px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft);
    border-radius: 5px;
    font-size: 11px;
    color: var(--color-ink-soft);
    line-height: 1.45;
    margin-bottom: 10px;
  }
  .offer-info :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
  }
  .offer-info strong {
    color: var(--color-forest-deep);
  }
  .offer-info em {
    color: var(--color-ink-muted);
    font-style: italic;
  }
  /* Tips */
  .tips {
    list-style: none;
    padding: 0;
    margin: 12px 0 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tips li {
    display: flex;
    gap: 9px;
    align-items: flex-start;
    font-size: 12.5px;
    color: var(--color-ink-soft);
    line-height: 1.5;
  }
  .bullet {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--color-wheat, #d4a75c);
    margin-top: 7px;
    flex-shrink: 0;
  }
  /* Why card */
  .why-card {
    background: var(--color-cream);
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    padding: 16px 18px;
  }
  .why-card p {
    margin: 10px 0 0;
    font-size: 12.5px;
    color: var(--color-ink-soft);
    line-height: 1.55;
  }
  .why-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: 12px;
    font-size: 12.5px;
    color: var(--color-forest);
    font-weight: 600;
    text-decoration: none;
  }
  /* Footer */
  .reassurance {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 14px 0 0;
    border-top: 1px solid var(--color-divider);
    font-size: 11.5px;
    color: var(--color-ink-muted);
    line-height: 1.5;
  }
  @media (max-width: 900px) {
    .hero-row {
      grid-template-columns: 1fr;
    }
    .grid {
      grid-template-columns: 1fr;
    }
    h1.serif {
      font-size: 32px;
    }
  }
</style>
