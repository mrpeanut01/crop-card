<script lang="ts">
  import { enhance } from '$app/forms';
  import { afterNavigate, goto, invalidateAll } from '$app/navigation';
  import { browser } from '$app/environment';
  import { untrack } from 'svelte';
  import {
    ArrowLeft,
    ArrowRight,
    Check,
    CloudSun,
    Crosshair,
    Gauge,
    Info,
    Layers,
    Leaf,
    Lock,
    MapPin,
    Sparkles,
    Sun,
    Tractor,
    Wheat
  } from 'lucide-svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import { fmt } from '$lib/prefsState.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import FarmMapEditor from '$lib/components/farm/FarmMapEditor.svelte';
  import SeasonSetupStep from '$lib/components/SeasonSetupStep.svelte';
  import PlanningYearPicker from '$lib/components/PlanningYearPicker.svelte';
  import LocationPicker from '$lib/components/onboarding/LocationPicker.svelte';
  import ImplementPicker from '$lib/components/onboarding/ImplementPicker.svelte';
  import {
    ONBOARDING_STEPS,
    basicsComplete,
    doneCount,
    nextAfter,
    previousStep,
    type OnboardingStepId
  } from '$lib/onboarding/steps';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const ICONS: Record<OnboardingStepId, typeof Sun> = {
    farm: Sun,
    location: MapPin,
    fields: Layers,
    implements: Tractor,
    season: Leaf,
    plan: Wheat
  };

  function headings(
    firstName: string,
    seasonYear: number
  ): Record<OnboardingStepId, { kicker: string; title: string; lede: string }> {
    return {
      farm: {
        kicker: 'Farm basics · 1 of 4',
        title: `Welcome, ${firstName}.`,
        lede: 'We’ll set up the farm itself first: where it is, what your fields look like and what equipment you run. Then we’ll plan a season on top of it. Plan on about fifteen minutes, and you can stop at any point.'
      },
      location: {
        kicker: 'Farm basics · 2 of 4',
        title: 'Where is the farm?',
        lede: 'Your location sets the weather feed, spray windows, sunrise and sunset for the pollinator gate, and where the field map opens.'
      },
      fields: {
        kicker: 'Farm basics · 3 of 4',
        title: 'Draw your fields and blocks.',
        lede: 'A field is the ground you farm. Blocks are the pieces inside it that you plant, spray and harvest as a unit. Draw at least one block to continue.'
      },
      implements: {
        kicker: 'Farm basics · 4 of 4',
        title: 'What do you run?',
        lede: 'Pick the implements on the farm. Sprayers carry chemistry and decon history, and the rest attach their pre-use checks to scheduled tasks.'
      },
      season: {
        kicker: `Your season · ${seasonYear}`,
        title: `How do you want to farm in ${seasonYear}?`,
        lede: 'Six quick questions. The answers decide which products the planner will suggest and which it filters out.'
      },
      plan: {
        kicker: 'Your season · ready',
        title: 'Your farm is set up.',
        lede: 'Next comes the season plan: pick crops, place them in blocks and let the calendar lay out the work.'
      }
    };
  }

  const yearNow = Number(fmt.today().slice(0, 4));
  const heading = $derived(
    headings(data.firstName, data.season?.currentYear ?? yearNow)[data.step]
  );
  const unlocked = $derived(basicsComplete(data.progress));
  const done = $derived(doneCount(data.progress));
  const next = $derived(nextAfter(data.step, data.progress));
  const back = $derived(previousStep(data.step));

  function stepHref(id: OnboardingStepId) {
    return `/onboarding?step=${id}`;
  }

  // ─── Location step ─────────────────────────────────────────────────────
  let lat = $state<number | null>(untrack(() => data.location?.current?.lat ?? null));
  let lon = $state<number | null>(untrack(() => data.location?.current?.lon ?? null));
  let geoBusy = $state(false);
  let geoError = $state<string | null>(null);
  // Steps share this component, so re-seed when navigating into the location
  // step. Skipped on first load so hydration can't clobber typed values.
  afterNavigate((nav) => {
    if (nav.type === 'enter' || data.step !== 'location') return;
    lat = data.location?.current?.lat ?? null;
    lon = data.location?.current?.lon ?? null;
    geoError = null;
  });

  function mmddToDate(mmdd: string | null | undefined): string {
    return mmdd ? `${yearNow}-${mmdd}` : '';
  }
  function prettyMmDd(mmdd: string): string {
    return fmt.day(`${yearNow}-${mmdd}`, 'month-day');
  }

  function useMyLocation() {
    if (!browser || !navigator.geolocation) {
      geoError = 'This browser can’t share its location. Tap the map instead.';
      return;
    }
    geoBusy = true;
    geoError = null;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        lat = Number(pos.coords.latitude.toFixed(5));
        lon = Number(pos.coords.longitude.toFixed(5));
        geoBusy = false;
      },
      (err) => {
        geoBusy = false;
        geoError =
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was declined. Tap the map or type coordinates instead.'
            : 'Couldn’t get a GPS fix. Tap the map or type coordinates instead.';
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  // ─── Implements step ───────────────────────────────────────────────────
  let pickedCount = $state(0);
  const ownedCount = $derived(data.implements?.owned.length ?? 0);

  // ─── Season step ───────────────────────────────────────────────────────
  async function onSeasonSaved() {
    await invalidateAll();
    await goto(stepHref('plan'));
  }

  let submitting = $state(false);
  const submitEnhance = () => {
    submitting = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      submitting = false;
    };
  };
</script>

<svelte:head>
  <title>Set up your farm · CropCard</title>
</svelte:head>

<main class="ob-wrap">
  <header class="intro">
    <div class="kicker-row">
      <Sun size={12} strokeWidth={2} aria-hidden="true" />
      {heading.kicker}
    </div>
    <h1 class="serif">{heading.title}</h1>
    <p class="lede">{heading.lede}</p>
  </header>

  <div class="layout">
    <!-- Step rail -->
    <nav class="rail" aria-label="Setup steps">
      {#if data.farmName}
        <div class="rail-farm">
          <span class="rail-farm-name">{data.farmName}</span>
          <span class="rail-farm-count">{done} of {ONBOARDING_STEPS.length} done</span>
        </div>
      {/if}
      {#each [{ phase: 'basics', label: 'Farm basics' }, { phase: 'season', label: 'Your season' }] as ph (ph.phase)}
        <div class="rail-phase">
          {ph.label}
          {#if ph.phase === 'season' && !unlocked}
            <Lock size={11} aria-label="Opens after farm basics" />
          {/if}
        </div>
        <ol class="rail-steps">
          {#each ONBOARDING_STEPS.filter((s) => s.phase === ph.phase) as s (s.id)}
            {@const isDone = data.progress[s.id]}
            {@const isCurrent = data.step === s.id}
            {@const reachable =
              data.progress.farm && s.id !== 'farm' && (s.phase === 'basics' || unlocked)}
            {@const Icon = ICONS[s.id]}
            <li class:done={isDone} class:current={isCurrent} class:locked={!reachable && !isDone}>
              {#if reachable && !isCurrent}
                <a href={stepHref(s.id)} class="rail-link">
                  <span class="dot" aria-hidden="true">
                    {#if isDone}<Check size={12} />{:else}<Icon size={13} />{/if}
                  </span>
                  <span class="rail-text">
                    <span class="rail-title">{s.title}</span>
                    {#if isDone}<span class="sr-only">(done)</span>{/if}
                  </span>
                </a>
              {:else}
                <span class="rail-link" aria-current={isCurrent ? 'step' : undefined}>
                  <span class="dot" aria-hidden="true">
                    {#if isDone}<Check size={12} />{:else}<Icon size={13} />{/if}
                  </span>
                  <span class="rail-text">
                    <span class="rail-title">{s.title}</span>
                    {#if isDone}<span class="sr-only">(done)</span>{/if}
                  </span>
                </span>
              {/if}
            </li>
          {/each}
        </ol>
      {/each}
    </nav>

    <section class="panel">
      {#if form && 'error' in form && form.error}
        <p class="error" role="alert">{form.error}</p>
      {/if}
      {#if data.progress.farm && !data.canEdit}
        <p class="notice" role="status">
          Only the farm owner can change the setup. You can look around, but changes are disabled.
        </p>
      {/if}

      <!-- ─── 1. Farm ─────────────────────────────────────────────────── -->
      {#if data.step === 'farm'}
        <Card>
          <h2 class="serif sub">Start with your farm</h2>
          <form method="POST" action="?/farm" use:enhance={submitEnhance} class="form">
            <label class="row">
              <span class="lbl">Farm name <em>*</em></span>
              <!-- svelte-ignore a11y_autofocus -->
              <input
                type="text"
                name="farmName"
                required
                maxlength="120"
                autocomplete="organization"
                placeholder="e.g., Hilltop Acres"
                autofocus
              />
            </label>
            <label class="row">
              <span class="lbl">Nearest town or address <em class="opt">(optional)</em></span>
              <input
                type="text"
                name="location"
                autocomplete="street-address"
                placeholder="e.g., Purcellville, VA"
              />
            </label>
            {#if data.planningYear}
              <PlanningYearPicker view={data.planningYear} name="planningYear" />
            {/if}
            <div class="actions">
              <button class="primary" type="submit" disabled={submitting}>
                Create farm <ArrowRight size={15} />
              </button>
            </div>
          </form>
        </Card>
        <div class="roadmap">
          <h2 class="serif sub">What we’ll cover</h2>
          <ol>
            {#each ONBOARDING_STEPS as s, i (s.id)}
              {@const Icon = ICONS[s.id]}
              <li>
                <span class="rm-num">{i + 1}</span>
                <Icon size={16} aria-hidden="true" />
                <span><strong>{s.title}.</strong> {s.summary}</span>
              </li>
            {/each}
          </ol>
        </div>

        <!-- ─── 2. Location ───────────────────────────────────────────── -->
      {:else if data.step === 'location' && data.location}
        <form method="POST" action="?/location" use:enhance={submitEnhance} class="form">
          <Card>
            <div class="loc-head">
              <h2 class="serif sub">Drop a pin on the farm</h2>
              <button
                type="button"
                class="ghost"
                onclick={useMyLocation}
                disabled={geoBusy || !data.canEdit}
              >
                <Crosshair size={15} aria-hidden="true" />
                {geoBusy ? 'Finding you…' : 'Use my current location'}
              </button>
            </div>
            {#if geoError}<p class="hint warn" role="status">{geoError}</p>{/if}
            {#if browser}
              <LocationPicker
                {lat}
                {lon}
                fallback={data.location.fallback}
                onPick={(la, lo) => {
                  lat = la;
                  lon = lo;
                }}
              />
            {:else}
              <div class="map-loading">Loading map…</div>
            {/if}
            <div class="two">
              <label class="row">
                <span class="lbl">Latitude</span>
                <input
                  type="number"
                  name="lat"
                  step="any"
                  min="-90"
                  max="90"
                  inputmode="decimal"
                  required
                  bind:value={lat}
                />
              </label>
              <label class="row">
                <span class="lbl">Longitude</span>
                <input
                  type="number"
                  name="lon"
                  step="any"
                  min="-180"
                  max="180"
                  inputmode="decimal"
                  required
                  bind:value={lon}
                />
              </label>
            </div>
          </Card>

          <Card>
            <h2 class="serif sub">Frost dates</h2>
            <p class="hint">
              Average last spring frost and first fall frost. Planting windows and the season
              calendar hang off these. Leave them blank to use the Loudoun County averages ({prettyMmDd(
                data.location.defaultLastFrost
              )} and
              {prettyMmDd(data.location.defaultFirstFrost)}); your county extension office has the
              local numbers.
            </p>
            <div class="two">
              <label class="row">
                <span class="lbl">Last spring frost</span>
                <input type="date" name="lastFrost" value={mmddToDate(data.location.lastFrost)} />
              </label>
              <label class="row">
                <span class="lbl">First fall frost</span>
                <input type="date" name="firstFrost" value={mmddToDate(data.location.firstFrost)} />
              </label>
            </div>
          </Card>

          <div class="why">
            <CloudSun size={16} aria-hidden="true" />
            <span>
              Coordinates stay on your farm record. They’re sent only to the National Weather
              Service to fetch your forecast.
            </span>
          </div>

          <div class="actions">
            <button
              class="primary"
              type="submit"
              disabled={submitting || !data.canEdit || lat == null || lon == null}
            >
              Save location and continue <ArrowRight size={15} />
            </button>
          </div>
        </form>

        <!-- ─── 3. Fields ─────────────────────────────────────────────── -->
      {:else if data.step === 'fields' && data.map}
        <div class="tips">
          <div><strong>1.</strong> Use the map toolbar to draw the outline of a field.</div>
          <div><strong>2.</strong> Draw the blocks inside it. Area fills in from the shape.</div>
          <div>
            <strong>No GPS or imagery?</strong> Switch to <em>Dimensions</em> above the map and type each
            field's and block's width and length; they're drawn as boxes.
          </div>
        </div>
        {#if browser}
          <FarmMapEditor
            blocks={data.map.blocks}
            fields={data.map.fields}
            shadeSources={data.map.shadeSources}
            canEdit={data.canEdit}
            isFirstRun={data.map.blocks.length === 0}
            initialCenter={data.map.center}
          />
        {:else}
          <div class="map-loading">Loading map…</div>
        {/if}
        <div class="actions sticky">
          <span class="status" role="status">
            {#if data.map.blocks.length === 0}
              Add at least one block to continue.
            {:else}
              {data.map.blocks.length}
              {data.map.blocks.length === 1 ? 'block' : 'blocks'} mapped. You can add more any time from
              Settings → Farm map.
            {/if}
          </span>
          {#if data.progress.fields}
            <a class="primary" href={stepHref(next)}>Continue <ArrowRight size={15} /></a>
          {:else}
            <button class="primary" type="button" disabled>
              Continue <ArrowRight size={15} />
            </button>
          {/if}
        </div>

        <!-- ─── 4. Implements ─────────────────────────────────────────── -->
      {:else if data.step === 'implements' && data.implements}
        <form method="POST" action="?/implements" use:enhance={submitEnhance} class="form">
          <ImplementPicker
            templates={data.implements.templates}
            owned={data.implements.owned}
            ownedTemplateIds={data.implements.ownedTemplateIds}
            onCountChange={(n) => (pickedCount = n)}
          />
          <div class="why">
            <Gauge size={16} aria-hidden="true" />
            <span>
              New sprayers start <strong>uncalibrated</strong>. Before the first spray you’ll run
              the 1/128-acre calibration from the sprayer’s page. It takes about five minutes with a
              jug and a stopwatch, and dilution math won’t run without it.
            </span>
          </div>
          <div class="actions sticky">
            <span class="status" role="status">
              {#if pickedCount > 0}
                {pickedCount} to add{ownedCount > 0 ? `, ${ownedCount} already on the farm` : ''}.
              {:else if ownedCount > 0}
                {ownedCount} already on the farm.
              {:else}
                Nothing picked. Hand tools only is fine too.
              {/if}
            </span>
            <button class="primary" type="submit" disabled={submitting || !data.canEdit}>
              {pickedCount === 0 && ownedCount === 0
                ? 'Continue with no implements'
                : 'Save implements and continue'}
              <ArrowRight size={15} />
            </button>
          </div>
        </form>

        <!-- ─── 5. Season ─────────────────────────────────────────────── -->
      {:else if data.step === 'season' && data.season}
        <div class="banner">
          <Check size={16} aria-hidden="true" />
          <span>Farm basics are done. Now for this season.</span>
        </div>
        <Card>
          <PlanningYearPicker view={data.season.planningYear} canEdit={data.canEdit} />
        </Card>
        <Card>
          {#key data.season.currentYear}
            <SeasonSetupStep
              existing={data.season.existing}
              lastYearSetup={data.season.lastYearSetup}
              currentYear={data.season.currentYear}
              onSave={onSeasonSaved}
            />
          {/key}
        </Card>

        <!-- ─── 6. Plan hand-off ──────────────────────────────────────── -->
      {:else if data.step === 'plan' && data.summary}
        <Card>
          <h2 class="serif sub">What you’ve set up</h2>
          <ul class="summary">
            <li>
              <MapPin size={16} aria-hidden="true" />
              {#if data.summary.location}
                Location {data.summary.location.lat.toFixed(3)}, {data.summary.location.lon.toFixed(
                  3
                )}
              {:else}
                Location not set
              {/if}
            </li>
            <li>
              <Layers size={16} aria-hidden="true" />
              {data.summary.blockCount}
              {data.summary.blockCount === 1 ? 'block' : 'blocks'}{data.summary.acres > 0
                ? `, ${fmt.qty(data.summary.acres, 'area')}`
                : ''}
            </li>
            <li>
              <Tractor size={16} aria-hidden="true" />
              {data.summary.implementCount}
              {data.summary.implementCount === 1 ? 'implement' : 'implements'}
            </li>
            <li>
              <Leaf size={16} aria-hidden="true" />
              {data.progress.season ? 'Season approach saved' : 'Season approach not set yet'}
            </li>
          </ul>
          {#if data.summary.uncalibratedSprayers > 0}
            <p class="hint warn">
              {data.summary.uncalibratedSprayers}
              {data.summary.uncalibratedSprayers === 1 ? 'sprayer needs' : 'sprayers need'} calibrating
              before the first spray. <a href="/calibrate">Calibrate now</a> or do it from Today when
              you’re ready.
            </p>
          {/if}
        </Card>

        <Card>
          <h2 class="serif sub">Plan the season</h2>
          <p class="hint">
            The planner walks crops, block placement, a dated schedule and the inputs you’ll need.
            It works entirely without AI.
          </p>
          <form method="POST" action="?/finish" use:enhance={submitEnhance} class="finish">
            <button
              class="primary"
              type="submit"
              name="dest"
              value="plan"
              disabled={submitting || !data.canEdit}
            >
              <Wheat size={15} aria-hidden="true" /> Open the season planner
            </button>
            <button
              class="ghost"
              type="submit"
              name="dest"
              value="today"
              disabled={submitting || !data.canEdit}
            >
              Go to Today instead
            </button>
          </form>
        </Card>

        <div class="ai-offer">
          <div class="offer-head">
            <Sparkles size={15} aria-hidden="true" />
            <strong>Optional: AI planning suggestions</strong>
            <Provenance source="ai" compact />
          </div>
          <p>
            Add your own Claude API key and the planner will propose allocations and schedules you
            can accept or reject. Nothing requires it.
          </p>
          <a href="/settings/ai">Add a key in Settings →</a>
        </div>
      {/if}

      {#if data.progress.farm}
        <footer class="wizard-foot">
          {#if back}
            <a class="ghost" href={stepHref(back)}><ArrowLeft size={14} /> Back</a>
          {:else}
            <span></span>
          {/if}
          {#if data.canEdit && data.step !== 'plan'}
            <form method="POST" action="?/later" use:enhance>
              <button class="link" type="submit">Finish setup later</button>
            </form>
          {/if}
        </footer>
      {/if}
    </section>
  </div>

  <p class="reassurance">
    <Info size={12} aria-hidden="true" />
    <span>Everything here can be changed later from Settings.</span>
  </p>
</main>

<style>
  .ob-wrap {
    max-width: 1180px;
    margin: 28px auto 40px;
    padding: 0 16px;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .intro {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 680px;
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
    font-size: 40px;
    line-height: 1.08;
    color: var(--color-forest-deep);
    letter-spacing: -0.025em;
  }
  .lede {
    font-size: 15px;
    color: var(--color-ink-soft);
    line-height: 1.55;
    margin: 0;
  }
  .layout {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 24px;
    align-items: start;
  }
  /* Rail */
  .rail {
    position: sticky;
    top: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rail-farm {
    display: flex;
    flex-direction: column;
    padding: 0 4px 10px;
    border-bottom: 1px solid var(--color-divider);
    margin-bottom: 4px;
  }
  .rail-farm-name {
    font-weight: 700;
    color: var(--color-forest-deep);
  }
  .rail-farm-count {
    font-size: 12px;
    color: var(--color-ink-muted);
  }
  .rail-phase {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
    padding: 8px 4px 2px;
  }
  .rail-steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .rail-link {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 4px 8px;
    border-radius: 8px;
    text-decoration: none;
    color: var(--color-ink-soft);
  }
  a.rail-link:hover {
    background: var(--color-cream);
  }
  .current .rail-link {
    background: var(--color-forest-tint, #e5eedf);
    color: var(--color-forest-deep);
    font-weight: 600;
  }
  .locked .rail-link {
    opacity: 0.55;
  }
  .dot {
    width: 26px;
    height: 26px;
    border-radius: 999px;
    border: 1.5px solid var(--color-divider);
    display: grid;
    place-items: center;
    flex-shrink: 0;
    background: var(--color-paper);
    color: var(--color-ink-muted);
  }
  .done .dot {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: var(--color-cream);
  }
  .current .dot {
    border-color: var(--color-forest);
    color: var(--color-forest);
  }
  .rail-title {
    font-size: 13.5px;
    line-height: 1.3;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  /* Panel */
  .panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }
  .sub {
    margin: 0 0 12px;
    font-size: 18px;
    color: var(--color-forest-deep);
    letter-spacing: -0.01em;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .row {
    display: grid;
    gap: 6px;
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
  input[type='text'],
  input[type='number'],
  input[type='date'] {
    font: inherit;
    padding: 0 12px;
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    min-height: 48px;
    background: var(--color-paper);
    min-width: 0;
  }
  input:focus-visible {
    outline: 2px solid var(--color-forest);
    outline-offset: 2px;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 12px;
  }
  .hint {
    margin: 0 0 8px;
    font-size: 13.5px;
    color: var(--color-ink-soft);
    line-height: 1.5;
  }
  .hint a {
    color: inherit;
    font-weight: 600;
    text-decoration: underline;
  }
  .hint.warn {
    color: var(--pill-rust-fg, #8a3b1c);
  }
  .error {
    background: var(--pill-rust-bg);
    border: 1px solid var(--pill-rust-bd);
    color: var(--pill-rust-fg);
    padding: 12px 16px;
    border-radius: 6px;
    margin: 0;
  }
  .notice {
    background: var(--color-cream);
    border: 1px solid var(--color-divider);
    padding: 12px 16px;
    border-radius: 6px;
    margin: 0;
    font-size: 13.5px;
  }
  .loc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  .loc-head .sub {
    margin: 0;
  }
  .map-loading {
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    padding: 40px;
    text-align: center;
    color: var(--color-ink-muted);
  }
  .why,
  .banner {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    background: var(--color-cream);
    border: 1px solid var(--color-divider);
    border-radius: 8px;
    padding: 12px 14px;
    font-size: 13px;
    color: var(--color-ink-soft);
    line-height: 1.5;
  }
  .why :global(svg),
  .banner :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--color-forest);
  }
  .banner {
    background: var(--color-forest-tint, #e5eedf);
    color: var(--color-forest-deep);
    font-weight: 600;
  }
  .tips {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    font-size: 13px;
    color: var(--color-ink-soft);
    line-height: 1.45;
  }
  .tips > div {
    background: var(--color-cream);
    border: 1px solid var(--color-divider);
    border-radius: 8px;
    padding: 10px 12px;
  }
  .tips em {
    color: inherit;
    font-style: italic;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .actions.sticky {
    position: sticky;
    bottom: 0;
    background: var(--color-paper);
    border-top: 1px solid var(--color-divider);
    padding: 12px 0;
    z-index: 5;
  }
  .status {
    flex: 1;
    font-size: 13px;
    color: var(--color-ink-muted);
    min-width: 180px;
  }
  .primary,
  .ghost {
    font: inherit;
    font-weight: 600;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 48px;
    padding: 0 18px;
    cursor: pointer;
    text-decoration: none;
  }
  .primary {
    background: var(--color-forest);
    color: var(--color-cream);
    border: none;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ghost {
    background: var(--color-paper);
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
  }
  .ghost:disabled {
    opacity: 0.6;
  }
  .link {
    font: inherit;
    background: none;
    border: none;
    color: var(--color-ink-muted);
    text-decoration: underline;
    cursor: pointer;
    min-height: 48px;
    padding: 0 8px;
  }
  .wizard-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid var(--color-divider);
    padding-top: 12px;
  }
  .roadmap ol {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .roadmap li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 13.5px;
    color: var(--color-ink-soft);
    line-height: 1.45;
  }
  .roadmap li :global(svg) {
    color: var(--color-forest);
    flex-shrink: 0;
    margin-top: 2px;
  }
  .rm-num {
    width: 22px;
    height: 22px;
    border-radius: 999px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider);
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .summary {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    font-size: 14px;
  }
  .summary li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .summary :global(svg) {
    color: var(--color-forest);
  }
  .finish {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .ai-offer {
    border: 1px dashed var(--color-divider);
    border-radius: 10px;
    padding: 14px 16px;
    font-size: 13px;
    color: var(--color-ink-soft);
  }
  .ai-offer p {
    margin: 6px 0;
    line-height: 1.5;
  }
  .offer-head {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-forest-deep);
  }
  .ai-offer a {
    color: var(--color-forest);
    font-weight: 600;
  }
  .reassurance {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin: 0;
    font-size: 12px;
    color: var(--color-ink-muted);
  }
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: 1fr;
    }
    .rail {
      position: static;
      min-width: 0;
    }
    .actions.sticky {
      position: static;
    }
    .rail-steps {
      flex-direction: row;
      overflow-x: auto;
      gap: 4px;
    }
    .rail-steps li {
      flex-shrink: 0;
    }
    .rail-title {
      white-space: nowrap;
    }
    .tips {
      grid-template-columns: 1fr;
    }
    h1.serif {
      font-size: 30px;
    }
  }
  @media (max-width: 520px) {
    .two,
    .summary {
      grid-template-columns: 1fr;
    }
    .status {
      flex-basis: 100%;
      min-width: 0;
    }
    .actions .primary,
    .finish .primary,
    .finish .ghost {
      width: 100%;
    }
    .rail-steps .rail-title {
      display: none;
    }
    .current .rail-title {
      display: inline;
    }
  }
</style>
