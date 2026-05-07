<script lang="ts">
  import { onDestroy } from 'svelte';
  import { goto } from '$app/navigation';

  let { data } = $props();

  let selectedSprayerId = $state(data.sprayer?.id ?? data.sprayers[0]?.id ?? '');
  const sprayer = $derived(data.sprayers.find((s) => s.id === selectedSprayerId));

  // FR-05 sequence: drain → 3× plain water rinse → ammonia soak (30 min) →
  // boom + nozzle flush → 2× final rinse → screen/nozzle inspection.
  type Step = {
    key: string;
    title: string;
    body: string;
    requiresTimer?: boolean;
  };

  const STEPS: Step[] = [
    {
      key: 'drain',
      title: 'Drain tank fully',
      body: 'Pump or gravity-drain all remaining mix. Verify boom is empty.'
    },
    {
      key: 'rinse-1',
      title: 'Plain-water rinse #1',
      body: 'Fill tank ~25% with clean water. Agitate. Spray out through boom and nozzles.'
    },
    {
      key: 'rinse-2',
      title: 'Plain-water rinse #2',
      body: 'Repeat. The point is mechanical removal of residue, not dilution.'
    },
    {
      key: 'rinse-3',
      title: 'Plain-water rinse #3',
      body: 'One more pass. Make sure the boom and screens are flushed.'
    },
    {
      key: 'ammonia',
      title: 'Ammonia soak — 30 minutes',
      body: 'Add 1 cup household ammonia per 5 gal of water. Fill tank to operating volume, run pump for 30 sec, then SHUT OFF and let the solution sit for 30 minutes. Timer below.',
      requiresTimer: true
    },
    {
      key: 'boom-flush',
      title: 'Boom + nozzle flush',
      body: 'After the soak, restart agitation and spray the ammonia solution out through the boom.'
    },
    {
      key: 'final-rinse-1',
      title: 'Final rinse #1',
      body: 'Two final clear-water rinses, sprayed through the boom each time.'
    },
    {
      key: 'final-rinse-2',
      title: 'Final rinse #2',
      body: 'Last clear-water pass. Inspect screens and nozzles. Replace any clogged.'
    }
  ];

  let stepIndex = $state(0);
  const currentStep = $derived(STEPS[stepIndex]);

  // 30-minute ammonia timer
  const TIMER_MS = 30 * 60 * 1000;
  let timerStartedAt = $state<number | null>(null);
  let now = $state(Date.now());
  let interval: ReturnType<typeof setInterval> | null = null;

  function startTimer() {
    timerStartedAt = Date.now();
    if (interval) clearInterval(interval);
    interval = setInterval(() => (now = Date.now()), 1000);
  }
  function stopTimer() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }
  onDestroy(stopTimer);

  const elapsed = $derived(timerStartedAt ? now - timerStartedAt : 0);
  const remaining = $derived(Math.max(0, TIMER_MS - elapsed));
  const timerDone = $derived(timerStartedAt != null && remaining === 0);
  let timerSkipped = $state(false);
  const stepCanAdvance = $derived(currentStep.requiresTimer ? timerDone || timerSkipped : true);

  function fmt(ms: number) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  let submitting = $state(false);
  let submitError = $state<string | null>(null);
  let completed = $state(false);

  async function complete() {
    if (!sprayer) return;
    submitting = true;
    submitError = null;
    try {
      const res = await fetch(`/api/sprayers/${encodeURIComponent(sprayer.id)}/decon`, {
        method: 'POST'
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        submitError = err.error ?? `HTTP ${res.status}`;
        return;
      }
      completed = true;
    } catch (e) {
      submitError = e instanceof Error ? e.message : String(e);
    } finally {
      submitting = false;
    }
  }

  function next() {
    if (!stepCanAdvance) return;
    if (stepIndex < STEPS.length - 1) {
      stepIndex += 1;
      stopTimer();
      timerStartedAt = null;
    } else {
      complete();
    }
  }

  function back() {
    if (stepIndex > 0) {
      stepIndex -= 1;
      stopTimer();
      timerStartedAt = null;
    }
  }
</script>

<h1>Sprayer decontamination</h1>
<p class="lede">
  Required by FR-05 before this sprayer can be used on a different chemistry. Each step must be
  confirmed before the next is unlocked. The 30-minute ammonia soak is timed by the app.
</p>

<section class="step">
  <h2>Sprayer</h2>
  <select bind:value={selectedSprayerId}>
    {#each data.sprayers as s (s.id)}
      <option value={s.id}>{s.label} ({s.id})</option>
    {/each}
  </select>
  {#if sprayer?.lastChemistryClass}
    <p class="warn">
      Last carried: <strong>{sprayer.lastChemistryClass}</strong> at
      {sprayer.lastSprayedAt ? new Date(sprayer.lastSprayedAt).toLocaleString() : 'unknown'}
    </p>
  {/if}

  {#if !completed}
    <details class="quick-mark">
      <summary>Already cleaned the sprayer? Mark it clean now.</summary>
      <p class="hint">
        Use this if the decon was done outside the app (or you've completed it before and just need
        to update state). Records a decon timestamp without walking through the per-step wizard. The
        kernel will treat the sprayer as decontaminated immediately.
      </p>
      <button
        type="button"
        class="primary mark-clean"
        onclick={complete}
        disabled={submitting || !sprayer}
      >
        {submitting ? 'Marking…' : 'Mark sprayer clean now'}
      </button>
    </details>
  {/if}
</section>

{#if !completed}
  <section class="step">
    <h2>Step {stepIndex + 1} of {STEPS.length}: {currentStep.title}</h2>
    <p>{currentStep.body}</p>

    {#if currentStep.requiresTimer}
      {#if !timerStartedAt && !timerSkipped}
        <div class="timer-actions">
          <button type="button" class="primary" onclick={startTimer}>
            Start 30-minute timer
          </button>
          <button
            type="button"
            class="skip"
            onclick={() => {
              timerSkipped = true;
            }}
          >
            Skip — I've already done the soak
          </button>
        </div>
      {:else if timerSkipped}
        <p class="timer-skipped">
          ⏭ Timer skipped — you've confirmed the 30-minute dwell already happened. Tap Next to
          continue.
        </p>
      {:else if !timerDone}
        <p class="timer">Soaking… <strong>{fmt(remaining)}</strong> remaining</p>
        <p class="hint">
          You may close this tab — the timer is cosmetic; what matters is the actual 30-minute dwell
          on the chemicals. The next step unlocks at zero. Or
          <button
            type="button"
            class="link-button"
            onclick={() => {
              timerSkipped = true;
            }}>skip the timer</button
          > if the soak already finished.
        </p>
      {:else}
        <p class="timer-done">✓ 30 minutes elapsed. Step unlocked.</p>
      {/if}
    {/if}

    <div class="actions">
      <button type="button" onclick={back} disabled={stepIndex === 0}>← Back</button>
      <button type="button" class="primary" onclick={next} disabled={!stepCanAdvance || submitting}>
        {stepIndex === STEPS.length - 1
          ? submitting
            ? 'Recording…'
            : 'Confirm complete'
          : 'Next →'}
      </button>
    </div>
    {#if submitError}
      <p class="error">{submitError}</p>
    {/if}
  </section>

  <section class="checklist">
    <h2>All steps</h2>
    <ol>
      {#each STEPS as s, i (s.key)}
        <li class:done={i < stepIndex} class:current={i === stepIndex}>
          {s.title}
        </li>
      {/each}
    </ol>
  </section>
{:else}
  <section class="step success">
    <h2>✓ Decon recorded</h2>
    <p>
      Sprayer <strong>{sprayer?.label ?? selectedSprayerId}</strong> is cleared. The kernel will now allow
      it on different chemistry until its next load.
    </p>
    <button type="button" class="primary" onclick={() => goto('/spray')}>
      Back to spray plan
    </button>
  </section>
{/if}

<style>
  h1 {
    margin: 0 0 0.25rem;
  }
  .lede {
    color: #555;
    margin: 0 0 1.5rem;
  }
  .step,
  .checklist {
    background: white;
    padding: 1rem;
    margin-bottom: 1rem;
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .step h2,
  .checklist h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: #1f5e3a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .step.success {
    background: #e7f1ea;
    border: 2px solid #1f5e3a;
  }
  select {
    width: 100%;
    padding: 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
  }
  .warn {
    color: #b35900;
    font-weight: 600;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
  }
  .actions button {
    flex: 1;
    padding: 0.9rem;
    border-radius: 6px;
    border: 2px solid #1f5e3a;
    background: white;
    color: #1f5e3a;
    font-weight: 600;
    font-size: 1rem;
    min-height: 60px;
    cursor: pointer;
  }
  .actions button.primary {
    background: #1f5e3a;
    color: white;
  }
  .actions button:disabled {
    background: #ccc;
    border-color: #ccc;
    color: #666;
    cursor: not-allowed;
  }
  .timer {
    font-size: 1.4rem;
    background: #fff3cd;
    padding: 0.75rem;
    border-radius: 4px;
    border-left: 4px solid #b35900;
    margin: 1rem 0;
  }
  .timer strong {
    color: #b35900;
    font-family: monospace;
    font-size: 1.6rem;
  }
  .timer-done {
    background: #e7f1ea;
    color: #1f5e3a;
    padding: 0.75rem;
    border-radius: 4px;
    font-weight: 600;
    margin: 1rem 0;
  }
  .timer-skipped {
    background: #f5f0fa;
    color: #6b3fa0;
    padding: 0.75rem;
    border-radius: 4px;
    font-weight: 600;
    margin: 1rem 0;
    border-left: 4px solid #6b3fa0;
  }
  .timer-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin: 1rem 0;
  }
  .timer-actions .primary {
    flex: 1 1 240px;
  }
  .skip {
    background: white;
    color: #555;
    border: 2px solid #d0d7d0;
    border-radius: 6px;
    padding: 0.9rem 1.25rem;
    font: inherit;
    cursor: pointer;
    min-height: 60px;
    flex: 1 1 240px;
  }
  .skip:hover {
    border-color: #555;
  }
  .link-button {
    background: none;
    border: none;
    color: #1f5e3a;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    padding: 0;
    min-height: auto;
    min-width: auto;
  }
  .quick-mark {
    margin-top: 1rem;
    background: #fffceb;
    padding: 0.6rem 0.9rem;
    border-radius: 4px;
    border-left: 4px solid #ffd400;
  }
  .quick-mark summary {
    cursor: pointer;
    color: #5a4a00;
    font-weight: 600;
    list-style: revert;
  }
  .quick-mark[open] summary {
    margin-bottom: 0.5rem;
  }
  .quick-mark .hint {
    color: #555;
    font-size: 0.9rem;
  }
  .mark-clean {
    margin-top: 0.5rem;
    background: #b35900;
  }
  .mark-clean:hover {
    background: #944800;
  }
  .hint {
    color: #555;
    font-size: 0.85rem;
  }
  .error {
    color: #b00020;
    margin-top: 0.5rem;
  }
  .primary {
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 1rem 1.5rem;
    font-size: 1.1rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 60px;
  }
  .checklist ol {
    padding-left: 1.5rem;
  }
  .checklist li {
    padding: 0.4rem 0;
    color: #888;
  }
  .checklist li.done {
    color: #1f5e3a;
    text-decoration: line-through;
  }
  .checklist li.current {
    color: #1f5e3a;
    font-weight: 700;
  }
</style>
