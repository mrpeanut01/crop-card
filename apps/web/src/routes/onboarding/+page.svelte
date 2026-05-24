<script lang="ts">
  import { enhance } from '$app/forms';
  import { Sparkles, Sprout, Info, Lock } from 'lucide-svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();

  // First-field focus on a freshly-loaded setup form is intentional — but
  // `autofocus` is flagged by Svelte's a11y lint as a jarring shift for
  // screen readers. Use bind:this + $effect to call focus() after mount.
  let farmNameInput = $state<HTMLInputElement | null>(null);
  $effect(() => {
    farmNameInput?.focus();
  });

  // Phase 25 v2 addendum (#91) — what still works without a Claude key,
  // surfaced in the AI offer card so the inspector (Dale) persona sees
  // the AI key is optional from the first screen.
  const WITHOUT_KEY_CAPABILITIES = [
    '308 plugins',
    'calibration math',
    'safety kernel',
    'calendar derivations',
    'CSV import'
  ];
</script>

<svelte:head>
  <title>Set up your farm — CropCard</title>
</svelte:head>

<main class="onboarding">
  <header class="intro">
    <h1 class="serif">Welcome to CropCard</h1>
    <p class="hint">Tell us about your farm. You can change these later in settings.</p>
  </header>

  {#if form?.error}
    <p class="error" role="alert">{form.error}</p>
  {/if}

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
        placeholder="e.g., Loudoun County, VA — paste lat/lng if you have it"
      />
    </label>

    <button class="submit" type="submit">Create farm →</button>
  </form>

  <p class="next-step-hint">
    💡 After you create your farm, head to <a href="/plan">Plan</a> to set up this season's input
    philosophy (6 quick questions — drives what the planner suggests).
  </p>

  <!-- ─── v2 addendum (#91) — AI offer card ─────────────────────────────
       Frames the Claude key as a first-class optional add-on, not a
       required path. Skip CTA carries equal visual weight + an info
       row lists what still works without a key. Matches the v2 mockup
       at docs/design/almanac/direction-almanac-onboarding.jsx
       (AI offer card). -->
  <section class="ai-offer" aria-labelledby="ai-offer-heading">
    <Card>
      <div class="offer-head">
        <div class="offer-icon" aria-hidden="true">
          <Sparkles size={16} strokeWidth={1.75} />
        </div>
        <div class="offer-title">
          <h2 id="ai-offer-heading" class="serif">Planning assistant · optional</h2>
          <p class="offer-sub">Bring-your-own Claude key · capped spend</p>
        </div>
        <Provenance source="ai" compact />
      </div>

      <p class="offer-body">
        Paste an API key in Settings → AI to enable proposals across the spray, plan, and
        stock-add flows. Every screen works fully without one.
      </p>

      <div class="offer-info">
        <Info size={13} strokeWidth={1.75} aria-hidden="true" />
        <span>
          <strong>Without a key:</strong>
          {WITHOUT_KEY_CAPABILITIES.join(' · ')} — all still work.
          <em>AI only assists; never gates.</em>
        </span>
      </div>

      <div class="offer-ctas">
        <a class="cta-primary" href="/settings/ai">
          <Sprout size={14} strokeWidth={1.75} aria-hidden="true" />
          Add Claude key now
        </a>
        <a class="cta-ghost" href="/today">
          Skip · I'll add a key later (or never)
        </a>
      </div>
    </Card>
  </section>

  <div class="footer-reassurance">
    <Lock size={11} strokeWidth={1.75} aria-hidden="true" />
    <span>
      Your data lives on your device first; sync to the cloud is opt-in. Delete the sample plan
      any time from Settings.
    </span>
  </div>
</main>

<style>
  .onboarding {
    max-width: 32rem;
    margin: 4rem auto;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .intro {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h1 {
    margin: 0;
    font-size: var(--font-size-screen-title);
    color: var(--color-forest-deep);
    letter-spacing: var(--letter-tight);
  }
  .hint {
    color: var(--color-ink-soft);
    margin: 0;
  }
  .error {
    background: var(--pill-rust-bg);
    border: 1px solid var(--pill-rust-bd);
    color: var(--pill-rust-fg);
    padding: 0.75rem 1rem;
    border-radius: var(--radius-input, 6px);
    margin: 0;
  }
  .form {
    display: grid;
    gap: 1rem;
    margin: 0;
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
    border-radius: var(--radius-input, 6px);
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
    border-radius: var(--radius-input, 6px);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .submit:hover {
    filter: brightness(1.1);
  }
  .next-step-hint {
    padding: 0.75rem 1rem;
    background: var(--pill-forest-bg);
    border: 1px solid var(--pill-forest-bd);
    border-radius: var(--radius-input, 6px);
    color: var(--pill-forest-fg);
    font-size: 0.9rem;
    line-height: 1.4;
    margin: 0;
  }
  .next-step-hint a {
    color: var(--pill-forest-fg);
    font-weight: 600;
    text-decoration: underline;
  }
  /* ─── AI offer card ──────────────────────────────────────────────── */
  .ai-offer :global(.card) {
    border-left: 4px solid var(--color-forest);
  }
  .offer-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
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
  .offer-title h2 {
    margin: 0;
    font-size: 15px;
    color: var(--color-forest-deep);
    font-weight: 600;
  }
  .offer-sub {
    margin: 2px 0 0;
    font-size: 11px;
    color: var(--color-ink-muted);
  }
  .offer-body {
    margin: 0 0 10px;
    font-size: 13px;
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
    font-size: 11.5px;
    color: var(--color-ink-soft);
    line-height: 1.45;
    margin-bottom: 12px;
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
  .offer-ctas {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .cta-primary,
  .cta-ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    min-height: 44px;
    padding: 10px 16px;
    border-radius: var(--radius-input, 6px);
    font-weight: 600;
    font-size: 14px;
    text-decoration: none;
    border: 1px solid transparent;
    cursor: pointer;
  }
  .cta-primary {
    background: var(--color-forest);
    color: var(--color-cream);
  }
  .cta-primary:hover {
    filter: brightness(1.1);
  }
  .cta-ghost {
    background: var(--color-paper);
    color: var(--color-forest-deep);
    border-color: var(--color-divider);
  }
  .cta-ghost:hover {
    background: var(--color-divider-soft);
  }
  .cta-primary:focus-visible,
  .cta-ghost:focus-visible {
    outline: 2px solid var(--color-forest);
    outline-offset: 2px;
  }
  .footer-reassurance {
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
</style>
