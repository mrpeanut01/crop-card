<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import CalibrationWizard from '$lib/components/calibration/CalibrationWizard.svelte';
  import { currentPrefs, fmt } from '$lib/prefsState.svelte';

  const { data } = $props();

  let pendingActionId = $state<string | null>(null);
  let pendingActionError = $state<string | null>(null);

  const metric = $derived(currentPrefs().units === 'metric');
  const gpaText = (gpa: number) =>
    `${gpa} GPA${metric ? ` (${fmt.qty(gpa, 'volumePerArea')})` : ''}`;

  async function actOnPending(id: string, action: 'approve' | 'reject') {
    pendingActionId = id;
    pendingActionError = null;
    try {
      const res = await fetch(`/api/calibrations/pending/${encodeURIComponent(id)}`, {
        method: action === 'approve' ? 'POST' : 'DELETE'
      });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        pendingActionError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      await invalidateAll();
    } catch (e) {
      pendingActionError = e instanceof Error ? e.message : String(e);
    } finally {
      pendingActionId = null;
    }
  }
</script>

<h1>Sprayer calibration</h1>
<p class="lede">
  1/128-acre method (UC-10, FR-12). Walk the calibration distance at your normal spray speed,
  collect output in a jug, and the fluid ounces you collect equals your gallons-per-acre. The
  dilution calculator uses this GPA to scale every product rate.
</p>

<CalibrationWizard sprayers={data.sprayers} canSave={data.canSave} />

{#if data.canSave && data.pendingCalibrations.length > 0}
  <section class="card pending-review" aria-labelledby="pending-review-title">
    <h2 id="pending-review-title">
      Pending calibrations from helpers ({data.pendingCalibrations.length})
    </h2>
    <p class="hint">
      Helpers ran the 1/128-acre wizard and submitted these GPAs for your approval. Approve to
      apply; reject to discard.
    </p>
    <ul class="pending-list">
      {#each data.pendingCalibrations as p (p.id)}
        {@const eq = data.sprayers.find((s) => s.id === p.equipmentId)}
        <li class="pending-item">
          <div class="pending-meta">
            <strong>{eq?.label ?? p.equipmentId}</strong>
            <span class="gpa-stamp">{gpaText(p.calibratedGpa)}</span>
            <small>
              from {p.submittedByEmail} ·
              {fmt.instant(p.submittedAt)}
              {#if p.spreadInches}· {p.spreadInches} in spread{/if}
              {#if p.ouncesCollected !== undefined}· {p.ouncesCollected} oz{/if}
            </small>
          </div>
          <div class="pending-actions">
            <button
              class="approve"
              onclick={() => actOnPending(p.id, 'approve')}
              disabled={pendingActionId === p.id}
            >
              {pendingActionId === p.id ? 'Working…' : 'Approve & apply'}
            </button>
            <button
              class="reject"
              onclick={() => actOnPending(p.id, 'reject')}
              disabled={pendingActionId === p.id}
            >
              {pendingActionId === p.id ? 'Working…' : 'Reject'}
            </button>
          </div>
        </li>
      {/each}
    </ul>
    {#if pendingActionError}<p class="error" role="alert" aria-live="polite">
        {pendingActionError}
      </p>{/if}
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
  .card {
    background: white;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: #1f5e3a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .hint {
    color: #555;
    font-size: 0.9rem;
    margin: 0 0 0.75rem;
  }
  .error {
    color: #b00020;
    margin: 0.5rem 0 0;
  }
  .pending-review {
    background: #f8fbf9;
    border-left: 4px solid #1f5e3a;
  }
  .pending-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .pending-item {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    padding: 0.75rem;
    background: white;
    border-radius: 6px;
    border-left: 4px solid #b35900;
    align-items: center;
    justify-content: space-between;
  }
  .pending-meta {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    flex: 1 1 220px;
  }
  .gpa-stamp {
    font-family: monospace;
    font-weight: 700;
    color: #1f5e3a;
    font-size: 1.4rem;
  }
  .pending-meta small {
    color: #555;
  }
  .pending-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .pending-actions button {
    padding: 0.7rem 1rem;
    border-radius: 6px;
    border: 2px solid;
    font-weight: 600;
    cursor: pointer;
    min-height: 60px;
  }
  .pending-actions .approve {
    background: #1f5e3a;
    color: white;
    border-color: #1f5e3a;
  }
  .pending-actions .reject {
    background: white;
    color: #b00020;
    border-color: #b00020;
  }
  .pending-actions button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
