<script lang="ts">
  import { chemistryClassLabel } from '$lib/records/chemistryClassLabel';
  import { goto, invalidateAll } from '$app/navigation';
  import { createT, type MessageKey } from '$lib/i18n';
  import { equipmentTypeLabel } from '$lib/equipment/typeLabel';

  let { data } = $props();
  const tr = $derived(createT(data.locale));
  const eq = $derived(data.equipment);
  const protocol = $derived(data.protocol);

  // Linear winterization steps (UC-45), reusing the decon-wizard chrome.
  // The final-decon step renders the class-specific SOP resolved server-side
  // from the sprayer's lastChemistryClass; the remaining steps are the
  // off-season storage checklist. Each maps to an equipment_log kind.
  type WStep = {
    key: string;
    kind: 'decon' | 'maintenance' | 'inspection';
    title: string;
    body: string;
    subSteps?: readonly string[];
  };

  const steps = $derived<WStep[]>([
    {
      key: 'final-decon',
      kind: 'decon',
      title: `Final decon — ${protocol.label}`,
      body: protocol.strict
        ? `${protocol.rationale} Follow the class-specific rinse below before storage.`
        : 'Run a final decontamination so no residue overwinters in the tank.',
      subSteps: protocol.steps
    },
    {
      key: 'drain-down',
      kind: 'maintenance',
      title: 'Drain the system down',
      body: 'Open every low-point drain: tank, pump, boom, filter bowls, and hoses. Water left in the system freezes and cracks fittings. Leave drains open until fully empty.'
    },
    {
      key: 'antifreeze-flush',
      kind: 'maintenance',
      title: 'RV-antifreeze flush',
      body: 'Draw non-toxic RV antifreeze (propylene glycol) through the pump and out each nozzle until it runs pink. This protects the pump seals and boom lines through hard freezes.'
    },
    {
      key: 'nozzles-screens',
      kind: 'inspection',
      title: 'Nozzles + screens',
      body: 'Remove, inspect, and clean every nozzle tip and line screen. Store loose tips in a labeled bag. Replace any worn or clogged tips now so spring calibration starts clean.'
    },
    {
      key: 'tank-inspection',
      kind: 'inspection',
      title: 'Tank inspection',
      body: 'Inspect the tank interior for residue, cracks, or agitator wear. Confirm the lid seals. Note anything needing repair before next season.'
    },
    {
      key: 'confirm',
      kind: 'maintenance',
      title: 'Confirm + store',
      body: 'All steps done. Confirming stamps the winterized date, clears the chemistry load, and flags the sprayer "Uncalibrated" so you re-run calibration (UC-10) in spring.'
    }
  ]);

  // The stored step label stays English; only the page text is translated.
  // The final-decon step is decon text and stays English.
  const STEP_TEXT = {
    'drain-down': ['equip.w.drain.title', 'equip.w.drain.body'],
    'antifreeze-flush': ['equip.w.antifreeze.title', 'equip.w.antifreeze.body'],
    'nozzles-screens': ['equip.w.nozzles.title', 'equip.w.nozzles.body'],
    'tank-inspection': ['equip.w.tank.title', 'equip.w.tank.body'],
    confirm: ['equip.w.confirm.title', 'equip.w.confirm.body']
  } as const satisfies Record<string, readonly [MessageKey, MessageKey]>;
  function stepTitle(s: WStep): string {
    const k = STEP_TEXT[s.key as keyof typeof STEP_TEXT];
    return k ? tr(k[0]) : s.title;
  }
  function stepBody(s: WStep): string {
    const k = STEP_TEXT[s.key as keyof typeof STEP_TEXT];
    return k ? tr(k[1]) : s.body;
  }

  let stepIndex = $state(0);
  const currentStep = $derived(steps[stepIndex]);

  let submitting = $state(false);
  let submitError = $state<string | null>(null);
  let completed = $state(false);

  async function complete() {
    submitting = true;
    submitError = null;
    try {
      const res = await fetch(`/api/sprayers/${encodeURIComponent(eq.id)}/winterize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          steps: steps.map((s) => ({ key: s.key, kind: s.kind, label: s.title }))
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        submitError = err.error ?? tr('stockui.httpStatus', { status: res.status });
        return;
      }
      completed = true;
      await invalidateAll();
    } catch (e) {
      submitError = e instanceof Error ? e.message : String(e);
    } finally {
      submitting = false;
    }
  }

  function next() {
    if (stepIndex < steps.length - 1) {
      stepIndex += 1;
    } else {
      complete();
    }
  }

  function back() {
    if (stepIndex > 0) stepIndex -= 1;
  }
</script>

<header class="head">
  <a href="/equipment/{encodeURIComponent(eq.id)}" class="back">← {eq.label}</a>
  <h1>{tr('equip.w.title')}</h1>
</header>

<p class="lede">
  {protocol.strict ? tr('equip.w.ledeStrict') : tr('equip.w.ledeStandard')}
</p>

{#if !data.canWinterize}
  <p class="warn" role="note" data-testid="winterize-owner-only">
    {tr('equip.api.winterizeOwnerOnly')}
  </p>
{/if}

<section class="step">
  <h2>{tr('equip.w.sprayer')}</h2>
  <p class="who">
    <span class="type-badge">{equipmentTypeLabel(eq.type, data.locale)}</span>
    <strong>{eq.label}</strong>
  </p>
  {#if data.sprayer?.lastChemistryClass}
    <p class="warn" lang="en" data-english-only="safety">
      Last carried: <strong>{chemistryClassLabel(data.sprayer.lastChemistryClass)}</strong>
      {#if protocol.strict}<span class="strict-pill">strict SOP</span>{/if}
    </p>
  {:else}
    <p class="ok" lang="en" data-english-only="safety">
      Tank already clean — no strict-SOP chemistry on file.
    </p>
  {/if}
</section>

{#if !completed}
  <section class="step">
    <h2>
      {tr('equip.w.step', { n: stepIndex + 1, total: steps.length, title: stepTitle(currentStep) })}
    </h2>
    {#if currentStep.kind === 'decon'}
      <p lang="en" data-english-only="safety">{stepBody(currentStep)}</p>
    {:else}
      <p>{stepBody(currentStep)}</p>
    {/if}

    {#if currentStep.subSteps}
      <ol class="sub-steps" lang="en" data-english-only="safety">
        {#each currentStep.subSteps as sub, i (i)}
          <li>{sub}</li>
        {/each}
      </ol>
    {/if}

    <div class="actions">
      <button type="button" onclick={back} disabled={stepIndex === 0}>{tr('equip.w.back')}</button>
      <button
        type="button"
        class="primary"
        onclick={next}
        disabled={submitting || (stepIndex === steps.length - 1 && !data.canWinterize)}
      >
        {stepIndex === steps.length - 1
          ? submitting
            ? tr('equip.w.recording')
            : tr('equip.w.confirmBtn')
          : tr('equip.w.next')}
      </button>
    </div>
    {#if submitError}<p class="error">{submitError}</p>{/if}
  </section>

  <section class="checklist">
    <h2>{tr('equip.w.allSteps')}</h2>
    <ol>
      {#each steps as s, i (s.key)}
        <li class:done={i < stepIndex} class:current={i === stepIndex}>{stepTitle(s)}</li>
      {/each}
    </ol>
  </section>
{:else}
  <section class="step success">
    <h2>{tr('equip.w.done')}</h2>
    <p>
      <strong>{eq.label}</strong>
      {tr('equip.w.doneNote')}
    </p>
    <div class="actions">
      <button
        type="button"
        class="primary"
        onclick={() => goto(`/equipment/${encodeURIComponent(eq.id)}`)}
      >
        {tr('equip.w.backToEquipment')}
      </button>
    </div>
  </section>
{/if}

<style>
  .head .back {
    display: inline-block;
    color: #1f5e3a;
    text-decoration: none;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }
  .head h1 {
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
  .who {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
  }
  .type-badge {
    background: #e7f1ea;
    color: #1f5e3a;
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  .warn {
    color: #b35900;
    font-weight: 600;
  }
  .ok {
    color: #1f5e3a;
    font-weight: 600;
  }
  .strict-pill {
    background: #fde2cf;
    color: #8a3b00;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.75rem;
    margin-left: 0.4rem;
  }
  .sub-steps {
    background: #f8fbf9;
    border-left: 4px solid #1f5e3a;
    padding: 0.75rem 0.75rem 0.75rem 1.75rem;
    margin: 0.75rem 0 0;
    border-radius: 0 4px 4px 0;
  }
  .sub-steps li {
    padding: 0.25rem 0;
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
  .error {
    color: #b00020;
    margin-top: 0.5rem;
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
