<script lang="ts">
  /**
   * Inputs Plan wizard step (Phase 21 / B-28 / UC-37d).
   *
   * Renders the deterministic plan from `/api/plan/inputs` as per-
   * planting collapsible cards with inline accept/reject toggles, a
   * right-rail consolidated shopping list with shortfall badges, and
   * a warnings panel. The AI refinement layer (B-27) substitutes in
   * later — for now this is the deterministic source of truth.
   *
   * Caller wiring (from `AllocationWizard.svelte`):
   *   - `plantings` — the in-memory ScheduledPlanting[] from the
   *     Schedule step (shape adapted to `InputsPlanProvisionalPlanting`
   *     before passing in).
   *   - `year` — the planting year (drives season-setup lookup).
   *   - `onCommit(accepted)` — wizard advances to its main commit step;
   *     accepted carries the subset of applications + scoutTasks the
   *     operator chose to materialize as tasks.
   *   - `onBack()` — re-renders the Schedule step.
   */

  import type {
    InputsPlan,
    InputsPlanApplication,
    InputsPlanProvisionalPlanting,
    InputsPlanScoutTask,
    PlannerWarning
  } from '$lib/plan/inputsPlan';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import ProvenanceLegend from '$lib/components/ui/ProvenanceLegend.svelte';

  interface Props {
    plantings: ReadonlyArray<InputsPlanProvisionalPlanting>;
    year: number;
    /** #214 — passed in by `AllocationWizard` so the legend mirrors the
     *  Schedule step's "Where this data came from" surface. Reflects the
     *  presence of an Anthropic key at wizard mount; the per-row provenance
     *  chip flips to `fallback` whenever `planMeta.fallback` is set. */
    aiEnabled?: boolean;
    onCommit: (accepted: {
      applications: InputsPlanApplication[];
      scoutTasks: InputsPlanScoutTask[];
      /** Phase 25d (#89) — true when the served plan came from the AI
       *  layer (no fallback). Forwarded to the inputs-commit endpoint
       *  so the `plan_revisions` row gets `source: 'ai-refinement'`
       *  vs `'wizard'` for the ProvenancePanel. */
      aiRefined: boolean;
    }) => void | Promise<void>;
    onBack: () => void;
  }

  let { plantings, year, aiEnabled = false, onCommit, onBack }: Props = $props();

  /** #211 — translate raw `PlannerWarning.kind` enum keys into human copy
   *  with planting name + recommended action, so users don't see bare
   *  identifiers like `no-growth-stage-table`. */
  function warningCopy(w: PlannerWarning): { title: string; body: string } {
    const plantingName =
      plantings.find((p) => p.id === w.plantingId)?.varietyDisplayName ?? 'this planting';
    switch (w.kind) {
      case 'no-compliant-product':
        return {
          title: `No compliant product for ${plantingName}`,
          body: `${w.reason} — review on /settings/season and /inventory, or relax the philosophy filter.`
        };
      case 'missing-yield-goal':
        return {
          title: `Yield goal missing for ${plantingName}`,
          body: `Family "${w.cropFamily}" has no yield-goal default. N/P/K rates use a conservative fallback; edit the planting to set a target yield for sharper rates.`
        };
      case 'missing-spray-window-purpose':
        return {
          title: `Spray-window purpose missing on ${plantingName}`,
          body: `Crop plugin "${w.cropPluginId}" has a "${w.windowTitle}" window without a tagged purpose — that window was skipped. File a plugin issue or add the purpose field.`
        };
      case 'missing-anchor-date':
        return {
          title: `No planting date set on ${plantingName}`,
          body: `Schedule a planting date in the Schedule step so applications can anchor to it.`
        };
      case 'no-growth-stage-table':
        return {
          title: `No IPM scout cadence library for ${plantingName}`,
          body: `Crop plugin "${w.cropPluginId}" isn't in the growth-stage table — a general 7-day scouting reminder was added in place of the targeted cadence.`
        };
    }
  }

  let plan = $state<InputsPlan | null>(null);
  let planMeta = $state<{
    fallback?: 'no-api-key' | 'deterministic' | 'quota-exceeded';
    violations?: string[];
  } | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  /** Set of application IDs the operator has REJECTED (default = all
   *  accepted; rejection is the affirmative gesture). Keyed by
   *  application id for stable React-style toggling. */
  let rejectedAppIds = $state<Set<string>>(new Set());
  let rejectedScoutIds = $state<Set<string>>(new Set());

  /** Expanded plantings — by default collapse all rows after the
   *  first to keep the surface scannable on a phone. */
  let expanded = $state<Set<string>>(new Set());

  let committing = $state(false);
  let commitError = $state<string | null>(null);

  $effect(() => {
    loadPlan();
  });

  async function loadPlan(): Promise<void> {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/plan/inputs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plantings, year })
      });
      const payload = await res.json();
      if (!res.ok) {
        error = payload.error ?? 'failed to load plan';
        plan = null;
        return;
      }
      plan = payload.plan as InputsPlan;
      planMeta = payload.meta ?? null;
      // Expand the first planting by default so the operator sees
      // something concrete on entry.
      if (plantings[0]) expanded = new Set([plantings[0].id]);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  function toggleExpanded(plantingId: string): void {
    const next = new Set(expanded);
    if (next.has(plantingId)) next.delete(plantingId);
    else next.add(plantingId);
    expanded = next;
  }

  function toggleAppReject(appId: string): void {
    const next = new Set(rejectedAppIds);
    if (next.has(appId)) next.delete(appId);
    else next.add(appId);
    rejectedAppIds = next;
  }

  function toggleScoutReject(scoutId: string): void {
    const next = new Set(rejectedScoutIds);
    if (next.has(scoutId)) next.delete(scoutId);
    else next.add(scoutId);
    rejectedScoutIds = next;
  }

  const appsByPlanting = $derived.by(() => {
    const map = new Map<string, InputsPlanApplication[]>();
    if (!plan) return map;
    for (const app of plan.applications) {
      const list = map.get(app.plantingId) ?? [];
      list.push(app);
      map.set(app.plantingId, list);
    }
    return map;
  });

  const scoutsByPlanting = $derived.by(() => {
    const map = new Map<string, InputsPlanScoutTask[]>();
    if (!plan) return map;
    for (const s of plan.scoutTasks) {
      const list = map.get(s.plantingId) ?? [];
      list.push(s);
      map.set(s.plantingId, list);
    }
    return map;
  });

  const acceptedSummary = $derived.by(() => {
    if (!plan) return { apps: 0, scouts: 0 };
    return {
      apps: plan.applications.filter((a) => !rejectedAppIds.has(a.id)).length,
      scouts: plan.scoutTasks.filter((s) => !rejectedScoutIds.has(s.id)).length
    };
  });

  async function handleCommit(): Promise<void> {
    if (!plan) return;
    committing = true;
    commitError = null;
    try {
      await onCommit({
        applications: plan.applications.filter((a) => !rejectedAppIds.has(a.id)),
        scoutTasks: plan.scoutTasks.filter((s) => !rejectedScoutIds.has(s.id)),
        aiRefined: planMeta != null && !planMeta.fallback
      });
    } catch (e) {
      commitError = e instanceof Error ? e.message : String(e);
    } finally {
      committing = false;
    }
  }

  function fmtDate(ms: number): string {
    return new Date(ms).toLocaleDateString();
  }

  function fmtSlot(slot: string): string {
    return slot.replace(/-/g, ' ');
  }
</script>

<div class="inputs-step">
  <header class="step-header">
    <h2>Inputs plan</h2>
    <p class="lede">
      Deterministic plan derived from your season setup, the crop family defaults and the
      compliance-filtered product catalog. Toggle rows off to skip them; the right rail aggregates
      everything you keep.
    </p>
  </header>

  {#if loading}
    <p class="muted">Computing inputs plan…</p>
  {:else if error}
    <div class="card err" role="alert">
      <strong>Couldn't generate plan:</strong>
      {error}
      <button type="button" class="link-btn" onclick={loadPlan}>retry</button>
    </div>
  {:else if plan}
    {#if planMeta?.fallback === 'deterministic'}
      <div class="card warn" role="status">
        <strong>AI substitution rejected.</strong> The proposed product changes failed validation;
        falling back to the deterministic plan. Edit a row above to substitute by hand.
        {#if planMeta.violations && planMeta.violations.length > 0}
          <details class="violation-details">
            <summary
              >Why? ({planMeta.violations.length} violation{planMeta.violations.length === 1
                ? ''
                : 's'})</summary
            >
            <ul class="violation-list">
              {#each planMeta.violations as v, i (i)}
                <li><code>{v}</code></li>
              {/each}
            </ul>
            <p class="violation-hint">
              Most common cause: plugins lack <code>complianceFlags</code> (omriListed,
              nonGmoCompliant, etc.) so they can't satisfy a non-conventional philosophy. Tag the
              plugins via Plugin Manager, or switch philosophy to
              <code>conventional</code> to unblock substitutions.
            </p>
          </details>
        {/if}
      </div>
    {:else if planMeta?.fallback === 'quota-exceeded'}
      <div class="card warn" role="status">
        <strong>Daily AI quota reached.</strong> Showing the deterministic plan. Raise the quota on Settings
        or try again tomorrow.
      </div>
    {:else if planMeta?.fallback === 'no-api-key'}
      <div class="card info" role="status">
        Showing the deterministic plan (no AI key configured). Add
        <code>ANTHROPIC_API_KEY</code> to enable product substitutions.
      </div>
    {/if}

    <div class="layout">
      <main class="cards">
        <ProvenanceLegend
          shown={aiEnabled && !planMeta?.fallback
            ? ['plugin', 'data', 'ai', 'manual']
            : ['plugin', 'data', 'fallback', 'manual']}
          note={aiEnabled && !planMeta?.fallback
            ? 'Rates from plugin defaults · AI substitutes products · all editable'
            : 'AI off · deterministic plan · plugin + your records'}
        />
        {#each plantings as planting (planting.id)}
          {@const apps = appsByPlanting.get(planting.id) ?? []}
          {@const scouts = scoutsByPlanting.get(planting.id) ?? []}
          {@const acceptedHere =
            apps.filter((a) => !rejectedAppIds.has(a.id)).length +
            scouts.filter((s) => !rejectedScoutIds.has(s.id)).length}
          <article class="planting" class:expanded={expanded.has(planting.id)}>
            <button
              type="button"
              class="planting-header"
              onclick={() => toggleExpanded(planting.id)}
              aria-expanded={expanded.has(planting.id)}
            >
              <span class="planting-name">{planting.varietyDisplayName}</span>
              <span class="planting-meta">
                {planting.plantingDate ? fmtDate(planting.plantingDate) : 'no date'} ·
                {acceptedHere} task{acceptedHere === 1 ? '' : 's'}
              </span>
              <span class="caret" aria-hidden="true">
                {expanded.has(planting.id) ? '▾' : '▸'}
              </span>
            </button>

            {#if expanded.has(planting.id)}
              <div class="planting-body">
                {#if apps.length === 0 && scouts.length === 0}
                  <p class="muted">No applications or scout tasks needed for this crop.</p>
                {/if}

                {#each apps as app (app.id)}
                  <label class="row app-row" class:rejected={rejectedAppIds.has(app.id)}>
                    <input
                      type="checkbox"
                      checked={!rejectedAppIds.has(app.id)}
                      onchange={() => toggleAppReject(app.id)}
                    />
                    <div class="row-body">
                      <div class="row-title">
                        <span class="slot-pill" data-category={app.productCategory}
                          >{fmtSlot(app.slot)}</span
                        >
                        <span class="product-name">
                          {app.productDisplayName ?? '⚠ pick product'}
                        </span>
                        <span class="row-date">{fmtDate(app.applicationDateMs)}</span>
                        <Provenance
                          source={planMeta?.fallback ? 'fallback' : aiEnabled ? 'ai' : 'plugin'}
                          compact
                        />
                      </div>
                      <p class="rationale">{app.rationale}</p>
                      {#if app.rateAmount != null && app.rateUnit}
                        <p class="rate-line">
                          {app.rateAmount}
                          {app.rateUnit}/ac × {app.acres.toFixed(2)} ac =
                          {app.totalAmount}
                          {app.rateUnit}
                        </p>
                      {/if}
                    </div>
                  </label>
                {/each}

                {#each scouts as scout (scout.id)}
                  <label class="row scout-row" class:rejected={rejectedScoutIds.has(scout.id)}>
                    <input
                      type="checkbox"
                      checked={!rejectedScoutIds.has(scout.id)}
                      onchange={() => toggleScoutReject(scout.id)}
                    />
                    <div class="row-body">
                      <div class="row-title">
                        <span class="slot-pill" data-category="scout">scout</span>
                        <span class="product-name">{scout.title}</span>
                        <span class="row-date">every {scout.recurrenceDays}d</span>
                        <Provenance source="plugin" compact />
                      </div>
                      <p class="rationale">{scout.body}</p>
                    </div>
                  </label>
                {/each}
              </div>
            {/if}
          </article>
        {/each}

        {#if plan.warnings.length > 0}
          <section class="card warn" aria-labelledby="ips-warn-heading">
            <h3 id="ips-warn-heading">Warnings ({plan.warnings.length})</h3>
            <ul class="warn-list">
              {#each plan.warnings as w, i (i)}
                {@const c = warningCopy(w)}
                <li>
                  <strong>{c.title}</strong>
                  <p class="warn-body">{c.body}</p>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      </main>

      <aside class="shopping">
        <h3>Shopping list</h3>
        {#if plan.shoppingList.length === 0}
          <p class="muted">Nothing to buy — on-hand stock covers all chosen applications.</p>
        {:else}
          <ul>
            {#each plan.shoppingList as item (item.pluginId)}
              <li>
                <div class="shop-title">
                  <span class="shop-cat">{item.category}</span>
                  <span class="shop-name">{item.displayName}</span>
                </div>
                <div class="shop-totals">
                  <span>Need: <strong>{item.totalNeeded} {item.unit}</strong></span>
                  <span>On hand: {item.onHand} {item.unit}</span>
                  {#if item.shortfall > 0}
                    <span class="shortfall">Buy: {item.shortfall} {item.unit}</span>
                  {:else}
                    <span class="covered">✓ Covered</span>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </aside>
    </div>

    {#if commitError}
      <div class="card err" role="alert">
        <strong>Commit failed:</strong>
        {commitError}
      </div>
    {/if}

    <footer class="step-actions">
      <button type="button" class="secondary" onclick={onBack}>← Back to schedule</button>
      <span class="summary">
        Accepting {acceptedSummary.apps} application{acceptedSummary.apps === 1 ? '' : 's'}
        + {acceptedSummary.scouts} scout task{acceptedSummary.scouts === 1 ? '' : 's'}.
      </span>
      <button type="button" class="primary" disabled={committing} onclick={handleCommit}>
        {committing ? 'Committing…' : 'Accept and commit →'}
      </button>
    </footer>
  {/if}
</div>

<style>
  .inputs-step {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  h2 {
    margin: 0;
  }
  .lede {
    color: #555;
    margin: 0.25rem 0 0;
  }
  .muted {
    color: #888;
    font-style: italic;
  }
  .card {
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 1rem;
  }
  .card.err {
    background: #fdecea;
    border-color: #b71c1c;
  }
  .card.warn {
    background: #fff8e1;
    border-color: #f1c40f;
  }
  .warn-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .warn-list li {
    padding-left: 0;
  }
  .warn-list strong {
    display: block;
    color: #5b3a00;
    font-size: 13.5px;
    margin-bottom: 2px;
  }
  .warn-body {
    margin: 0;
    color: #5b3a00;
    font-size: 12.5px;
    line-height: 1.45;
  }
  .card.info {
    background: #e3f2fd;
    border-color: #1565c0;
    color: #1e3a5f;
  }
  .violation-details {
    margin-top: 0.6rem;
  }
  .violation-details summary {
    cursor: pointer;
    color: #5b3a00;
    font-weight: 600;
  }
  .violation-list {
    margin: 0.5rem 0 0.6rem 1.2rem;
    padding: 0;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 0.85rem;
    color: #5b3a00;
  }
  .violation-list li {
    margin: 0.15rem 0;
  }
  .violation-hint {
    margin: 0.4rem 0 0;
    color: #5b3a00;
    font-size: 0.9rem;
  }
  .violation-hint code {
    font-size: 0.85rem;
    background: rgba(0, 0, 0, 0.05);
    padding: 0 0.25rem;
    border-radius: 3px;
  }
  .link-btn {
    background: none;
    border: none;
    color: #1565c0;
    cursor: pointer;
    text-decoration: underline;
    padding: 0 0.25rem;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 1rem;
  }
  @media (max-width: 720px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .planting {
    border: 1px solid #ddd;
    border-radius: 8px;
    background: #fff;
    overflow: hidden;
  }
  .planting-header {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr auto 24px;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: #f4f6fa;
    border: none;
    cursor: pointer;
    text-align: left;
    min-height: 48px;
  }
  .planting-name {
    font-weight: 600;
  }
  .planting-meta {
    color: #555;
    font-size: 0.9rem;
  }
  .caret {
    color: #888;
  }
  .planting-body {
    padding: 0.5rem 1rem 1rem;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.6rem 0.4rem;
    border-bottom: 1px solid #eee;
    cursor: pointer;
  }
  .row:last-child {
    border-bottom: none;
  }
  .row.rejected {
    opacity: 0.5;
  }
  .row input[type='checkbox'] {
    margin-top: 0.4rem;
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
  }
  .row-body {
    flex: 1;
    min-width: 0;
  }
  .row-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .slot-pill {
    background: #eef2ff;
    color: #3730a3;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: capitalize;
  }
  .slot-pill[data-category='herbicide'] {
    background: #fff1e6;
    color: #9a3412;
  }
  .slot-pill[data-category='insecticide'] {
    background: #fef3c7;
    color: #92400e;
  }
  .slot-pill[data-category='fungicide'] {
    background: #ede9fe;
    color: #5b21b6;
  }
  .slot-pill[data-category='fertilizer'] {
    background: #dcfce7;
    color: #166534;
  }
  .slot-pill[data-category='scout'] {
    background: #e0f2fe;
    color: #075985;
  }
  .product-name {
    font-weight: 500;
  }
  .row-date {
    color: #666;
    font-size: 0.85rem;
    margin-left: auto;
  }
  .rationale {
    color: #555;
    font-size: 0.9rem;
    margin: 0.25rem 0;
  }
  .rate-line {
    color: #333;
    font-size: 0.85rem;
    margin: 0.15rem 0;
    font-family: ui-monospace, monospace;
  }
  .shopping {
    background: #fafbfc;
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 1rem;
    position: sticky;
    top: 1rem;
    align-self: start;
  }
  .shopping h3 {
    margin: 0 0 0.5rem;
  }
  .shopping ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .shopping li {
    padding: 0.5rem 0;
    border-bottom: 1px solid #eee;
  }
  .shopping li:last-child {
    border-bottom: none;
  }
  .shop-title {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }
  .shop-cat {
    font-size: 0.75rem;
    text-transform: uppercase;
    color: #888;
  }
  .shop-name {
    font-weight: 500;
  }
  .shop-totals {
    display: flex;
    flex-direction: column;
    font-size: 0.85rem;
    color: #555;
    margin-top: 0.2rem;
  }
  .shortfall {
    color: #b71c1c;
    font-weight: 600;
  }
  .covered {
    color: #166534;
  }
  .step-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 0;
    border-top: 1px solid #ddd;
  }
  .step-actions .summary {
    flex: 1;
    color: #555;
  }
  button.primary,
  button.secondary {
    min-height: 48px;
    padding: 0 1.25rem;
    border-radius: 6px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    border: none;
  }
  button.primary {
    background: #1565c0;
    color: #fff;
  }
  button.primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  button.secondary {
    background: #fff;
    color: #1565c0;
    border: 1px solid #1565c0;
  }
</style>
